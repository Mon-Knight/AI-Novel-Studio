import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createServer } from 'vite';
import type { ChapterDraft } from '../../types/ai';

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
const editorModule = await vite.ssrLoadModule('/src/components/workspace/EditorArea.tsx');
const resolveEditorDraftContent = editorModule.resolveEditorDraftContent as typeof import('./EditorArea').resolveEditorDraftContent;
const isDraftSaveResultForDocument = editorModule.isDraftSaveResultForDocument as typeof import('./EditorArea').isDraftSaveResultForDocument;

after(async () => {
  await vite.close();
});

const completeDraft: ChapterDraft = {
  id: 'draft-complete',
  novelId: 'novel-a',
  chapterId: 'chapter-b',
  content: '完整正文🙂\r\n第二段',
  source: 'user_edited',
  versionNo: 2,
  wordCount: 8,
  isAdopted: false,
  createdAt: '2026-07-21T00:00:00.000Z',
  updatedAt: '2026-07-21T00:00:00.000Z',
};

test('loading or failed hydration preserves the last known complete editor content', () => {
  assert.deepEqual(resolveEditorDraftContent({
    documentState: 'loading',
    novelId: 'novel-a',
    chapterId: 'chapter-b',
    draft: null,
  }), { action: 'preserve' });

  assert.deepEqual(resolveEditorDraftContent({
    documentState: 'error',
    novelId: 'novel-a',
    chapterId: 'chapter-b',
    draft: completeDraft,
  }), { action: 'preserve' });
});

test('only a fully hydrated draft owned by the live document may replace editor content', () => {
  assert.deepEqual(resolveEditorDraftContent({
    documentState: 'ready',
    novelId: 'novel-a',
    chapterId: 'chapter-b',
    draft: completeDraft,
  }), { action: 'replace', content: completeDraft.content, draft: completeDraft });

  const mismatched = resolveEditorDraftContent({
    documentState: 'ready',
    novelId: 'novel-a',
    chapterId: 'chapter-other',
    draft: completeDraft,
  });
  assert.equal(mismatched.action, 'preserve');
  assert.match(mismatched.reason ?? '', /不一致/);
});

test('a verified chapter with no draft clears the editor instead of retaining another chapter', () => {
  assert.deepEqual(resolveEditorDraftContent({
    documentState: 'ready',
    novelId: 'novel-a',
    chapterId: 'chapter-empty',
    draft: null,
  }), { action: 'replace', content: '', draft: null });
});

test('a backend-verified adopted fork is accepted by document ownership instead of a stale draft id', () => {
  const forkedDraft: ChapterDraft = {
    ...completeDraft,
    id: 'draft-forked-after-adoption',
    novelId: 'novel-a',
    chapterId: 'chapter-b',
    versionNo: completeDraft.versionNo + 1,
  };

  assert.equal(isDraftSaveResultForDocument(
    forkedDraft,
    'novel-a',
    'chapter-b',
  ), true);
  assert.equal(isDraftSaveResultForDocument(
    forkedDraft,
    'novel-a',
    'chapter-other',
  ), false);
});
