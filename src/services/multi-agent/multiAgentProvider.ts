import { createAiClient, aiSettingsService } from '../ai/aiClient';
import { isAiRequestCancelled } from '../ai/aiCancellation';
import { aiTaskService } from '../ai/aiTaskService';
import { createProviderTransportRequestId } from '../ai/providerRequestPolicy';
import { generateId } from '../database/db';
import {
  buildMultiAgentExpertRequest,
  buildMultiAgentRevisionRequest,
} from '../prompt/multiAgentPromptBuilder';
import type {
  DraftRevisionRequest,
  DraftRevisionResult,
  ExpertOpinion,
  ExpertReviewRequest,
} from '../../types/multiAgent';
import { getExpertLabel } from './expertRegistry';
import { parseExpertOpinion } from './multiAgentOpinionParser';

export interface MultiAgentProvider {
  reviewExpert(input: ExpertReviewRequest): Promise<ExpertOpinion>;
  reviseDraft(input: DraftRevisionRequest): Promise<DraftRevisionResult>;
}

function stripAccidentalFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:markdown|text)?\s*([\s\S]*?)```$/i);
  return (fenced?.[1] ?? trimmed).trim();
}

export class AiMultiAgentProvider implements MultiAgentProvider {
  async reviewExpert(input: ExpertReviewRequest): Promise<ExpertOpinion> {
    const startedAt = Date.now();
    const settings = aiSettingsService.getSettings();
    const task = await aiTaskService.create('multi_agent_review', {
      novelId: input.novelId,
      chapterId: input.chapterId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `第 ${input.roundNumber} 轮 ${getExpertLabel(input.expert)}评审`,
    });
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    input.signal?.addEventListener('abort', onExternalAbort, { once: true });
    if (input.signal?.aborted) onExternalAbort();
    const releaseCancellation = aiTaskService.registerActiveExecution(task.id, () =>
      controller.abort(),
    );

    try {
      const response = await createAiClient(settings).generate(
        buildMultiAgentExpertRequest(input),
        {
          signal: controller.signal,
          cancel: () => controller.abort(),
          requestId: createProviderTransportRequestId(`${input.operationId}-${input.expert}`),
        },
      );
      const parsed = parseExpertOpinion(response.text || '');
      const opinion: ExpertOpinion = {
        opinionId: generateId(),
        expert: input.expert,
        status: 'succeeded',
        ...parsed,
        provider: settings.provider,
        model: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
        aiTaskId: task.id,
        tokensInput: response.tokenInput ?? 0,
        tokensOutput: response.tokenOutput ?? 0,
        tokensUsed: response.tokenTotal ?? (response.tokenInput ?? 0) + (response.tokenOutput ?? 0),
        durationMs: Math.max(0, Date.now() - startedAt),
      };

      await aiTaskService.markSucceeded(task.id, {
        resultText: `${getExpertLabel(input.expert)} ${opinion.score} 分`,
        resultJson: JSON.stringify(parsed),
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: opinion.tokensUsed,
      });
      return opinion;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isAiRequestCancelled(error) || controller.signal.aborted) {
        await aiTaskService.markCancelled(task.id);
      } else {
        await aiTaskService.markFailed(task.id, message);
      }
      throw error;
    } finally {
      input.signal?.removeEventListener('abort', onExternalAbort);
      releaseCancellation();
    }
  }

  async reviseDraft(input: DraftRevisionRequest): Promise<DraftRevisionResult> {
    const startedAt = Date.now();
    const settings = aiSettingsService.getSettings();
    const task = await aiTaskService.create('multi_agent_revision', {
      novelId: input.novelId,
      chapterId: input.chapterId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `第 ${input.roundNumber} 轮后执行 ${input.action}`,
    });
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    input.signal?.addEventListener('abort', onExternalAbort, { once: true });
    if (input.signal?.aborted) onExternalAbort();
    const releaseCancellation = aiTaskService.registerActiveExecution(task.id, () =>
      controller.abort(),
    );

    try {
      const response = await createAiClient(settings).generate(
        buildMultiAgentRevisionRequest(input),
        {
          signal: controller.signal,
          cancel: () => controller.abort(),
          requestId: createProviderTransportRequestId(
            `${input.operationId}-revision-${input.roundNumber}`,
          ),
        },
      );
      const content = stripAccidentalFence(response.text || '');
      if (!content) throw new Error('主编 Agent 未返回候选正文。');

      const result: DraftRevisionResult = {
        content,
        provider: settings.provider,
        model: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
        aiTaskId: task.id,
        tokensInput: response.tokenInput ?? 0,
        tokensOutput: response.tokenOutput ?? 0,
        tokensUsed: response.tokenTotal ?? (response.tokenInput ?? 0) + (response.tokenOutput ?? 0),
        durationMs: Math.max(0, Date.now() - startedAt),
      };

      await aiTaskService.markSucceeded(task.id, {
        resultText: `${input.action} 候选正文已生成`,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: result.tokensUsed,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isAiRequestCancelled(error) || controller.signal.aborted) {
        await aiTaskService.markCancelled(task.id);
      } else {
        await aiTaskService.markFailed(task.id, message);
      }
      throw error;
    } finally {
      input.signal?.removeEventListener('abort', onExternalAbort);
      releaseCancellation();
    }
  }
}
