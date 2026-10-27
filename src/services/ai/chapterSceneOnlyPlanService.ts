import type { AiSettings } from '../../types/ai';
import type { ChapterWorkflowBindingV1 } from '../../types/chapterWorkflowBinding';
import {
  chapterWorkflowBindingSources,
  validateChapterWorkflowBinding,
} from '../generation/chapterWorkflowBinding';
import type { Chapter } from '../../types/chapter';
import { SCENE_PLAN_VERSION_V2, type ScenePlanItem } from '../../types/chapterEngineering';
import type { ChapterScenePlanV2 } from '../../types/chapterWritingWorkflow';
import type { ChapterGenerationSnapshot } from '../../types/generationContext';
import { normalizeScenePlanV2 } from '../engineering/chapterEngineeringService';
import { ChapterWritingWorkflowError } from '../generation/chapterWritingState';
import { executeAiTask, type AiExecutionResult } from './aiExecutionPipeline';
import { isAiRequestCancelled } from './aiCancellation';
import { MAX_CHAPTER_SCENE_PLAN_ATTEMPTS } from './chapterScenePlanPolicy';
import {
  parseJsonCandidate,
  scenesFromPayload,
  type ChapterPlanningTaskExecutor,
} from './chapterPlanningCandidate';

export const CHAPTER_SCENE_PLAN_V2_TASK_TYPE = 'chapter_scene_plan_v2_generate' as const;
export const MIN_CHAPTER_SCENES = 1;
export const MAX_CHAPTER_SCENES = 12;
export const DEFAULT_SCENE_TARGET_CHARACTERS = 650;

export interface ChapterScenePlanV2Result extends ChapterScenePlanV2 {
  rawText: string;
  taskId?: string;
  execution: AiExecutionResult;
}

export interface GenerateChapterScenePlanV2Input {
  novelId: string;
  chapterId: string;
  operationId: string;
  settings: AiSettings;
  snapshot: ChapterGenerationSnapshot;
  chapter?: Pick<Chapter, 'title' | 'goal' | 'outline' | 'targetWordCount' | 'targetWords'>;
  chapterWorkflow?: ChapterWorkflowBindingV1;
  signal?: AbortSignal;
  /** Test seam only; production always uses the governed executor. */
  execute?: ChapterPlanningTaskExecutor;
}

function invalid(message: string): never {
  throw new ChapterWritingWorkflowError('CHAPTER_SCENE_PLAN_V2_INVALID', message);
}

export function parseChapterScenePlanV2Candidate(text: string): { scenes: unknown[] } | undefined {
  const scenes = scenesFromPayload(parseJsonCandidate(text));
  return scenes?.length ? { scenes } : undefined;
}

function chapterTargetWordCount(
  chapter: GenerateChapterScenePlanV2Input['chapter'],
  snapshot: ChapterGenerationSnapshot,
): number {
  const candidates = [
    chapter?.targetWordCount,
    chapter?.targetWords,
    snapshot.compiledContext?.baseContext?.targetWordCount,
  ];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return Math.max(1, Math.round(value));
    }
  }
  return 2_500;
}

function assignSceneTargetCharacters(
  scenes: ScenePlanItem[],
  chapterTarget: number,
): ScenePlanItem[] {
  const providedTotal = scenes.reduce((sum, scene) => sum + (scene.targetCharacters ?? 0), 0);
  const missingCount = scenes.filter((scene) => !scene.targetCharacters).length;
  const remaining = chapterTarget - providedTotal;
  if (missingCount === 0 && remaining !== 0) {
    return invalid('Scene 目标字数总和必须等于章节目标，请重新分配场景预算。');
  }
  if (missingCount > 0 && remaining < missingCount) {
    return invalid('剩余章节预算不足以分配尚缺字数的 Scene。');
  }
  const base = missingCount ? Math.floor(remaining / missingCount) : 0;
  let remainder = missingCount ? remaining % missingCount : 0;
  return scenes.map((scene) => ({
    ...scene,
    targetCharacters: scene.targetCharacters ?? base + (remainder-- > 0 ? 1 : 0),
  }));
}

export function normalizeChapterScenePlanV2Candidate(
  payload: { scenes: unknown[] },
  chapter?: GenerateChapterScenePlanV2Input['chapter'],
  chapterTarget = 2_500,
): ChapterScenePlanV2 {
  if (!Array.isArray(payload.scenes) || payload.scenes.length === 0) {
    return invalid('模型未返回有效 Scene 候选。');
  }
  if (payload.scenes.length > MAX_CHAPTER_SCENES) {
    return invalid(`Scene 候选数量超过 ${MAX_CHAPTER_SCENES} 个，请缩小规划范围。`);
  }
  for (const [index, raw] of payload.scenes.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return invalid(`Scene ${index + 1} 不是有效对象。`);
    }
    const beats = (raw as { beats?: unknown }).beats;
    if (Array.isArray(beats) && beats.length > 0) {
      return invalid(`Scene ${index + 1} 属于 Scene-only v2 规划，不得提前包含 Beats。`);
    }
  }
  const normalized = normalizeScenePlanV2(payload.scenes, chapter).map((scene) => ({
    ...scene,
    planVersion: SCENE_PLAN_VERSION_V2,
    beats: [],
  }));
  if (normalized.length < MIN_CHAPTER_SCENES) return invalid('模型未返回有效 Scene 候选。');
  normalized.forEach((scene, index) => {
    const missing: string[] = [];
    if (!scene.goal.trim()) missing.push('goal');
    if (!scene.conflict.trim()) missing.push('conflict');
    if (!scene.contextCapsule?.trim()) missing.push('contextCapsule');
    if (!scene.expectedEndState?.trim()) missing.push('expectedEndState');
    if (missing.length > 0) {
      return invalid(`Scene ${index + 1} 缺少必要字段：${missing.join('、')}。`);
    }
  });
  return {
    schemaVersion: 2,
    scenes: assignSceneTargetCharacters(normalized, Math.max(1, Math.round(chapterTarget))),
  };
}

