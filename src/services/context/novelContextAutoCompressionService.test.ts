import assert from 'node:assert/strict';
import test from 'node:test';
import { mockNovels } from '../../features/novels/mockNovels';
import { chapterSummaryService } from './chapterSummaryService';
import { contextRecordService, isContextCompressionRecord } from './contextRecordService';
import {
  novelContextAutoCompressionService,
  type NovelContextAutoCompressionResult,
} from './novelContextAutoCompressionService';
import { novelContextCompressionProvider } from './novelContextCompressionProvider';

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

function resetStorage() {
  const storage = new MemoryStorage();
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    storage as unknown as Storage;
  localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
  return storage;
}

test('auto compression skips before any chapter or volume milestone is confirmed', async () => {
  resetStorage();
  localStorage.setItem(
    'ai_novel_studio_chapters',
    JSON.stringify([
      {
        id: 'ch-draft-only',
        novelId: 'novel-001',
        title: '第一章：草稿阶段',
        status: 'editing',
        orderIndex: 0,
        chapterNumber: 1,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    ]),
  );

  const result = await novelContextAutoCompressionService.syncAfterConfirmation(
    'novel-001',
    'chapter_adopted',
  );
  assert.equal(result.status, 'skipped');
  if (result.status === 'skipped') {
    assert.equal(result.reason, 'awaiting_confirmed_milestone');
  }
  const records = await contextRecordService.getByNovelId('novel-001');
  assert.equal(records.filter(isContextCompressionRecord).length, 0);
});

test('auto compression applies after chapter confirmation, stays idempotent on same revision, and updates after summary confirmation', async () => {
  resetStorage();
  localStorage.setItem(
    'ai_novel_studio_chapters',
    JSON.stringify([
      {
        id: 'ch-confirmed-1',
        novelId: 'novel-001',
        title: '第一章：站台信号',
        outline: '沈砚发现废弃站台仍在发报。',
        adoptedDraftId: 'draft-1',
        status: 'adopted',
        orderIndex: 0,
        chapterNumber: 1,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T01:00:00.000Z',
      },
    ]),
  );

  const notifications: NovelContextAutoCompressionResult[] = [];
  const unsubscribe = novelContextAutoCompressionService.subscribe(({ novelId, result }) => {
    if (novelId === 'novel-001') notifications.push(result);
  });

  try {
    const first = await novelContextAutoCompressionService.syncAfterConfirmation(
      'novel-001',
      'chapter_adopted',
    );
    assert.equal(first.status, 'applied');
    assert.equal(notifications.length, 1);

    const repeat = await novelContextAutoCompressionService.syncAfterConfirmation(
      'novel-001',
      'chapter_adopted',
    );
    assert.equal(repeat.status, 'up_to_date');
    assert.equal(notifications.length, 1);

    await chapterSummaryService.create({
      novelId: 'novel-001',
      chapterId: 'ch-confirmed-1',
      adoptedDraftId: 'draft-1',
      summary: '沈砚确认发报机指向三号隧道，并记录了异常频段。',
      enabled: true,
    });

    const afterSummary = await novelContextAutoCompressionService.syncAfterConfirmation(
      'novel-001',
      'chapter_summary_confirmed',
    );
    assert.equal(afterSummary.status, 'applied');
    assert.equal(notifications.length, 2);

    const records = await contextRecordService.getByNovelId('novel-001');
    const compressed = records.filter(isContextCompressionRecord);
    assert.equal(compressed.length, 2);
    const active = compressed.filter((record) => record.isActive);
    assert.equal(active.length, 1);
    assert.match(active[0].content, /沈砚确认发报机指向三号隧道/);
  } finally {
    unsubscribe();
  }
});

test('auto compression triggers when a volume is marked completed and escalates budget when needed', async () => {
  resetStorage();
  localStorage.setItem(
    'ai_novel_studio_volumes',
    JSON.stringify([
      {
        id: 'vol-confirmed-1',
        novelId: 'novel-001',
        title: '第一卷：雾轨潜行',
        summary: '完成首轮潜入调查',
        orderIndex: 0,
        volumeNumber: 1,
        sortOrder: 0,
        status: 'completed',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T02:00:00.000Z',
      },
    ]),
  );

  const originalPropose = novelContextCompressionProvider.propose;
  const seenBudgets: number[] = [];
  novelContextCompressionProvider.propose = async (novelId, budget = 4000) => {
    seenBudgets.push(budget);
    const actual = await originalPropose(novelId, budget);
    if (budget === 4000) {
      return { ...actual, valid: false };
    }
    return actual;
  };

  try {
    const result = await novelContextAutoCompressionService.syncAfterConfirmation(
      'novel-001',
      'volume_confirmed',
    );
    assert.equal(result.status, 'applied');
    assert.deepEqual(seenBudgets, [4000, 6000]);
  } finally {
    novelContextCompressionProvider.propose = originalPropose;
  }
});
