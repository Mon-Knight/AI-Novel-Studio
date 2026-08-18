import { executeAiTask, type AiExecutionResult } from './aiExecutionPipeline';
import { isAiRequestCancelled } from './aiCancellation';
import { MAX_CHAPTER_SCENE_PLAN_ATTEMPTS } from './chapterScenePlanPolicy';
import { normalizeScenePlan } from '../engineering/chapterEngineeringService';
import type { AiSettings } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type { ChapterGenerationSnapshot } from '../../types/generationContext';
import type { ScenePlanItem } from '../../types/chapterEngineering';

export interface ChapterScenePlanCandidate {
  scenes: ScenePlanItem[];
  rawText: string;
  taskId?: string;
  execution: AiExecutionResult;
}

export interface GenerateChapterScenePlanInput {
  novelId: string;
  chapterId: string;
  operationId: string;
  settings: AiSettings;
  snapshot: ChapterGenerationSnapshot;
  chapter?: Pick<Chapter, 'title' | 'goal' | 'outline' | 'targetWordCount' | 'targetWords'>;
  signal?: AbortSignal;
}

export const MIN_CHAPTER_BEATS = 3;
export const MAX_CHAPTER_BEATS = 5;
export const MAX_BEATS_PER_SCENE = 3;
export { MAX_CHAPTER_SCENE_PLAN_ATTEMPTS } from './chapterScenePlanPolicy';

export function isRetryableChapterScenePlanError(error: unknown): boolean {
  if (isAiRequestCancelled(error)) return false;
  if (
    error &&
    typeof error === 'object' &&
    'retryable' in error &&
    (error as { retryable?: unknown }).retryable === true
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /(?:模型返回空内容|输出 Token 上限处停止|Scene\/Beat 候选不是有效 JSON|模型未返回有效 Scene|Scene 候选|必须规划 \d+ 个 Beat|每个 Scene 必须包含)/.test(
    message,
  );
}

export function expectedChapterBeatCount(
  chapter?: Partial<Pick<Chapter, 'targetWordCount' | 'targetWords'>>,
): number {
  const target = chapter?.targetWordCount ?? chapter?.targetWords ?? 2500;
  return Math.min(MAX_CHAPTER_BEATS, Math.max(MIN_CHAPTER_BEATS, Math.round(target / 650)));
}

export function validateChapterSceneBeatEnvelope(
  scenes: ReadonlyArray<{ sceneNo: number; beats: ReadonlyArray<unknown> }>,
  chapter?: Partial<Pick<Chapter, 'targetWordCount' | 'targetWords'>>,
): void {
  const invalid = scenes.filter(
    (scene) => scene.beats.length < 1 || scene.beats.length > MAX_BEATS_PER_SCENE,
  );
  if (invalid.length > 0) {
    throw new Error(
      `每个 Scene 必须包含 1–${MAX_BEATS_PER_SCENE} 个 Beat；异常场景：${invalid
        .map((scene) => `Scene ${scene.sceneNo}（${scene.beats.length} 个）`)
        .join('、')}。`,
    );
  }
  const expected = expectedChapterBeatCount(chapter);
  const total = scenes.reduce((sum, scene) => sum + scene.beats.length, 0);
  if (total !== expected) {
    throw new Error(
      `当前章节必须规划 ${expected} 个 Beat（每个 Beat 单独调用本地模型）；模型返回了 ${total} 个。`,
    );
  }
}

function parseJsonCandidate(text: string): unknown | undefined {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(withoutFence) as unknown;
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(withoutFence.slice(start, end + 1)) as unknown;
    } catch {
      return undefined;
    }
  }
}

function sceneArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const scenes = (value as { scenes?: unknown }).scenes;
  return Array.isArray(scenes) ? scenes : undefined;
}

export function parseChapterScenePlanCandidate(text: string): { scenes: unknown[] } | undefined {
  const scenes = sceneArray(parseJsonCandidate(text));
  return scenes?.length ? { scenes } : undefined;
}

function normalizeCandidate(
  payload: { scenes: unknown[] },
  chapter?: GenerateChapterScenePlanInput['chapter'],
): ScenePlanItem[] {
  if (payload.scenes.length > 12) throw new Error('Scene 候选数量超过 12 个，请缩小规划范围。');
  const scenes = normalizeScenePlan(payload.scenes, chapter);
  if (!scenes.length) throw new Error('模型未返回有效 Scene 候选。');
  if (scenes.some((scene) => scene.beats.length === 0)) {
    throw new Error('Scene 候选必须包含至少一个有序 Beat。');
  }
  validateChapterSceneBeatEnvelope(scenes, chapter);
  return scenes;
}

export async function generateChapterScenePlanCandidates(
  input: GenerateChapterScenePlanInput,
): Promise<ChapterScenePlanCandidate> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_CHAPTER_SCENE_PLAN_ATTEMPTS; attempt += 1) {
    try {
      const attemptIdentity = attempt === 1 ? '' : `:retry:${attempt}`;
      const parsed = await executeAiTask({
        operationId: input.operationId + attemptIdentity,
        traceId: input.operationId + attemptIdentity,
        taskType: 'chapter_scene_plan_generate',
        scopeType: 'chapter',
        novelId: input.novelId,
        chapterId: input.chapterId,
        settings: input.settings,
        compilation: {
          taskInput: {
            chapterTitle:
              input.snapshot.compiledContext.baseContext.chapterTitle || input.chapter?.title,
            targetWordCount: input.chapter?.targetWordCount ?? input.chapter?.targetWords ?? 2500,
            contextHash: input.snapshot.contextHash,
            snapshotId: input.snapshot.id,
          },
          sources: [
            {
              sourceType: 'request_context',
              sourceId: input.snapshot.id,
              sourceVersion: input.snapshot.contextHash,
              origin: 'request',
              label: 'Frozen chapter context for Scene/Beat planning',
              content: input.snapshot.compiledPromptText,
              order: 0,
              priority: 100,
              required: true,
              maxTokens: 56_000,
            },
          ],
        },
        parseStructuredPayload: (text) => parseChapterScenePlanCandidate(text),
        signal: input.signal,
      });
      const payload =
        parsed.structuredPayloadJson && typeof parsed.structuredPayloadJson === 'object'
          ? (parsed.structuredPayloadJson as { scenes?: unknown[] })
          : parseChapterScenePlanCandidate(parsed.text);
      if (!payload || !Array.isArray(payload.scenes)) {
        throw new Error('Scene/Beat 候选不是有效 JSON，请重试或调整上下文。');
      }
      return {
        scenes: normalizeCandidate(payload as { scenes: unknown[] }, input.chapter),
        rawText: parsed.text,
        taskId: parsed.taskId,
        execution: parsed,
      };
    } catch (error: unknown) {
      lastError = error;
      if (
        attempt >= MAX_CHAPTER_SCENE_PLAN_ATTEMPTS ||
        !isRetryableChapterScenePlanError(error) ||
        input.signal?.aborted
      ) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Scene/Beat 候选生成失败。');
}
