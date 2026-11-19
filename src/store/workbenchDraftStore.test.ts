import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { useWorkbenchDraftStore } from './workbenchDraftStore';
import type { ArtifactRevisionSource } from '../types/artifactRevision';
const source: ArtifactRevisionSource = {
  conversationId: 'task-a',
  novelId: 'novel-a',
  chapterId: 'chapter-a',
  cardId: 'card-a',
  artifactId: 'artifact-a',
  artifactHash: 'a'.repeat(64),
  artifactType: 'chapter_text',
  title: '旧候选A',
};
beforeEach(() => useWorkbenchDraftStore.setState({ drafts: {} }));
test('draft and source remain scoped across tasks; removing source preserves all prose', () => {
  const store = useWorkbenchDraftStore.getState();
  store.updateDraft('task-a', '  不覆盖这段意见。\n');
  store.bindRevisionSource('task-a', source);
  store.updateDraft('task-b', '另一任务');
  store.clearRevisionSource('task-a');
  assert.deepEqual(useWorkbenchDraftStore.getState().drafts['task-a'], {
    text: '  不覆盖这段意见。\n',
    revisionSource: null,
  });
  assert.equal(useWorkbenchDraftStore.getState().drafts['task-b'].text, '另一任务');
});
test('late completion cannot erase a newer source or text and blank drafts clear identity', () => {
  const store = useWorkbenchDraftStore.getState();
  store.updateDraft('task-a', '修改A');
  store.bindRevisionSource('task-a', source);
  const next = { ...source, artifactId: 'artifact-b' };
  store.bindRevisionSource('task-a', next);
  store.clearSubmittedDraft('task-a', '修改A', source);
  assert.equal(useWorkbenchDraftStore.getState().drafts['task-a'].revisionSource, next);
  store.updateDraft('task-a', '追加新意见');
  store.clearSubmittedDraft('task-a', '修改A', next);
  assert.equal(useWorkbenchDraftStore.getState().drafts['task-a'].text, '追加新意见');
  store.updateDraft('task-a', '');
  assert.equal(useWorkbenchDraftStore.getState().drafts['task-a'].revisionSource, null);
});
test('only the successfully submitted unchanged draft clears both text and source', () => {
  const store = useWorkbenchDraftStore.getState();
  store.updateDraft('task-a', '修改A');
  store.bindRevisionSource('task-a', source);
  store.clearSubmittedDraft('task-a', '修改A', source);
  assert.deepEqual(useWorkbenchDraftStore.getState().drafts['task-a'], {
    text: '',
    revisionSource: null,
  });
});
