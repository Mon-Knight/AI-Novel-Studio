import type { AiSettings } from '../../types/ai';
import type { ChapterWorkflowBindingV1 } from '../../types/chapterWorkflowBinding';
import {
  chapterWorkflowBindingSources,
  validateChapterWorkflowBinding,
} from '../generation/chapterWorkflowBinding';
import {
  SCENE_PLAN_VERSION_V2,
  type SceneBeat,
  type ScenePlanItem,
} from '../../types/chapterEngineering';
import type { SceneBeatPlan } from '../../types/chapterWritingWorkflow';
import { normalizeSceneBeatList } from '../engineering/chapterEngineeringService';
import { ChapterWritingWorkflowError } from '../generation/chapterWritingState';
import { executeAiTask, type AiExecutionResult } from './aiExecutionPipeline';
import { isAiRequestCancelled } from './aiCancellation';
import {
  distributeSceneBeatTargetCharacters,
  expectedSceneBeatCount,
  resolveSceneBeatPlanningPolicy,
  type SceneBeatPlanningPolicy,
  type ResolvedSceneBeatPlanningPolicy,
} from './chapterBeatPlanPolicy';
import {
  beatsFromPayload,
  parseJsonCandidate,
  type ChapterPlanningTaskExecutor,
} from './chapterPlanningCandidate';
import { canonicalHash, sha256, stableCanonicalJson } from './compilation/canonical';

export const CHAPTER_BEAT_PLAN_TASK_TYPE = 'chapter_beat_plan_generate' as const;
export const MAX_SCENE_BEAT_PLAN_ATTEMPTS = 3;
export const MAX_ACTUAL_PREFIX_CHARACTERS = 1_800;

export interface SceneBeatPlanActualContext {
  /** Exact accepted chapter prose before this Scene. Empty is valid for the opening Scene. */
  acceptedProse: string;
  /** Actual state immediately before this Scene, not the Scene plan's expected state. */
  actualEntryState: string;
}

export interface GenerateSceneBeatPlanInput {
  novelId: string;
  chapterId: string;
  operationId: string;
  settings: AiSettings;
  chapterTitle?: string;
  scene: ScenePlanItem;
  /** Frozen core baseline (world, characters, viewpoint, information boundary). */
  sourceContext: string;
  actual: SceneBeatPlanActualContext;
  policy?: SceneBeatPlanningPolicy;
  /** Beat prose calls still available for this Scene; insufficient budget fails closed. */
  remainingCalls?: number;
  chapterWorkflow?: ChapterWorkflowBindingV1;
  signal?: AbortSignal;
  /** Test seam only; production always uses the governed executor. */
  execute?: ChapterPlanningTaskExecutor;
}

export interface SceneBeatPlanResult extends SceneBeatPlan {
  rawText: string;
  taskId?: string;
  execution: AiExecutionResult;
  policy: ResolvedSceneBeatPlanningPolicy;
}

function invalid(message: string, code = 'CHAPTER_BEAT_PLAN_INVALID'): never {
  throw new ChapterWritingWorkflowError(code, message);
}

export function parseSceneBeatPlanCandidate(text: string): { beats: unknown[] } | undefined {
  const beats = beatsFromPayload(parseJsonCandidate(text));
  return beats?.length ? { beats } : undefined;
}

function sceneBaseline(scene: ScenePlanItem): Omit<ScenePlanItem, 'beats'> {
  return {
    id: scene.id,
    sceneNo: scene.sceneNo,
    title: scene.title,
    location: scene.location,
    characters: [...scene.characters],
    goal: scene.goal,
    conflict: scene.conflict,
    keyActions: [...scene.keyActions],
    keyDialogue: scene.keyDialogue,
    informationRelease: [...scene.informationRelease],
    result: scene.result,
    transition: scene.transition,
    contextCapsule: scene.contextCapsule,
    constraints: scene.constraints ? [...scene.constraints] : [],
    expectedEndState: scene.expectedEndState,
    targetCharacters: scene.targetCharacters,
    planVersion: SCENE_PLAN_VERSION_V2,
  };
}

