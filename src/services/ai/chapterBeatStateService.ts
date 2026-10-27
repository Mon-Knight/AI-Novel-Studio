import type { AiSettings } from '../../types/ai';
import type { ChapterWorkflowBindingV1 } from '../../types/chapterWorkflowBinding';
import {
  chapterWorkflowBindingSources,
  validateChapterWorkflowBinding,
} from '../generation/chapterWorkflowBinding';
import type { ActualBeatState } from '../../types/chapterWritingWorkflow';
import {
  ChapterWritingWorkflowError,
  validateActualBeatState,
} from '../generation/chapterWritingState';
import { executeAiTask, type AiExecutionResult } from './aiExecutionPipeline';
import { throwIfAiRequestCancelled } from './aiCancellation';
import { parseJsonCandidate, type ChapterPlanningTaskExecutor } from './chapterPlanningCandidate';
import { isPlainRecord, sha256, stableCanonicalJson } from './compilation/canonical';

export const CHAPTER_BEAT_STATE_EXTRACT_TASK_TYPE = 'chapter_beat_state_extract' as const;

/**
 * State extraction reads only the exact Beat prose and the actual state that
 * preceded it. Plans, expected end states and later Scenes are intentionally
 * absent so the model cannot turn planned outcomes into observed facts.
 */
export const CHAPTER_BEAT_STATE_CONTEXT_LABEL = '当前 Beat 正文与进入前的实际状态';

export interface ExtractActualBeatStateInput {
  novelId: string;
  chapterId: string;
  operationId: string;
  settings: AiSettings;
  /** Exact immutable prose of the current Beat. Never trimmed before hashing. */
  prose: string;
  /** Rendered actual state before this Beat, if one was recorded. */
  previousState?: string;
  sceneNo?: number;
  beatOrder?: number;
  chapterWorkflow?: ChapterWorkflowBindingV1;
  signal?: AbortSignal;
  /** Test seam only; production always uses the governed executor. */
  execute?: ChapterPlanningTaskExecutor;
}

export interface ActualBeatStateExtractionResult {
  state: ActualBeatState;
  execution: AiExecutionResult;
  taskId?: string;
  attemptId?: string;
}

function invalid(message: string): never {
  throw new ChapterWritingWorkflowError('CHAPTER_BEAT_STATE_INVALID', message);
}

function requiredText(value: string | undefined, label: string): string {
  if (typeof value !== 'string' || !value.trim()) return invalid(`${label} 不能为空。`);
  return value;
}

function optionalPositiveInteger(value: number | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value <= 0) {
    return invalid(`${label} 必须是正整数。`);
  }
  return value;
}

function payloadFromResult(result: AiExecutionResult): unknown {
  if (isPlainRecord(result.structuredPayloadJson)) return result.structuredPayloadJson;
  const parsed = parseJsonCandidate(result.text);
  if (!parsed) return invalid('模型未返回有效的实际状态 JSON。');
  return parsed;
}

export async function extractActualBeatState(
  input: ExtractActualBeatStateInput,
): Promise<ActualBeatStateExtractionResult> {
  throwIfAiRequestCancelled(input.signal);
  const prose = requiredText(input.prose, '当前 Beat 正文');
  const novelId = requiredText(input.novelId, 'novelId').trim();
  const chapterId = requiredText(input.chapterId, 'chapterId').trim();
  const operationId = requiredText(input.operationId, 'operationId').trim();
  const sceneNo = optionalPositiveInteger(input.sceneNo, 'sceneNo');
  const beatOrder = optionalPositiveInteger(input.beatOrder, 'beatOrder');
  const previousState = input.previousState?.trim() ? input.previousState.trim() : null;
  const sourceTextHash = await sha256(prose);
  // Stable projection keeps the context limited to actual prose input. Do not
  // add the plan, expected end state or later Scene material here.
  const contextText = stableCanonicalJson({
    previousState,
    prose,
  });
  const binding =
    input.chapterWorkflow === undefined
      ? undefined
      : validateChapterWorkflowBinding(input.chapterWorkflow);
  const bindingSources = await chapterWorkflowBindingSources(binding);
  const execute = input.execute ?? executeAiTask;
  const result = await execute({
    operationId,
    traceId: operationId,
    taskType: CHAPTER_BEAT_STATE_EXTRACT_TASK_TYPE,
    scopeType: 'chapter',
    novelId,
    chapterId,
    settings: input.settings,
    compilation: {
      taskInput: {
        sourceTextHash,
        ...(sceneNo === undefined ? {} : { sceneNo }),
        ...(beatOrder === undefined ? {} : { beatOrder }),
        ...(binding === undefined ? {} : { chapterWorkflow: binding }),
      },
      sources: [
        {
          sourceType: 'request_context',
          sourceId: `${chapterId}:beat-state:${sceneNo ?? 0}:${beatOrder ?? 0}`,
          sourceVersion: sourceTextHash,
          origin: 'request',
          label: CHAPTER_BEAT_STATE_CONTEXT_LABEL,
          content: contextText,
          order: 0,
          priority: 100,
          required: true,
          requireFull: true,
          maxTokens: 24_000,
        },
        ...bindingSources,
      ],
    },
    parseStructuredPayload: (text) => parseJsonCandidate(text),
    signal: input.signal,
  });
  throwIfAiRequestCancelled(input.signal);
  const state = await validateActualBeatState(payloadFromResult(result), prose);
  return {
    state,
    execution: result,
    ...(result.taskId ? { taskId: result.taskId } : {}),
    ...(result.attemptId ? { attemptId: result.attemptId } : {}),
  };
}
