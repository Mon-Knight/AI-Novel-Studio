import assert from 'node:assert/strict';
import test from 'node:test';
import type { TaskConversationBundle } from '../../types/conversation';
import {
  groupWorkbenchRounds,
  projectWorkbenchEvents,
} from '../../features/workbench/workbenchPresentation';
import { mergeConversationWindow, sliceConversationWindow } from './conversationWindow';

test('real page merge keeps an early card while projecting the refreshed tail', () => {
  const createdAt = '2026-08-20T00:00:01.000Z';
  const turns = Array.from({ length: 200 }, (_, index) => ({
    turnId: `user-${index}`,
    conversationId: 'task',
    sequence: index,
    role: 'user' as const,
    content: `第${index + 1}次创作要求`,
    createdAt,
  }));
  const source: TaskConversationBundle = {
    conversation: {
      conversationId: 'task',
      novelId: 'novel',
      title: '长任务',
      status: 'idle',
      createdAt,
      updatedAt: createdAt,
    },
    turns,
    runs: [],
    toolEvents: [],
    artifacts: [
      {
        cardId: 'first-card',
        conversationId: 'task',
        turnId: 'user-0',
        artifactType: 'generic',
        title: '最早候选',
        summary: '不能被刷新上限清掉',
        content: '最早正文',
        status: 'candidate',
        createdAt,
      },
    ],
    decisions: [],
    authorizations: [],
  };
  const loaded = sliceConversationWindow(source, {
    conversationId: 'task',
    minUserSequence: 0,
    limit: 200,
  });
  assert.equal(groupWorkbenchRounds(projectWorkbenchEvents(loaded.bundle)).length, 200);
  const visible = sliceConversationWindow(source, { conversationId: 'task', limit: 8 });
  assert.equal(groupWorkbenchRounds(projectWorkbenchEvents(visible.bundle)).length, 8);
  assert.equal(visible.bundle.artifacts.length, 0);
  const capped = sliceConversationWindow(source, {
    conversationId: 'task',
    minUserSequence: 0,
    limit: 8,
  });
  const started = Date.now();
  const merged = mergeConversationWindow(loaded.bundle, capped.bundle, capped.page);
  const rounds = groupWorkbenchRounds(projectWorkbenchEvents(merged));
  const elapsed = Date.now() - started;
  assert.equal(capped.page.hasNewer, false);
  assert.equal(capped.page.hasOlder, true);
  assert.equal(rounds.length, 200);
  assert.equal(
    merged.artifacts.some((card) => card.cardId === 'first-card'),
    true,
  );
  assert.equal(merged.artifacts.find((card) => card.cardId === 'first-card')?.content, '最早正文');
  assert.ok(elapsed < 2000, `projection took ${elapsed}ms`);
});