function actualPrefixTail(acceptedProse: string, previousTextHash: string): string {
  const text = acceptedProse.trim();
  if (!text) return '（本章尚无已接受正文；本 Scene 是当前候选的开场）';
  if (text.length <= MAX_ACTUAL_PREFIX_CHARACTERS) return text;
  return [
    `[已截断：仅提供已接受前缀的最后 ${MAX_ACTUAL_PREFIX_CHARACTERS} 个字符，完整前缀 ${acceptedProse.length} 字符，完整 SHA-256 ${previousTextHash}]`,
    text.slice(-MAX_ACTUAL_PREFIX_CHARACTERS),
  ].join('\n');
}

function normalizePlannedBeats(
  rawBeats: unknown[],
  sceneId: string,
  expectedCount: number,
  targets: number[],
  actualEntryState: string,
): SceneBeat[] {
  rawBeats.forEach((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return invalid(`Beat ${index + 1} 不是有效对象。`);
    }
    const raw = value as Partial<SceneBeat>;
    if (
      raw.order !== index + 1 ||
      typeof raw.required !== 'boolean' ||
      typeof raw.stateChange !== 'string' ||
      !raw.stateChange.trim() ||
      (index > 0 && (typeof raw.startState !== 'string' || !raw.startState.trim()))
    ) {
      return invalid(`Beat ${index + 1} 必须明确有序编号、required、stateChange 和开始状态。`);
    }
  });
  const normalized = normalizeSceneBeatList(rawBeats);
  if (normalized.length !== expectedCount) {
    return invalid(
      `当前 Scene 必须恰好规划 ${expectedCount} 个 Beat，模型返回了 ${normalized.length} 个有效 Beat。`,
    );
  }
  return normalized.map((beat, index) => ({
    ...beat,
    // Plan identity must be deterministic so an unchanged plan keeps the same hash.
    id: `${sceneId}:beat:${index + 1}`,
    order: index + 1,
    targetCharacters: targets[index],
    ...(index === 0 && !beat.startState ? { startState: actualEntryState } : {}),
  }));
}

