import type { TaskConversation } from '../../types/conversation';
import type {
  ConversationDirectoryPage,
  ConversationDirectoryQuery,
} from '../../types/conversation-directory';

// Match SQLite lower(): ASCII folding, literal substring search (not LIKE wildcards).
function searchText(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

export function normalizeConversationDirectoryQuery(
  input: ConversationDirectoryQuery,
): ConversationDirectoryQuery {
  const query = input.query?.trim() ?? '';
  if (Array.from(query).length > 200) throw new Error('任务搜索不能超过 200 个字符。');
  const archive = input.archive ?? 'active';
  if (!['active', 'archived', 'all'].includes(archive)) throw new Error('任务归档筛选无效。');
  if (input.cursor && (!input.cursor.updatedAt || !input.cursor.conversationId)) {
    throw new Error('任务分页游标无效。');
  }
  return {
    ...input,
    archive,
    query,
    limit: Math.max(1, Math.min(501, Math.trunc(input.limit || 100))),
  };
}

export function compareConversations(left: TaskConversation, right: TaskConversation): number {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? -1 : 1;
  return left.conversationId === right.conversationId
    ? 0
    : left.conversationId > right.conversationId
      ? -1
      : 1;
}

export function queryLocalConversationDirectory(
  items: readonly TaskConversation[],
  input: ConversationDirectoryQuery,
  novelTitles: Readonly<Record<string, string>> = {},
): TaskConversation[] {
  const query = normalizeConversationDirectoryQuery(input);
  const needle = searchText(query.query ?? '');
  return items
    .filter((item) => {
      if (query.novelId && item.novelId !== query.novelId) return false;
      const archived = Boolean(item.archivedAt || item.status === 'archived');
      if (query.archive !== 'all' && archived !== (query.archive === 'archived')) return false;
      if (
        needle &&
        !searchText(`${item.title} ${novelTitles[item.novelId] ?? ''}`).includes(needle)
      )
        return false;
      const cursor = query.cursor;
      return (
        !cursor ||
        item.updatedAt < cursor.updatedAt ||
        (item.updatedAt === cursor.updatedAt && item.conversationId < cursor.conversationId)
      );
    })
    .sort(compareConversations)
    .slice(0, query.limit);
}

export function toConversationPage(
  rows: TaskConversation[],
  limit: number,
): ConversationDirectoryPage {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items,
    ...(rows.length > limit && last
      ? {
          nextCursor: { updatedAt: last.updatedAt, conversationId: last.conversationId },
        }
      : {}),
  };
}
