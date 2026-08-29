import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAdoptedDraftMemoryInput,
  ingestAdoptedDraftMemory,
  putLocalMemoryDocument,
  retrieveLocalMemory,
} from './adoptedDraftMemory';
import type { ChapterDraft } from '../../types/ai';

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

function draft(content: string): ChapterDraft {
  return {
    id: 'draft-001',
    novelId: 'novel-001',
    chapterId: 'ch-001',
    content,
    source: 'ai_generated',
    versionNo: 2,
    wordCount: 12,
    isAdopted: true,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
  };
}

test('adopted draft memory chunks and local retrieve work without Tauri', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const input = await buildAdoptedDraftMemoryInput(
    draft('第一段足够长的正文。\n\n第二段继续推进剧情，出现铜钥匙。'),
    0,
  );
  assert.equal(input.sourceType, 'adopted_draft');
  assert.ok(input.chunks.length >= 1);
  assert.match(input.chunks[0].contentHash, /^[a-f0-9]{64}$/);
  assert.equal(input.chunks[0].chapterOrderIndex, 0);
  assert.equal(input.chunks[0].temporalStartChapter, 0);
  await ingestAdoptedDraftMemory(draft('第一段足够长的正文。\n\n第二段继续推进剧情，出现铜钥匙。'));
  const found = retrieveLocalMemory('novel-001', '铜钥匙');
  assert.ok(found.items.some((item) => item.text.includes('铜钥匙')));
});

test('local retrieval excludes memories created after the target chapter boundary', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const previous = await buildAdoptedDraftMemoryInput(draft('此前章节留下了铜钥匙。'), 0);
  const future = await buildAdoptedDraftMemoryInput(
    {
      ...draft('未来章节才出现银钥匙。'),
      id: 'draft-002',
      chapterId: 'ch-002',
    },
    2,
  );
  putLocalMemoryDocument(previous);
  putLocalMemoryDocument(future);

  const found = retrieveLocalMemory('novel-001', '', 8, {
    sourceTypes: ['adopted_draft'],
    chapterEnd: 0,
    temporalChapter: 1,
  });
  assert.deepEqual(
    found.items.map((item) => item.chapterId),
    ['ch-001'],
  );
  assert.equal(
    found.items.some((item) => item.text.includes('银钥匙')),
    false,
  );
});
