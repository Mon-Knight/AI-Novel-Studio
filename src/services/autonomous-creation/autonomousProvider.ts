import { createAiClient, aiSettingsService } from '../ai/aiClient';
import { isAiRequestCancelled } from '../ai/aiCancellation';
import { aiTaskService } from '../ai/aiTaskService';
import {
  createProviderTransportRequestId,
  resolveProviderTimeoutSeconds,
} from '../ai/providerRequestPolicy';
import type { AiGenerateRequest, AiTaskType } from '../../types/ai';
import type {
  AutonomousCharacterPlan,
  AutonomousChapterPlan,
  AutonomousConflictThread,
  AutonomousPacingPoint,
  AutonomousStoryArc,
  AutonomousStoryBible,
  AutonomousStoryBrief,
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
    signal?: AbortSignal;
  }): Promise<AutonomousProviderResult<PlotFoundationProposal>>;
  planCharacters(input: {
    novelId: string;
    operationId: string;
    brief: AutonomousStoryBrief;
    storyBible: AutonomousStoryBible;
    arcs: AutonomousStoryArc[];
    signal?: AbortSignal;
  }): Promise<AutonomousProviderResult<CharacterProposal[]>>;
  buildWorld(input: {
    novelId: string;
    operationId: string;
    brief: AutonomousStoryBrief;
    storyBible: AutonomousStoryBible;
    arcs: AutonomousStoryArc[];
    volumes: AutonomousVolumePlan[];
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
    signal?: AbortSignal;
  }): Promise<AutonomousProviderResult<ConflictProposal[]>>;
  controlPacing(input: {
    novelId: string;
    operationId: string;
    brief: AutonomousStoryBrief;
    storyBible: AutonomousStoryBible;
    arcs: AutonomousStoryArc[];
    volumes: AutonomousVolumePlan[];
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
  const task = await aiTaskService.create(input.taskType, {
    novelId: input.novelId,
    runtimeMode: settings.runtimeMode,
    provider: settings.provider,
    modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
    inputSummary: input.summary,
  });
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  input.signal?.addEventListener('abort', onExternalAbort, { once: true });
  if (input.signal?.aborted) onExternalAbort();
  const releaseCancellation = aiTaskService.registerActiveExecution(task.id, () =>
    controller.abort(),
  );

  try {
    const requestSettings = {
      ...settings,
      timeoutSeconds: resolveProviderTimeoutSeconds(input.taskType, settings.timeoutSeconds),
    };
    const response = await createAiClient(requestSettings).generate(input.request, {
      signal: controller.signal,
      requestId: createProviderTransportRequestId(input.requestId),
      cancel: () => controller.abort(),
    });
    const responseText = response.text || '';
    const finishReason = readFinishReason(response.raw);
    if (finishReason === 'length') {
      throw new Error(
        'AI 调用失败：模型在输出 Token 上限处停止，响应内容不完整且未采纳；' +
          '请缩小单次输出或提高最大输出 Token 后重试。',
      );
    }
    const tokensInput = response.tokenInput ?? 0;
    const tokensOutput = response.tokenOutput ?? 0;
    const tokensUsed = response.tokenTotal ?? tokensInput + tokensOutput;
    let value: T;
    try {
      value = input.parser(responseText);
    } catch (error) {
      if (input.taskType !== 'autonomous_chapter_batch') throw error;
      throw chapterBatchParseError({
        error,
        finishReason,
        responseLength: responseText.length,
        tokensOutput: response.tokenOutput,
      });
    }
    await aiTaskService.markSucceeded(task.id, {
      resultText: input.successText(value),
      tokenInput: tokensInput,
      tokenOutput: tokensOutput,
      tokenTotal: tokensUsed,
    });
    return {
      value,
      aiTaskId: task.id,
      tokensInput,
      tokensOutput,
      tokensUsed,
      durationMs: Math.max(0, Date.now() - startedAt),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (controller.signal.aborted || isAiRequestCancelled(error))
      await aiTaskService.markCancelled(task.id);
    else await aiTaskService.markFailed(task.id, message);
    throw error;
  } finally {
    input.signal?.removeEventListener('abort', onExternalAbort);
    releaseCancellation();
  }
}

export class AiAutonomousCreationProvider implements AutonomousCreationProvider {
  planFoundation(input: Parameters<AutonomousCreationProvider['planFoundation']>[0]) {
    return runProvider({
      ...input,
      taskType: 'autonomous_plot_plan',
      summary: `规划 ${input.brief.targetChapterCount} 章长篇故事基础`,
      requestId: `${input.operationId}-plot-foundation`,
      request: buildPlotFoundationRequest(input.brief, input.shape),
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
