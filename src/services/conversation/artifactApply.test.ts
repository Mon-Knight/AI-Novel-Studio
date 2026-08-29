import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResultArtifactBundle } from '../../types/result-artifact';
import { characterService } from '../characters/characterService';
import { chapterCharacterService } from '../characters/chapterCharacterService';
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
  const firstChapterBindings = await chapterCharacterService.getByChapterId('ch-apply');
  assert.equal(firstChapterBindings.length, 1);
  assert.equal(firstChapterBindings[0].characterId, stored[0].id);
  assert.equal(firstChapterBindings[0].roleInChapter, 'supporting');
  assert.equal(firstChapterBindings[0].mustAppear, true);

  const replay = await applyArtifactBundle(
    { novelId: 'novel-apply', chapterId: 'ch-apply' },
    bundle(
      'character_candidates',
      JSON.stringify({ characters: [{ name: '林默', roleType: 'supporting' }] }),
    ),
  );
  assert.equal(replay.conflictCode, 'CHARACTER_CANDIDATES_ALREADY_APPLIED');
  assert.equal((await characterService.getByNovelId('novel-apply')).length, 1);

  const existingCharacterNewChapter = await applyArtifactBundle(
    { novelId: 'novel-apply', chapterId: 'ch-second' },
    bundle(
      'character_candidates',
      JSON.stringify({ characters: [{ name: '林默', roleType: 'supporting' }] }),
    ),
  );
  assert.ok(existingCharacterNewChapter.applyTransactionId);
  const secondChapterBindings = await chapterCharacterService.getByChapterId('ch-second');
  assert.equal(secondChapterBindings.length, 1);
  assert.equal(secondChapterBindings[0].characterId, stored[0].id);

  const protagonistCandidate = await applyArtifactBundle(
    { novelId: 'novel-apply', chapterId: 'ch-protagonist' },
    bundle(
      'character_candidates',
      JSON.stringify({
        characters: [
          {
            name: '沈砚',
            roleType: 'protagonist',
            chapterFunction: '追查异常编号',
          },
        ],
      }),
    ),
  );
  assert.ok(protagonistCandidate.applyTransactionId);
  const protagonistBindings = await chapterCharacterService.getByChapterId('ch-protagonist');
  assert.equal(protagonistBindings.length, 1);
  assert.equal(protagonistBindings[0].roleInChapter, 'main');
  assert.equal(protagonistBindings[0].mustAppear, true);
  assert.equal(protagonistBindings[0].note, '追查异常编号');

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

  const compressedText = '浏览器不能直接应用小说压缩上下文';
  const compression = await applyArtifactBundle(
    { novelId: 'novel-apply' },
    bundle(
      'generic_json',
      JSON.stringify({
        providerId: 'ans.novel-context.extractive-v1',
        version: '1.1.0',
        config: { tokenBudget: 4000 },
        novelId: 'novel-apply',
        sourceRevision: 'rev-1234abcd-42',
        compressedText,
        coverage: {
          characters: { required: [], present: [], missing: [] },
          plot: { required: [], present: [], missing: [] },
          foreshadow: { required: [], present: [], missing: [] },
          timeline: { required: [], present: [], missing: [] },
          world: { required: [], present: [], missing: [] },
          rules: { required: [], present: [], missing: [] },
          outlines: { required: [], present: [], missing: [] },
          style: { required: [], present: [], missing: [] },
          output: { required: [], present: [], missing: [] },
          tokens: { budget: 4000, used: [...compressedText].length, withinBudget: true },
        },
        valid: true,
      }),
      { derivationType: 'context_compression' },
    ),
  );
  assert.equal(compression.conflictCode, 'BROWSER_APPLY_UNSUPPORTED');
});