export function isRetryableChapterScenePlanV2Error(error: unknown): boolean {
  if (isAiRequestCancelled(error)) return false;
  if (error instanceof ChapterWritingWorkflowError) {
    return error.code === 'CHAPTER_SCENE_PLAN_V2_INVALID';
  }
  if (
    error &&
    typeof error === 'object' &&
    'retryable' in error &&
    (error as { retryable?: unknown }).retryable === true
  ) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /(?:模型返回空内容|输出 Token 上限处停止|不是有效 JSON|Scene 候选|场景候选)/.test(message);
}

export async function generateChapterScenePlanV2(
  input: GenerateChapterScenePlanV2Input,
): Promise<ChapterScenePlanV2Result> {
  const compiledPromptText = input.snapshot.compiledPromptText?.trim() ?? '';
  if (!compiledPromptText) {
    throw new ChapterWritingWorkflowError(
      'CHAPTER_SCENE_PLAN_V2_CONTEXT_MISSING',
      'Scene 规划需要非空的冻结章节上下文。',
    );
  }
  const chapterTitle =
    input.snapshot.compiledContext?.baseContext?.chapterTitle?.trim() ||
    input.chapter?.title?.trim() ||
    '';
  if (!chapterTitle) {
    throw new ChapterWritingWorkflowError(
      'CHAPTER_SCENE_PLAN_V2_CONTEXT_MISSING',
      'Scene 规划缺少章节标题。',
    );
  }
  const targetWordCount = chapterTargetWordCount(input.chapter, input.snapshot);
  const binding =
    input.chapterWorkflow === undefined
      ? undefined
      : validateChapterWorkflowBinding(input.chapterWorkflow);
  const bindingSources = await chapterWorkflowBindingSources(binding);
  const execute = input.execute ?? executeAiTask;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_CHAPTER_SCENE_PLAN_ATTEMPTS; attempt += 1) {
    try {
      const attemptIdentity = attempt === 1 ? '' : `:retry:${attempt}`;
      const parsed = await execute({
        operationId: input.operationId + attemptIdentity,
        traceId: input.operationId + attemptIdentity,
        taskType: CHAPTER_SCENE_PLAN_V2_TASK_TYPE,
        scopeType: 'chapter',
        novelId: input.novelId,
        chapterId: input.chapterId,
        settings: input.settings,
        compilation: {
          taskInput: {
            chapterTitle,
            targetWordCount,
            scenePlanVersion: 2,
            maxScenes: MAX_CHAPTER_SCENES,
            contextHash: input.snapshot.contextHash,
            snapshotId: input.snapshot.id,
            ...(binding === undefined ? {} : { chapterWorkflow: binding }),
          },
          sources: [
            {
              sourceType: 'request_context',
              sourceId: input.snapshot.id,
              sourceVersion: input.snapshot.contextHash,
              origin: 'request',
              label: '冻结章节上下文（Scene-only v2 规划）',
              content: compiledPromptText,
              order: 0,
              priority: 100,
              required: true,
              requireFull: true,
              maxTokens: 56_000,
            },
            ...bindingSources,
          ],
        },
        parseStructuredPayload: (text) => parseChapterScenePlanV2Candidate(text),
        signal: input.signal,
      });
      const payload =
        parsed.structuredPayloadJson &&
        typeof parsed.structuredPayloadJson === 'object' &&
        Array.isArray((parsed.structuredPayloadJson as { scenes?: unknown }).scenes)
          ? (parsed.structuredPayloadJson as { scenes: unknown[] })
          : parseChapterScenePlanV2Candidate(parsed.text);
      if (!payload) {
        return invalid('Scene 候选不是有效 JSON，请重试或调整上下文。');
      }
      const plan = normalizeChapterScenePlanV2Candidate(payload, input.chapter, targetWordCount);
      return {
        ...plan,
        rawText: parsed.text,
        taskId: parsed.taskId,
        execution: parsed,
      };
    } catch (error: unknown) {
      lastError = error;
      if (
        attempt >= MAX_CHAPTER_SCENE_PLAN_ATTEMPTS ||
        !isRetryableChapterScenePlanV2Error(error) ||
        input.signal?.aborted
      ) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Scene 候选生成失败。');
}
