import { aiSettingsService } from '../ai/aiSettingsService';
import { aiTaskService } from '../ai/aiTaskService';
import { executeAiTask } from '../ai/aiExecutionPipeline';
import { novelRepository } from '../database/novelRepository';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import type { AiGenerateRequest, AiTaskType as LegacyAiTaskType } from '../../types/ai';
import type { AiContextSourceInput } from '../../types/aiCompilation';
import type { AiTaskScope, AiTaskType } from '../../types/ai-task';

export type AutonomousProviderTaskType = Extract<
  AiTaskType,
  | 'outline_generate'
  | 'chapter_generate'
  | 'chapter_rewrite'
  | 'chapter_polish'
  | 'chapter_summary'
  | 'quality_check'
  | 'continuity_check'
  | 'expert_review'
>;

export interface AutonomousProviderResult {
  taskId: string;
  attemptId?: string;
  artifactId?: string;
  text: string;
  structured?: unknown;
  providerId: string;
  modelId: string;
  tokenInput: number;
  tokenOutput: number;
  tokenTotal: number;
  durationMs: number;
}

export interface AutonomousProviderInput {
  taskType: AutonomousProviderTaskType;
  novelId: string;
  chapterId?: string;
  draftId?: string;
  scopeType?: AiTaskScope;
  operationId: string;
  traceId?: string;
  inputSummary: string;
  sources?: AiContextSourceInput[];
  taskInput?: Record<string, unknown>;
  systemPrompt?: string;
  userPrompt?: string;
  request?: AiGenerateRequest;
  maxTokens?: number;
  signal?: AbortSignal;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) candidates.push(fenced);
  const firstObject = trimmed.indexOf('{');
  const lastObject = trimmed.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) {
    candidates.push(trimmed.slice(firstObject, lastObject + 1));
  }
  const firstArray = trimmed.indexOf('[');
  const lastArray = trimmed.lastIndexOf(']');
  if (firstArray >= 0 && lastArray > firstArray) {
    candidates.push(trimmed.slice(firstArray, lastArray + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Providers occasionally wrap JSON in prose; try the next candidate.
    }
  }
  return undefined;
}

function requestContext(input: AutonomousProviderInput): string {
  if (input.request) {
    return JSON.stringify({ messages: input.request.messages });
  }
  return [
    input.systemPrompt ? `【调用约束】\n${input.systemPrompt}` : '',
    input.userPrompt ? `【任务输入】\n${input.userPrompt}` : '',
  ].filter(Boolean).join('\n\n');
}

async function buildSources(input: AutonomousProviderInput): Promise<{
  sources: AiContextSourceInput[];
  sourceDraftVersion?: number;
  baseContentHash?: string;
}> {
  const supplied = input.sources ? [...input.sources] : [];
  const sourceTypes = new Set(supplied.map((source) => source.sourceType));
  let order = supplied.reduce((max, source) => Math.max(max, source.order), -1) + 1;

  if (!sourceTypes.has('novel')) {
    const novel = await novelRepository.getById(input.novelId);
    if (!novel) throw new Error(`Novel ${input.novelId} not found`);
    supplied.push({
      sourceType: 'novel',
      sourceId: input.novelId,
      sourceVersion: novel.updatedAt || novel.createdAt || '1',
      origin: 'sqlite',
      label: '作品事实',
      content: JSON.stringify({
        title: novel.title,
        genre: novel.genre,
        description: novel.description,
        outline: novel.outline,
        mainCharacter: novel.mainCharacter,
        protagonistAbility: novel.protagonistAbility,
      }),
      order: order++,
      priority: 100,
      required: true,
    });
  }

  if (input.chapterId && !sourceTypes.has('chapter')) {
    const chapter = await chapterRepository.getById(input.chapterId);
    if (!chapter || chapter.novelId !== input.novelId) {
      throw new Error(`Chapter ${input.chapterId} does not belong to novel ${input.novelId}`);
    }
    supplied.push({
      sourceType: 'chapter',
      sourceId: input.chapterId,
      sourceVersion: chapter.updatedAt || chapter.createdAt || '1',
      origin: 'sqlite',
      label: '目标章节事实',
      content: JSON.stringify({
        title: chapter.title,
        outline: chapter.outline,
        goal: chapter.goal,
        orderIndex: chapter.orderIndex,
        targetWordCount: chapter.targetWordCount,
      }),
      order: order++,
      priority: 95,
      required: true,
    });
  }

  let sourceDraftVersion: number | undefined;
  let baseContentHash: string | undefined;
  if (input.draftId) {
    if (!input.chapterId) throw new Error('Draft-scoped autonomous task requires chapterId');
    const drafts = await draftVersionService.getByChapterId(input.chapterId);
    const draft = drafts.find((candidate) => candidate.id === input.draftId);
    if (!draft || draft.novelId !== input.novelId) {
      throw new Error(`Draft ${input.draftId} does not belong to the requested scope`);
    }
    sourceDraftVersion = draft.versionNo;
    baseContentHash = await computeContentSha256(draft.content);
    if (!sourceTypes.has('draft')) {
      supplied.push({
        sourceType: 'draft',
        sourceId: draft.id,
        sourceVersion: String(draft.versionNo),
        origin: 'sqlite',
        label: '来源草稿正文',
        content: draft.content,
        order: order++,
        priority: 110,
        required: true,
      });
    }
  }

  const context = requestContext(input);
  if (context.trim() && !sourceTypes.has('request_context')) {
    const suffix = input.operationId.length > 130
      ? input.operationId.slice(input.operationId.length - 130)
      : input.operationId;
    supplied.push({
      sourceType: 'request_context',
      sourceId: `request:${suffix}`,
      sourceVersion: '1',
      origin: 'request',
      label: '本次自主任务指令',
      content: context,
      order: order++,
      priority: 120,
      required: true,
    });
  }

  return { sources: supplied, sourceDraftVersion, baseContentHash };
}

