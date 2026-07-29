import { aiSettingsService } from '../ai/aiClient';
import { executeAiTask } from '../ai/aiExecutionPipeline';
import type { AiGenerateRequest } from '../../types/ai';
import type { AiTaskType } from '../../types/ai-task';
import type {
  AutonomousCharacterPlan,
  AutonomousChapterPlan,
  AutonomousConflictThread,
  AutonomousPacingPoint,
  AutonomousStoryArc,
  AutonomousStoryBible,
  AutonomousStoryBrief,
  AutonomousPlanningBaseline,
  AutonomousPlanningMode,
  AutonomousVolumePlan,
  AutonomousWorldElement,
} from '../../types/autonomousCreation';
import {
  buildChapterBatchRequest,
  buildCharacterEvolutionRequest,
  buildConflictGeneratorRequest,
  buildPacingControllerRequest,
  buildPlotFoundationRequest,
  buildWorldBuilderRequest,
} from '../prompt/autonomousCreationPromptBuilder';
import type {
  ChapterProposal,
  CharacterProposal,
  ConflictProposal,
  PacingPhaseProposal,
  PlanShape,
  PlotFoundationProposal,
  WorldElementProposal,
} from './autonomousPlanBuilder';
import {
  parseChapterProposals,
  parseCharacterProposals,
  parseConflictProposals,
  parsePacingPhaseProposals,
  parsePlotFoundation,
  parseWorldElementProposals,
} from './autonomousResponseParser';
import { createAutonomousChapterBatchRequestId } from './autonomousChapterBatchPolicy';

export interface AutonomousProviderResult<T> {
  value: T;
  aiTaskId: string;
  tokensInput: number;
  tokensOutput: number;
  tokensUsed: number;
  durationMs: number;
}

export interface AutonomousCreationProvider {
  planFoundation(input: {
    novelId: string;
    operationId: string;
    brief: AutonomousStoryBrief;
    shape: PlanShape;
    planningMode?: AutonomousPlanningMode;
    baseline?: AutonomousPlanningBaseline;
    signal?: AbortSignal;
  }): Promise<AutonomousProviderResult<PlotFoundationProposal>>;
  planCharacters(input: {
    novelId: string;
    operationId: string;
    brief: AutonomousStoryBrief;
    storyBible: AutonomousStoryBible;
    arcs: AutonomousStoryArc[];
    planningMode?: AutonomousPlanningMode;
    baseline?: AutonomousPlanningBaseline;
    signal?: AbortSignal;
  }): Promise<AutonomousProviderResult<CharacterProposal[]>>;
  buildWorld(input: {
    novelId: string;
    operationId: string;
    brief: AutonomousStoryBrief;
    storyBible: AutonomousStoryBible;
    arcs: AutonomousStoryArc[];
    volumes: AutonomousVolumePlan[];
    planningMode?: AutonomousPlanningMode;
    baseline?: AutonomousPlanningBaseline;
    signal?: AbortSignal;
  }): Promise<AutonomousProviderResult<WorldElementProposal[]>>;
  generateConflicts(input: {
    novelId: string;
    operationId: string;
    brief: AutonomousStoryBrief;
    storyBible: AutonomousStoryBible;
    arcs: AutonomousStoryArc[];
    volumes: AutonomousVolumePlan[];
    characters: AutonomousCharacterPlan[];
    planningMode?: AutonomousPlanningMode;
    baseline?: AutonomousPlanningBaseline;
    signal?: AbortSignal;
  }): Promise<AutonomousProviderResult<ConflictProposal[]>>;
  controlPacing(input: {
    novelId: string;
    operationId: string;
    brief: AutonomousStoryBrief;
    storyBible: AutonomousStoryBible;
    arcs: AutonomousStoryArc[];
    volumes: AutonomousVolumePlan[];
    planningMode?: AutonomousPlanningMode;
    baseline?: AutonomousPlanningBaseline;
    signal?: AbortSignal;
  }): Promise<AutonomousProviderResult<PacingPhaseProposal[]>>;
  planChapterBatch(input: {
    novelId: string;
    operationId: string;
    brief: AutonomousStoryBrief;
    storyBible: AutonomousStoryBible;
    volume: AutonomousVolumePlan;
    arcs: AutonomousStoryArc[];
    characters: AutonomousCharacterPlan[];
    worldElements: AutonomousWorldElement[];
    conflicts: AutonomousConflictThread[];
    pacingPoints: AutonomousPacingPoint[];
    previousChapters: Array<
      Pick<AutonomousChapterPlan, 'chapterNumber' | 'title' | 'goal' | 'endingHook'>
    >;
    planningMode?: AutonomousPlanningMode;
    baseline?: AutonomousPlanningBaseline;
    signal?: AbortSignal;
  }): Promise<AutonomousProviderResult<ChapterProposal[]>>;
}

type Parser<T> = (text: string) => T;