export function isRetryableSceneBeatPlanError(error: unknown): boolean {
  if (isAiRequestCancelled(error)) return false;
  if (error instanceof ChapterWritingWorkflowError) {
    return error.code === 'CHAPTER_BEAT_PLAN_INVALID';
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
  return /(?:模型返回空内容|输出 Token 上限处停止|不是有效 JSON|Beat 候选|Beat 数)/.test(message);
}

export async function generateSceneBeatPlan(
  input: GenerateSceneBeatPlanInput,
): Promise<SceneBeatPlanResult> {
  const { scene } = input;
  if (scene.planVersion !== SCENE_PLAN_VERSION_V2) {
    invalid('Beat 规划只接受 Scene-only v2 场景。', 'CHAPTER_BEAT_PLAN_SCENE_INVALID');
  }
  if (scene.beats.length > 0) {
    invalid(
      '当前 Scene 已包含 Beats；不得用新的 Beat 计划覆盖既有计划。',
      'CHAPTER_BEAT_PLAN_SCENE_INVALID',
    );
  }
  if (!scene.id.trim()) {
    invalid('当前 Scene 缺少稳定 ID。', 'CHAPTER_BEAT_PLAN_SCENE_INVALID');
  }
  if (!input.sourceContext.trim()) {
    invalid('Beat 规划缺少冻结基线材料。', 'CHAPTER_BEAT_PLAN_CONTEXT_MISSING');
  }
  const actualEntryState = input.actual.actualEntryState.trim();
  if (!actualEntryState) {
    invalid('Beat 规划缺少实际入口状态。', 'CHAPTER_BEAT_PLAN_CONTEXT_MISSING');
  }
  const sourceContextHash = await sha256(input.sourceContext);
  const previousTextHash = await sha256(input.actual.acceptedProse);
  // Match the shared workflow helper: bind the exact caller-supplied entry state.
  const inputStateHash = await sha256(input.actual.actualEntryState);
  const policy = resolveSceneBeatPlanningPolicy(input.policy);
  const sceneTargetCharacters = scene.targetCharacters ?? policy.targetCharactersPerBeat;
  const targetBeatCount = expectedSceneBeatCount(
    sceneTargetCharacters,
    policy,
    input.remainingCalls,
  );
  const targets = distributeSceneBeatTargetCharacters(
    sceneTargetCharacters,
    targetBeatCount,
    policy,
  );
  const baseline = sceneBaseline(scene);
  const acceptedProseTail = actualPrefixTail(input.actual.acceptedProse, previousTextHash);
  const actualSource = {
    acceptedProseTail,
    acceptedProseCharacters: input.actual.acceptedProse.length,
    acceptedProseTruncated: acceptedProseTail.startsWith('[已截断'),
    previousTextHash,
    actualEntryState,
    inputStateHash,
  };
  const requestContext = stableCanonicalJson({
    scene: baseline,
    actual: actualSource,
    planning: {
      targetBeatCount,
      beatTargetCharacters: targets,
      minimumBeatCharacters: policy.minBeatCharacters,
      maximumBeatCharacters: policy.maxBeatCharacters,
    },
  });
  const binding =
    input.chapterWorkflow === undefined
      ? undefined
      : validateChapterWorkflowBinding(input.chapterWorkflow);
  const bindingSources = await chapterWorkflowBindingSources(binding);
  const execute = input.execute ?? executeAiTask;
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_SCENE_BEAT_PLAN_ATTEMPTS; attempt += 1) {
    try {
      const attemptIdentity = attempt === 1 ? '' : `:retry:${attempt}`;
      const parsed = await execute({
        operationId: input.operationId + attemptIdentity,
        traceId: input.operationId + attemptIdentity,
        taskType: CHAPTER_BEAT_PLAN_TASK_TYPE,
        scopeType: 'chapter',
        novelId: input.novelId,
        chapterId: input.chapterId,
        settings: input.settings,
        compilation: {
          taskInput: {
            chapterTitle: input.chapterTitle?.trim() || '',
            sceneId: scene.id,
            sceneNo: scene.sceneNo,
            sceneTargetCharacters,
            targetBeatCount,
            minimumBeatCharacters: policy.minBeatCharacters,
            maximumBeatCharacters: policy.maxBeatCharacters,
            targetCharactersPerBeat: targets,
            sourceContextHash,
            previousTextHash,
            inputStateHash,
            ...(binding === undefined ? {} : { chapterWorkflow: binding }),
          },
          sources: [
            {
              sourceType: 'request_context',
              sourceId: `${scene.id}:baseline`,
              sourceVersion: sourceContextHash,
              origin: 'request',
              label: '冻结核心基线（人物、世界规则、视角与信息边界）',
              content: input.sourceContext,
              order: 0,
              priority: 100,
              required: true,
              requireFull: true,
              maxTokens: 48_000,
            },
            {
              sourceType: 'request_context',
              sourceId: `${scene.id}:actual`,
              sourceVersion: inputStateHash,
              origin: 'request',
              label: '当前 Scene 与实际已写状态（完整前缀以哈希绑定）',
              content: requestContext,
              order: 1,
              priority: 100,
              required: true,
              requireFull: true,
              maxTokens: 8_000,
            },
            ...bindingSources,
          ],
        },
        parseStructuredPayload: (text) => parseSceneBeatPlanCandidate(text),
        signal: input.signal,
      });
      const payload =
        parsed.structuredPayloadJson &&
        typeof parsed.structuredPayloadJson === 'object' &&
        Array.isArray((parsed.structuredPayloadJson as { beats?: unknown }).beats)
          ? (parsed.structuredPayloadJson as { beats: unknown[] })
          : parseSceneBeatPlanCandidate(parsed.text);
      if (!payload) {
        return invalid('Beat 候选不是有效 JSON，请重试或调整上下文。');
      }
      const beats = normalizePlannedBeats(
        payload.beats,
        scene.id,
        targetBeatCount,
        targets,
        actualEntryState,
      );
      const planHash = await canonicalHash({
        schemaVersion: 1,
        scene,
        sourceContextHash,
        previousTextHash,
        inputStateHash,
        beats,
      });
      return {
        schemaVersion: 1,
        sceneId: scene.id,
        sourceContextHash,
        previousTextHash,
        inputStateHash,
        beats,
        planHash,
        rawText: parsed.text,
        taskId: parsed.taskId,
        execution: parsed,
        policy,
      };
    } catch (error: unknown) {
      lastError = error;
      if (
        attempt >= MAX_SCENE_BEAT_PLAN_ATTEMPTS ||
        !isRetryableSceneBeatPlanError(error) ||
        input.signal?.aborted
      ) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Beat 候选生成失败。');
}
