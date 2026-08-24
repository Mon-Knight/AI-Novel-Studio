import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResultArtifactBundle } from '../../types/result-artifact';
import { characterService } from '../characters/characterService';
import { chapterEventService } from '../characters/chapterEventService';
import { chapterSummaryService } from '../context/chapterSummaryService';
import { draftVersionService } from '../database/draftVersionService';
import { applyArtifactBundle } from './artifactApply';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

function bundle(
  artifactType: ResultArtifactBundle['artifact']['artifactType'],
  rawContent: string,
  overrides: Partial<ResultArtifactBundle['artifact']> = {},
): ResultArtifactBundle {
  return {
    artifact: {
      artifactId: 'art-1',
      taskId: 'task-1',
      attemptId: 'attempt-1',
      sourceInputSnapshotId: 'snap-1',
      artifactType,
      schemaVersion: 1,
      rawContentRefId: 'raw-1',
      sourceNovelId: 'novel-apply',
      contentHash: 'hash-1',
      contentLength: rawContent.length,
      processingStatus: 'valid',
      createdAt: '2026-08-21T00:00:00Z',
      ...overrides,
    },
    rawContent,
    issues: [],
  };
}

test('character and event candidates apply through domain services without writing reports', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const characters = await applyArtifactBundle(
    { novelId: 'novel-apply', chapterId: 'ch-apply' },
    bundle(
      'character_candidates',
      JSON.stringify({
        characters: [
          { name: '林默', roleType: 'supporting', identity: '巡夜人' },
          { name: '林默', roleType: 'supporting' },
        ],
      }),
    ),
  );
  assert.ok(characters.applyTransactionId);
  const stored = await characterService.getByNovelId('novel-apply');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].name, '林默');

  const replay = await applyArtifactBundle(
    { novelId: 'novel-apply', chapterId: 'ch-apply' },
    bundle(
      'character_candidates',
      JSON.stringify({ characters: [{ name: '林默', roleType: 'supporting' }] }),
    ),
  );
  assert.equal(replay.conflictCode, 'CHARACTER_CANDIDATES_ALREADY_APPLIED');
  assert.equal((await characterService.getByNovelId('novel-apply')).length, 1);

  const events = await applyArtifactBundle(
    { novelId: 'novel-apply', chapterId: 'ch-apply' },
    bundle(
      'event_candidates',
      JSON.stringify({ events: [{ title: '巷口对峙', description: '雨停后相遇' }] }),
    ),
  );
  assert.ok(events.applyTransactionId);
  const storedEvents = await chapterEventService.getByChapterId('ch-apply');
  assert.equal(storedEvents.length, 1);
  assert.equal(storedEvents[0].status, 'adopted');

  const withoutAdoptedDraft = await applyArtifactBundle(
    { novelId: 'novel-without-draft', chapterId: 'ch-without-draft' },
    bundle('chapter_summary', JSON.stringify({ summary: '不应写入无采用稿章节。' })),
  );
  assert.equal(withoutAdoptedDraft.conflictCode, 'CHAPTER_SUMMARY_ADOPTED_DRAFT_REQUIRED');

  const adoptedSource = await draftVersionService.create({
    novelId: 'novel-apply',
    chapterId: 'ch-apply',
    title: '第 1 章草稿',
    content: '已采用正文。',
    source: 'user_edited',
  });
  const adoptedDraft = await draftVersionService.adopt(adoptedSource.id, 'ch-apply');
  const summary = await applyArtifactBundle(
    { novelId: 'novel-apply', chapterId: 'ch-apply' },
    bundle('chapter_summary', JSON.stringify({ summary: '本章确认雨巷线索。' })),
  );
  assert.ok(summary.applyTransactionId);
  const storedSummary = await chapterSummaryService.getByChapterId('ch-apply');
  assert.equal(storedSummary?.summary, '本章确认雨巷线索。');
  assert.equal(storedSummary?.adoptedDraftId, adoptedDraft.id);

  const mismatchedSummary = await applyArtifactBundle(
    { novelId: 'novel-apply', chapterId: 'ch-apply' },
    bundle('chapter_summary', JSON.stringify({ summary: '不应应用的总结。' }), {
      sourceDraftId: 'draft-mismatch',
    }),
  );
  assert.equal(mismatchedSummary.conflictCode, 'CHAPTER_SUMMARY_ADOPTED_DRAFT_MISMATCH');

  const chapter = await applyArtifactBundle(
    { novelId: 'novel-apply', chapterId: 'ch-apply' },
    bundle('chapter_text', JSON.stringify({ data: { text: '雨声停了。' } })),
  );
  assert.equal(chapter.conflictCode, 'CHAPTER_REQUIRES_REVIEW');

  await assert.rejects(
    () =>
      applyArtifactBundle(
        { novelId: 'novel-apply' },
        bundle('quality_report', JSON.stringify({ summary: '不可应用' })),
      ),
    /不能直接写入正式小说事实/,
  );
});
