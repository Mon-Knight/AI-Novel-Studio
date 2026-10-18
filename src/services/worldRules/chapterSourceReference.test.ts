import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { CHAPTER_SOURCE_REF_PREFIX, validateLocalChapterSource } from './chapterSourceReference';

const content = '不得喷水或揭裱物证。';
const reference = `${CHAPTER_SOURCE_REF_PREFIX}c:d:${createHash('sha256').update(content).digest('hex')}`;
const metadata = JSON.stringify({ provenance: { sourceRefs: [reference] } });
const draft = { id: 'd', novelId: 'n', chapterId: 'c', isAdopted: true, content };
const state = () => ({
  chapters: [{ id: 'c', novelId: 'n', adoptedDraftId: 'd' }],
  drafts: [{ chapterId: 'c', records: { revision: 1, drafts: [draft] } }],
});

test('chapter reference validates current adopted content in both browser storage shapes', async () => {
  await validateLocalChapterSource('n', state(), metadata);
  await validateLocalChapterSource(
    'n',
    { ...state(), drafts: [{ chapterId: 'c', records: [draft] }] },
    undefined,
    undefined,
    reference,
  );
});
test('chapter reference rejects scope, pointer, hash and incomplete prose without trusting metadata', async () => {
  await assert.rejects(
    validateLocalChapterSource('other', state(), metadata),
    /CHAPTER_SOURCE_CHANGED/,
  );
  const changed = state();
  changed.chapters[0].adoptedDraftId = 'other';
  await assert.rejects(
    validateLocalChapterSource('n', changed, metadata),
    /CHAPTER_SOURCE_CHANGED/,
  );
  for (const override of [
    { content: 'changed' },
    { isAdopted: false },
    { chapterId: 'other' },
    { largeTextRefId: 'unread' },
    { contentState: { status: 'unavailable' } },
  ]) {
    await assert.rejects(
      validateLocalChapterSource(
        'n',
        { ...state(), drafts: [{ chapterId: 'c', records: [{ ...draft, ...override }] }] },
        metadata,
      ),
      /CHAPTER_SOURCE_CHANGED/,
    );
  }
});
test('chapter reference preserves historical provenance but always checks a fresh confirmation', async () => {
  const stale = state();
  stale.chapters[0].adoptedDraftId = 'other';
  await validateLocalChapterSource('n', stale, metadata, metadata);
  await assert.rejects(
    validateLocalChapterSource('n', stale, metadata, metadata, reference),
    /CHAPTER_SOURCE_CHANGED/,
  );
  await assert.rejects(
    validateLocalChapterSource(
      'n',
      state(),
      undefined,
      undefined,
      `${CHAPTER_SOURCE_REF_PREFIX}bad`,
    ),
    /CHAPTER_SOURCE_CHANGED/,
  );
});
