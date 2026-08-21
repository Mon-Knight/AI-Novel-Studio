import test from 'node:test';
import assert from 'node:assert/strict';
import { mockNovels } from '../../features/novels/mockNovels';
import { artifactDecisionService } from '../conversation/artifactDecisionService';
import { taskConversationService } from '../conversation/taskConversationService';
import { contextRecordService } from './contextRecordService';
import {
  CONTEXT_COMPRESSION_PROVIDER_ID,
  novelContextCompressionProvider,
} from './novelContextCompressionProvider';

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

test('extractive context compression keeps coverage, versions old records and can roll back', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
  localStorage.setItem(
    'ai_novel_studio_chapters',
    JSON.stringify([
      {
        id: 'ch-003',
        novelId: 'novel-001',
        title: '第三章',
        outline: '主角发现关键线索。',
        orderIndex: 2,
        createdAt: '2026-08-20T00:00:00Z',
        updatedAt: '2026-08-20T00:00:00Z',
      },
    ]),
  );
  await contextRecordService.create({
    novelId: 'novel-001',
    contextType: 'foreshadow',
    title: '归途信标',
    content: '殖民地仍有未发出的求救信标。',
    importance: 5,
  });
  await contextRecordService.create({
    novelId: 'novel-001',
    contextType: 'rule',
    title: '跃迁配额',
    content: '跃迁必须消耗核定配额。',
    importance: 4,
  });

  const candidate = await novelContextCompressionProvider.propose('novel-001', 4000);
  assert.equal(candidate.providerId, CONTEXT_COMPRESSION_PROVIDER_ID);
  assert.equal(candidate.valid, true);
  assert.equal(candidate.coverage.tokens.withinBudget, true);
  assert.equal(candidate.coverage.characters.missing.length, 0);
  assert.equal(candidate.coverage.plot.missing.length, 0);
  assert.equal(candidate.coverage.foreshadow.missing.length, 0);
  assert.equal(candidate.coverage.rules.missing.length, 0);
  assert.match(candidate.compressedText, /陆远/);
  assert.match(candidate.compressedText, /第三章/);
  assert.match(candidate.compressedText, /归途信标/);

  const first = await novelContextCompressionProvider.apply(candidate);
  const afterFirst = await contextRecordService.getByNovelId('novel-001');
  const compressed = afterFirst.filter((record) => record.title.startsWith('小说上下文压缩'));
  assert.equal(compressed.length, 1);
  assert.equal(compressed[0].isActive, true);
  assert.equal(first.recordId, compressed[0].id);

  const secondCandidate = {
    ...candidate,
    sourceRevision: `${candidate.sourceRevision}-v2`,
    compressedText: `${candidate.compressedText}\n修订标记`,
  };
  const second = await novelContextCompressionProvider.apply(secondCandidate);
  const afterSecond = await contextRecordService.getByNovelId('novel-001');
  const versions = afterSecond.filter((record) => record.title.startsWith('小说上下文压缩'));
  assert.equal(versions.length, 2);
  assert.equal(versions.find((record) => record.id === first.recordId)?.isActive, false);
  assert.equal(versions.find((record) => record.id === second.recordId)?.isActive, true);

  await novelContextCompressionProvider.rollback(second);
  const afterRollback = await contextRecordService.getByNovelId('novel-001');
  assert.equal(afterRollback.find((record) => record.id === second.recordId)?.isActive, false);
  assert.equal(afterRollback.find((record) => record.id === first.recordId)?.isActive, true);
  assert.equal(
    afterRollback.filter((record) => record.title.startsWith('小说上下文压缩')).length,
    2,
  );
});

test('workbench compression candidate publishes a card and applies through the decision protocol', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
  localStorage.setItem(
    'ai_novel_studio_chapters',
    JSON.stringify([
      {
        id: 'ch-003',
        novelId: 'novel-001',
        title: '第三章',
        outline: '主角发现关键线索。',
        orderIndex: 2,
        createdAt: '2026-08-20T00:00:00Z',
        updatedAt: '2026-08-20T00:00:00Z',
      },
    ]),
  );
  await contextRecordService.create({
    novelId: 'novel-001',
    contextType: 'foreshadow',
    title: '归途信标',
    content: '殖民地仍有未发出的求救信标。',
    importance: 5,
  });
  await contextRecordService.create({
    novelId: 'novel-001',
    contextType: 'rule',
    title: '跃迁配额',
    content: '跃迁必须消耗核定配额。',
    importance: 4,
  });
  const conversation = await taskConversationService.create('novel-001', '压缩任务');
  const candidate = await novelContextCompressionProvider.propose('novel-001', 4000);
  assert.equal(candidate.valid, true);
  const card = await taskConversationService.publishStructuredCandidate({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    artifactType: 'generic_json',
    derivationType: 'context_compression',
    title: '小说上下文压缩',
    summary: '覆盖率通过',
    structuredPayloadJson: candidate,
  });
  assert.ok(card.artifactId);
  assert.match(card.content, /ans.novel-context.extractive-v1/);
  const applied = await artifactDecisionService.applyStructured({
    conversationId: conversation.conversationId,
    cardId: card.cardId,
    artifactId: card.artifactId ?? '',
    decision: 'request_apply',
    targetType: 'asset',
    targetId: 'novel-001',
    novelId: 'novel-001',
  });
  assert.ok(applied.decision.applyTransactionId);
  assert.equal(applied.decision.conflictCode, undefined);
  const records = await contextRecordService.getByNovelId('novel-001');
  assert.ok(records.some((record) => record.title.startsWith('小说上下文压缩') && record.isActive));
});