function readFinishReason(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const choices = (raw as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return undefined;
  const value = (first as Record<string, unknown>).finish_reason;
  return typeof value === 'string' && /^[a-z0-9_-]{1,128}$/i.test(value) ? value : undefined;
}

function chapterBatchParseError(input: {
  error: unknown;
  finishReason?: string;
  responseLength: number;
  tokensOutput?: number;
}): Error {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  const tokenText = typeof input.tokensOutput === 'number' ? String(input.tokensOutput) : 'unknown';
  return new Error(
    `${message}（响应诊断：finish_reason=${input.finishReason ?? 'unknown'}，` +
      `字符数=${input.responseLength}，输出 Token=${tokenText}）`,
  );
}

async function runProvider<T>(input: {
  novelId: string;
  operationId: string;
  taskType: AiTaskType;
  summary: string;
  requestId: string;
  request: AiGenerateRequest;
  parser: Parser<T>;
  successText: (value: T) => string;
  signal?: AbortSignal;
}): Promise<AutonomousProviderResult<T>> {
  const startedAt = Date.now();
  const settings = aiSettingsService.getSettings();
  const userMessage =
    input.request.messages.find((message) => message.role === 'user')?.content ?? '';
  const payloadStart = userMessage.indexOf('{');
  if (payloadStart < 0) throw new Error('autonomous request payload is missing');
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(userMessage.slice(payloadStart)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('autonomous request payload must be an object');
    }
    payload = parsed as Record<string, unknown>;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }

  const execution = await executeAiTask({
    operationId: input.requestId,
    traceId: input.requestId,
    taskType: input.taskType,
    scopeType: 'novel',
    novelId: input.novelId,
    targetHintJson: { summary: input.summary },
    settings,
    compilation: {
      taskInput: { payload },
      sources: [
        {
          sourceType: 'request_context',
          sourceId: input.requestId,
          sourceVersion: '1',
          origin: 'request',
          label: 'Autonomous request payload',
          content: JSON.stringify({
            taskType: input.taskType,
            operationId: input.operationId,
            summary: input.summary,
          }),
          order: 0,
          priority: 100,
          maxTokens: 48_000,
        },
      ],
    },
    signal: input.signal,
  });
  const responseText = execution.text || '';
  const finishReason = execution.provider.finishReason ?? readFinishReason(execution.provider.raw);
  if (finishReason === 'length') {
    throw new Error(
      'AI 调用失败：模型在输出 Token 上限处停止，响应内容不完整且未采纳；' +
        '请缩小单次输出或提高最大输出 Token 后重试。',
    );
  }
  const tokensInput = execution.provider.tokenInput ?? 0;
  const tokensOutput = execution.provider.tokenOutput ?? 0;
  const tokensUsed = execution.provider.tokenTotal ?? tokensInput + tokensOutput;
  let value: T;
  try {
    value = input.parser(responseText);
  } catch (error) {
    if (input.taskType !== 'autonomous_chapter_batch') throw error;
    throw chapterBatchParseError({
      error,
      finishReason,
      responseLength: responseText.length,
      tokensOutput: execution.provider.tokenOutput,
    });
  }
  return {
    value,
    aiTaskId: execution.taskId ?? input.requestId,
    tokensInput,
    tokensOutput,
    tokensUsed,
    durationMs: execution.provider.durationMs || Math.max(0, Date.now() - startedAt),
  };
}

export class AiAutonomousCreationProvider implements AutonomousCreationProvider {
  planFoundation(input: Parameters<AutonomousCreationProvider['planFoundation']>[0]) {
    return runProvider({
      ...input,
      taskType: 'autonomous_plot_plan',
      summary: `规划 ${input.brief.targetChapterCount} 章长篇故事基础`,
      requestId: `${input.operationId}-plot-foundation`,
      request: buildPlotFoundationRequest(input.brief, input.shape, {
        planningMode: input.planningMode,
        baseline: input.baseline,
      }),
      parser: parsePlotFoundation,
      successText: (value) => `生成 ${value.arcs.length} 个故事弧与 ${value.volumes.length} 个分卷`,
    });
  }

  planCharacters(input: Parameters<AutonomousCreationProvider['planCharacters']>[0]) {
    return runProvider({
      ...input,
      taskType: 'autonomous_character_evolution',
      summary: '规划全书人物成长弧线',
      requestId: `${input.operationId}-character-evolution`,
      request: buildCharacterEvolutionRequest(input),
      parser: parseCharacterProposals,
      successText: (value) => `生成 ${value.length} 条人物成长弧线`,
    });
  }

  buildWorld(input: Parameters<AutonomousCreationProvider['buildWorld']>[0]) {
    return runProvider({
      ...input,
      taskType: 'autonomous_world_build',
      summary: '规划全书世界观扩展节点',
      requestId: `${input.operationId}-world-builder`,
      request: buildWorldBuilderRequest(input),
      parser: parseWorldElementProposals,
      successText: (value) => `生成 ${value.length} 个世界元素`,
    });
  }

  generateConflicts(input: Parameters<AutonomousCreationProvider['generateConflicts']>[0]) {
    return runProvider({
      ...input,
      taskType: 'autonomous_conflict_generate',
      summary: '规划全书冲突升级与回收路径',
      requestId: `${input.operationId}-conflict-generator`,
      request: buildConflictGeneratorRequest(input),
      parser: parseConflictProposals,
      successText: (value) => `生成 ${value.length} 条冲突线程`,
    });
  }

  controlPacing(input: Parameters<AutonomousCreationProvider['controlPacing']>[0]) {
    return runProvider({
      ...input,
      taskType: 'autonomous_pacing_control',
      summary: '规划全书叙事节奏曲线',
      requestId: `${input.operationId}-pacing-controller`,
      request: buildPacingControllerRequest(input),
      parser: parsePacingPhaseProposals,
      successText: (value) => `生成 ${value.length} 个节奏阶段`,
    });
  }

  planChapterBatch(input: Parameters<AutonomousCreationProvider['planChapterBatch']>[0]) {
    return runProvider({
      ...input,
      taskType: 'autonomous_chapter_batch',
      summary: `展开 ${input.volume.title} 第 ${input.volume.chapterStart}-${input.volume.chapterEnd} 章`,
      requestId: createAutonomousChapterBatchRequestId({
        operationId: input.operationId,
        volumeIndex: input.volume.index,
        chapterStart: input.volume.chapterStart,
        chapterEnd: input.volume.chapterEnd,
      }),
      request: buildChapterBatchRequest(input),
      parser: parseChapterProposals,
      successText: (value) => `生成 ${value.length} 个章节计划`,
    });
  }
}
