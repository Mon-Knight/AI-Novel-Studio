import type { TaskModelSnapshot } from '../../types/conversation';
import type { TaskDomainEntry } from '../../types/taskDomainEntry';
import { taskConversationService } from '../conversation/taskConversationService';
import { captureTaskModelSnapshot } from '../conversation/taskModelSnapshot';
import { taskSessionAdapter } from '../dsh/taskSessionAdapter';
import { isTauri } from '../database/db';

export interface ProductionEntryInput {
  novelId: string;
  chapterId?: string;
  goal: string;
  entry: TaskDomainEntry;
  conversationId?: string;
  modelSnapshot?: TaskModelSnapshot;
  signal?: AbortSignal;
}

/** Persistence and projection only: no scene dispatch, tool loop or business writes. */
export async function submitProductionAiEntry(input: ProductionEntryInput) {
  if (!isTauri()) throw new Error('统一持久任务执行仅在桌面端可用；浏览器不是桌面验收。');
  input.signal?.throwIfAborted();
  const existing = input.conversationId
    ? await taskConversationService.get(input.conversationId, { hydrateArtifacts: false })
    : null;
  if (input.conversationId && (!existing || existing.conversation.novelId !== input.novelId)) {
    throw new Error('DOMAIN_ENTRY_SCOPE_MISMATCH: 原任务不存在或不属于当前作品。');
  }
  const modelSnapshot =
    input.modelSnapshot ?? existing?.conversation.defaultModel ?? captureTaskModelSnapshot();
  const initialized = existing
    ? {
        conversation: existing.conversation,
        turn: await taskConversationService.appendTurn(input.conversationId!, 'user', input.goal),
      }
    : await taskConversationService.createInitialized(input.novelId, input.goal, modelSnapshot);
  const conversationId = initialized.conversation.conversationId;
  const cancel = () => {
    void taskSessionAdapter.cancel(conversationId);
  };
  input.signal?.addEventListener('abort', cancel, { once: true });
  try {
    input.signal?.throwIfAborted();
    const run = await taskSessionAdapter.startTurn({
      conversationId,
      novelId: input.novelId,
      chapterId: input.chapterId,
      turnId: initialized.turn.turnId,
      goal: input.goal,
      modelSnapshot,
      cancellationSignal: input.signal,
      domainEntry: input.entry,
    });
    if (run.status === 'cancelled' || run.status === 'cancel_requested') {
      throw new DOMException('任务已取消；已提交的候选仍以权威事实为准。', 'AbortError');
    }
    if (run.status !== 'completed')
      throw new Error(run.error ?? '统一任务未完成，请查看任务错误。');
    const bundle = await taskConversationService.get(conversationId, { hydrateArtifacts: false });
    const artifactIds =
      bundle?.artifacts
        .filter((card) => card.turnId === initialized.turn.turnId && card.artifactId)
        .map((card) => card.artifactId!) ?? [];
    return { conversationId, run, artifactIds };
  } finally {
    input.signal?.removeEventListener('abort', cancel);
  }
}
