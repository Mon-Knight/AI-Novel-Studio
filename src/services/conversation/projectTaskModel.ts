import type { TaskConversation, TaskModelSnapshot } from '../../types/conversation';
import type { ConversationListCursor } from '../../types/conversation-directory';
import { taskConversationService } from './taskConversationService';

function modelChoiceTime(conversation: TaskConversation) {
  const capturedAt = conversation.defaultModel?.capturedAt;
  const validTime = (value: unknown): value is string =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/u.test(value) &&
    Number.isFinite(Date.parse(value));
  const legacy = !validTime(capturedAt);
  const value = legacy ? conversation.createdAt : capturedAt;
  if (!validTime(value)) {
    throw new Error('作品模型选择时间无法核对，请明确选择本次模型。');
  }
  return { value, timestamp: Date.parse(value), legacy };
}

/** Reuse the persisted project choice without rebinding its provider endpoint. */
export function resolveProjectTaskModel(
  novelId: string,
  conversations: readonly TaskConversation[],
  fallback: () => TaskModelSnapshot,
): { model: TaskModelSnapshot; sourceLabel: string } {
  const recent = conversations
    .filter(
      (item) =>
        item.novelId === novelId &&
        !item.archivedAt &&
        item.status !== 'archived' &&
        item.defaultModel,
    )
    .map((conversation) => ({ conversation, time: modelChoiceTime(conversation) }))
    .sort(
      (a, b) =>
        b.time.timestamp - a.time.timestamp ||
        a.conversation.createdAt.localeCompare(b.conversation.createdAt) ||
        a.conversation.conversationId.localeCompare(b.conversation.conversationId),
    )[0];
  if (!recent?.conversation.defaultModel)
    return { model: fallback(), sourceLabel: '使用 AI 设置中的默认模型' };
  const model = structuredClone(recent.conversation.defaultModel);
  // Inheriting a legacy choice must not turn the new conversation's creation into a new choice.
  model.capturedAt = recent.time.value;
  // Runtime-only attestations are never promoted into a new client-authored snapshot.
  if (model.runtime) delete model.runtime.toolCallingAttestation;
  return {
    model,
    sourceLabel: recent.time.legacy
      ? `沿用本作品会话「${recent.conversation.title}」的模型（旧记录缺少有效选择时间，按原会话创建时间保守确定）`
      : `沿用本作品最近选择的模型（会话「${recent.conversation.title}」）`,
  };
}

/** The global sidebar is paged; query this project's directory before choosing its default. */
export async function loadProjectTaskModel(novelId: string, fallback: () => TaskModelSnapshot) {
  let cursor: ConversationListCursor | undefined;
  const seen = new Set<string>();
  const conversations: TaskConversation[] = [];
  const conversationIds = new Set<string>();
  do {
    const page = await taskConversationService.listPage({
      novelId,
      archive: 'active',
      limit: 100,
      cursor,
    });
    for (const item of page.items) {
      if (conversationIds.has(item.conversationId))
        throw new Error('作品任务目录已变化，请重新读取模型选择。');
      conversationIds.add(item.conversationId);
      conversations.push(item);
    }
    cursor = page.nextCursor;
    if (cursor) {
      const key = JSON.stringify(cursor);
      if (seen.has(key)) throw new Error('作品模型选择读取未能推进，请重试。');
      seen.add(key);
    }
  } while (cursor);
  return resolveProjectTaskModel(novelId, conversations, fallback);
}
