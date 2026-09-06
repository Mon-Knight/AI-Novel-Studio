import assert from 'node:assert/strict';
import test from 'node:test';
import type { TaskConversation } from '../../types/conversation';
import { queryLocalConversationDirectory, toConversationPage } from './conversationDirectoryQuery';

function conversation(index: number, archived = false): TaskConversation {
  return {
    conversationId: `task-${String(index).padStart(4, '0')}`,
    novelId: index === 0 ? 'older-novel' : 'novel-a',
    title: index === 0 ? '旧的待处理任务 100%' : `任务 ${index}`,
    status: index === 0 ? 'waiting_user' : 'idle',
    createdAt: '2026-09-05T00:00:00Z',
    updatedAt: index === 0 ? '2026-09-01T00:00:00Z' : '2026-09-05T00:00:00Z',
    ...(archived ? { archivedAt: '2026-09-05T00:00:00Z' } : {}),
  };
}

test('archive and search filters precede the page limit, including literal search characters', () => {
  const items = [
    conversation(0),
    ...Array.from({ length: 150 }, (_, i) => conversation(i + 1, true)),
  ];
  assert.deepEqual(queryLocalConversationDirectory(items, { archive: 'active', limit: 100 }), [
    items[0],
  ]);
  assert.deepEqual(
    queryLocalConversationDirectory(items, { archive: 'all', query: '100%', limit: 100 }),
    [items[0]],
  );
  assert.deepEqual(
    queryLocalConversationDirectory(
      items,
      { query: '旧项目', limit: 100 },
      { 'older-novel': '旧项目' },
    ),
    [items[0]],
  );
  assert.equal(
    queryLocalConversationDirectory(items, { archive: 'archived', limit: 100 }).length,
    100,
  );
});

test('keyset pages reach every task once even when timestamps tie', () => {
  const items = Array.from({ length: 351 }, (_, i) => conversation(i));
  const ids: string[] = [];
  let cursor: { updatedAt: string; conversationId: string } | undefined;
  do {
    const page = toConversationPage(
      queryLocalConversationDirectory(items, { limit: 101, cursor }),
      100,
    );
    ids.push(...page.items.map((item) => item.conversationId));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(ids.length, 351);
  assert.equal(new Set(ids).size, 351);
  assert.equal(ids[ids.length - 1], 'task-0000');
});

test('query scope remains enforced when a cursor from another project is supplied', () => {
  const items = [conversation(0), conversation(1), conversation(2)];
  const result = queryLocalConversationDirectory(items, {
    novelId: 'older-novel',
    cursor: { updatedAt: items[2].updatedAt, conversationId: items[2].conversationId },
  });
  assert.deepEqual(
    result.map((item) => item.conversationId),
    ['task-0000'],
  );
  assert.throws(() => queryLocalConversationDirectory(items, { query: '字'.repeat(201) }), /搜索/);
});
