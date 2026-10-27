import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveChapterStageProgressScope } from './chapterStageProgressScope';

const base = {
  novelId: ' novel-1 ',
  chapterId: ' chapter-1 ',
  conversationId: ' conversation-1 ',
  turns: [
    { turnId: 'turn-user', role: 'user' as const },
    { turnId: 'turn-assistant', role: 'assistant' as const },
  ],
  runs: [{ turnId: 'turn-user', chapterId: 'chapter-1' }],
};

test('a single user turn bound to the chapter becomes the workflow identity', () => {
  assert.deepEqual(resolveChapterStageProgressScope(base), {
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    conversationId: 'conversation-1',
    workflowId: 'turn-user',
  });
});

test('multiple user turns for the same chapter are not guessed', () => {
  const scope = resolveChapterStageProgressScope({
    ...base,
    turns: [...base.turns, { turnId: 'turn-user-2', role: 'user' }],
    runs: [...base.runs, { turnId: 'turn-user-2', chapterId: 'chapter-1' }],
  });
  assert.equal(scope?.workflowId, undefined);
});

test('runs for another chapter or an assistant turn do not create a workflow', () => {
  const scope = resolveChapterStageProgressScope({
    ...base,
    runs: [
      { turnId: 'turn-assistant', chapterId: 'chapter-1' },
      { turnId: 'turn-user', chapterId: 'chapter-2' },
    ],
  });
  assert.equal(scope?.workflowId, undefined);
  assert.equal(scope?.chapterId, 'chapter-1');
});

test('missing chapter or conversation identity disables the progress scope', () => {
  assert.equal(resolveChapterStageProgressScope({ ...base, chapterId: ' ' }), null);
  assert.equal(resolveChapterStageProgressScope({ ...base, conversationId: '' }), null);
});
