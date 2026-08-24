import { taskConversationService } from '../../conversation/taskConversationService';
import {
  failure,
  hashPublicValue,
  mapUnknownError,
  success,
  validateConversationScope,
  validateNovelId,
} from './domainResult';
import type {
  ConversationRuntimeSnapshot,
  ConversationSummary,
  DomainRequest,
  DomainResult,
} from './domainTypes';

function summarizeBundle(
  bundle: NonNullable<Awaited<ReturnType<typeof taskConversationService.get>>>,
): ConversationSummary {
  return {
    conversationId: bundle.conversation.conversationId,
    novelId: bundle.conversation.novelId,
    title: bundle.conversation.title,
    status: bundle.conversation.status,
    createdAt: bundle.conversation.createdAt,
    updatedAt: bundle.conversation.updatedAt,
    turnCount: bundle.turns.length,
    runCount: bundle.runs.length,
    artifactCount: bundle.artifacts.length,
  };
}

function snapshotBundle(
  bundle: NonNullable<Awaited<ReturnType<typeof taskConversationService.get>>>,
): ConversationRuntimeSnapshot {
  return {
    conversation: summarizeBundle(bundle),
    turns: bundle.turns.map((turn) => ({
      turnId: turn.turnId,
      sequence: turn.sequence,
      role: turn.role,
      ...(turn.runId ? { runId: turn.runId } : {}),
      createdAt: turn.createdAt,
    })),
    runs: bundle.runs.map((run) => ({
      runId: run.runId,
      turnId: run.turnId,
      status: run.status,
      workerId: run.workerId,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      ...(run.startedAt ? { startedAt: run.startedAt } : {}),
      ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
      ...(run.error ? { error: run.error } : {}),
    })),
    toolEvents: bundle.toolEvents.map((event) => ({
      eventId: event.eventId,
      runId: event.runId,
      sequence: event.sequence,
      toolName: event.toolName,
      status: event.status,
      ...(typeof event.durationMs === 'number' ? { durationMs: event.durationMs } : {}),
      createdAt: event.createdAt,
      ...(event.finishedAt ? { finishedAt: event.finishedAt } : {}),
    })),
    artifacts: bundle.artifacts.map((artifact) => ({
      cardId: artifact.cardId,
      ...(artifact.artifactId ? { artifactId: artifact.artifactId } : {}),
      artifactType: artifact.artifactType,
      title: artifact.title,
      summary: artifact.summary,
      status: artifact.status,
      createdAt: artifact.createdAt,
    })),
  };
}

export const conversationCapability = {
  async listTaskSummaries(request: DomainRequest): Promise<DomainResult<ConversationSummary[]>> {
    const invalid = validateNovelId(request);
    if (invalid) return invalid;
    try {
      const conversations = await taskConversationService.list(request.novelId);
      const bundles = await Promise.all(
        conversations.map((conversation) =>
          taskConversationService.get(conversation.conversationId),
        ),
      );
      const data = bundles
        .filter((bundle): bundle is NonNullable<typeof bundle> => bundle !== null)
        .map((bundle) => {
          if (bundle.conversation.novelId !== request.novelId) {
            throw new Error('任务对话列表包含跨作品结果。');
          }
          return summarizeBundle(bundle);
        });
      return success(data, {
        source: 'runtime',
        storageMode: 'runtime',
        warnings: [],
        revision: null,
        contentHash: await hashPublicValue(data),
      });
    } catch (error) {
      return mapUnknownError(error, 'runtime');
    }
  },

  async readRuntimeSnapshot(
    request: DomainRequest,
  ): Promise<DomainResult<ConversationRuntimeSnapshot>> {
    const invalid = validateConversationScope(request);
    if (invalid) return invalid;
    try {
      const bundle = await taskConversationService.get(request.conversationId!);
      if (!bundle) return failure('NOT_FOUND', '任务对话不存在。', 'runtime', 'runtime');
      if (bundle.conversation.novelId !== request.novelId) {
        return failure('SCOPE_MISMATCH', '任务对话不属于当前作品。', 'runtime', 'runtime');
      }
      const data = snapshotBundle(bundle);
      return success(data, {
        source: 'runtime',
        storageMode: 'runtime',
        warnings: [],
        revision: null,
        contentHash: await hashPublicValue(data),
      });
    } catch (error) {
      return mapUnknownError(error, 'runtime');
    }
  },
};

export type ConversationCapability = typeof conversationCapability;