function inferScope(input: AutonomousProviderInput): AiTaskScope {
  if (input.scopeType) return input.scopeType;
  if (input.draftId) return 'draft';
  if (input.chapterId) return 'chapter';
  return 'novel';
}

export async function runAutonomousProvider(
  input: AutonomousProviderInput,
): Promise<AutonomousProviderResult> {
  const settings = aiSettingsService.getSettings();
  const compiledSources = await buildSources(input);
  const execution = await executeAiTask({
    operationId: input.operationId,
    traceId: input.traceId ?? input.operationId,
    taskType: input.taskType,
    scopeType: inferScope(input),
    novelId: input.novelId,
    chapterId: input.chapterId,
    draftId: input.draftId,
    sourceDraftVersion: compiledSources.sourceDraftVersion,
    baseContentHash: compiledSources.baseContentHash,
    settings,
    compilation: {
      sources: compiledSources.sources,
      taskInput: {
        inputSummary: input.inputSummary,
        requestedMaxTokens: input.maxTokens,
        ...input.taskInput,
      },
    },
    parseStructuredPayload: parseJson,
    signal: input.signal,
  });

  if (
    execution.persistence !== 'sqlite'
    || !execution.taskId
    || !execution.attemptId
    || !execution.artifactBundle
  ) {
    throw new Error('Autonomous Provider requires durable Task/Attempt/Artifact facts');
  }
  const processingStatus = execution.artifactBundle.artifact.processingStatus;
  if (!['valid', 'valid_with_warnings'].includes(processingStatus)) {
    throw new Error(`Autonomous Artifact validation failed: ${processingStatus}`);
  }

  const taskId = execution.taskId;
  const tokenInput = execution.provider.tokenInput ?? 0;
  const tokenOutput = execution.provider.tokenOutput ?? 0;
  const tokenTotal = execution.provider.tokenTotal ?? tokenInput + tokenOutput;

  // Existing chapter_drafts and quality tables still reference the legacy
  // ai_task_records table. Keep a compatibility projection with the same ID;
  // the formal Task/Attempt/Artifact remains the authoritative execution fact.
  await aiTaskService.create(input.taskType as LegacyAiTaskType, {
    id: taskId,
    novelId: input.novelId,
    chapterId: input.chapterId,
    runtimeMode: settings.runtimeMode,
    provider: execution.provider.providerId,
    modelName: execution.provider.modelId,
    inputSummary: `[execution-fact:${taskId}] ${input.inputSummary}`,
  });
  await aiTaskService.markSucceeded(taskId, {
    resultText: `${input.taskType} Artifact ${execution.artifactBundle?.artifact.artifactId ?? 'ephemeral'}`,
    resultJson: execution.structuredPayloadJson === undefined
      ? undefined
      : JSON.stringify(execution.structuredPayloadJson),
    tokenInput,
    tokenOutput,
    tokenTotal,
  });

  return {
    taskId,
    attemptId: execution.attemptId,
    artifactId: execution.artifactBundle.artifact.artifactId,
    text: execution.text,
    structured: execution.structuredPayloadJson,
    providerId: execution.provider.providerId,
    modelId: execution.provider.modelId,
    tokenInput,
    tokenOutput,
    tokenTotal,
    durationMs: execution.provider.durationMs,
  };
}

export function clampTokenTotal(
  result: Pick<AutonomousProviderResult, 'tokenTotal' | 'tokenInput' | 'tokenOutput'>,
): number {
  return result.tokenTotal || result.tokenInput + result.tokenOutput;
}
