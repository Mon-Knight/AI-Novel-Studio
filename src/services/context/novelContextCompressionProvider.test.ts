import test from 'node:test';
import assert from 'node:assert/strict';
import { mockNovels } from '../../features/novels/mockNovels';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { artifactDecisionService } from '../conversation/artifactDecisionService';
import { taskConversationService } from '../conversation/taskConversationService';
import { settingRepository } from '../database/settingRepository';
import { volumeRepository } from '../database/volumeRepository';
import {
  chapterOutlineService,
  masterOutlineService,
  volumeOutlineService,
} from '../outlines/outlineService';
import { outputProfileService } from '../styles/outputProfileService';
import { styleProfileService } from '../styles/styleProfileService';
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
  snapshot() {
    return [...this.values.entries()].sort(([left], [right]) => left.localeCompare(right));
  }
}

test('compression source includes formal settings, outlines and active generation profiles', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
  localStorage.setItem(
    'ai_novel_studio_chapters',
    JSON.stringify([
      {
        id: 'chapter-formal',
        novelId: 'novel-001',
        volumeId: 'volume-formal',
        title: '正式章节',
        outline: '旧章节摘要',
        orderIndex: 0,
        chapterNumber: 1,
        createdAt: '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-08-20T00:00:00.000Z',
      },
    ]),
  );

  const originals = {
    getWorldSettings: settingRepository.getWorldSettings,
    getRuleSystems: settingRepository.getRuleSystems,
    getVolumes: volumeRepository.getByNovelId,
    getMasterOutline: masterOutlineService.getActive,
    getVolumeOutline: volumeOutlineService.getActive,
    getChapterOutline: chapterOutlineService.getActive,
    getStyles: styleProfileService.getAll,
    getOutputs: outputProfileService.getAll,
  };
  let worldUpdatedAt = '2026-08-20T01:00:00.000Z';
  settingRepository.getWorldSettings = async () => [
    {
      id: 'world-formal',
      novelId: 'novel-001',
      title: '雾城世界',
      content: '记忆可以被储存与交易。',
      isActive: true,
      createdAt: '2026-08-20T01:00:00.000Z',
      updatedAt: worldUpdatedAt,
    },
  ];
  settingRepository.getRuleSystems = async () => [
    {
      id: 'rule-formal',
      novelId: 'novel-001',
      title: '记忆守恒',
      category: 'technology',
      content: '取出记忆必然留下空缺。',
      forbiddenRules: '不存在无代价恢复。',
      isActive: true,
      createdAt: '2026-08-20T02:00:00.000Z',
      updatedAt: '2026-08-20T02:00:00.000Z',
    },
  ];
  volumeRepository.getByNovelId = async () => [
    {
      id: 'volume-formal',
      novelId: 'novel-001',
      title: '第一卷',
      orderIndex: 0,
      volumeNumber: 1,
      sortOrder: 0,
      status: 'writing',
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
    },
  ];
  masterOutlineService.getActive = async () => ({
    id: 'master-formal',
    projectId: 'novel-001',
    title: '失忆调查总纲',
    content: '调查逐步揭开城市真相。',
    status: 'active',
    version: 2,
    isActive: true,
    sourceType: 'manual',
    createdAt: '2026-08-20T03:00:00.000Z',
    updatedAt: '2026-08-20T03:00:00.000Z',
  });
  volumeOutlineService.getActive = async () => ({
    id: 'volume-outline-formal',
    projectId: 'novel-001',
    volumeId: 'volume-formal',
    volumeIndex: 0,
    title: '旧城调查卷纲',
    content: '主角进入旧城寻找证人。',
    status: 'active',
    version: 1,
    isActive: true,
    sourceType: 'manual',
    createdAt: '2026-08-20T04:00:00.000Z',
    updatedAt: '2026-08-20T04:00:00.000Z',
  });
  chapterOutlineService.getActive = async () => ({
    id: 'chapter-outline-formal',
    projectId: 'novel-001',
    chapterId: 'chapter-formal',
    chapterIndex: 0,
    title: '雨夜来客章纲',
    content: '雨夜来客留下空白档案。',
    status: 'active',
    version: 3,
    isActive: true,
    sourceType: 'manual',
    createdAt: '2026-08-20T05:00:00.000Z',
    updatedAt: '2026-08-20T05:00:00.000Z',
  });
  styleProfileService.getAll = async () => [
    {
      id: 'style-formal',
      novelId: 'novel-001',
      name: '冷峻悬疑',
      sourceType: 'manual',
      targetWordsPerChapter: 4_000,
      rhythmPreference: 'moderate',
      narrativePerspective: '第三人称有限',
      tone: '克制',
      dialogueRatio: 0.3,
      descriptionRatio: 0.4,
      prohibitedStyles: ['解释性独白'],
      isActive: true,
      createdAt: '2026-08-20T06:00:00.000Z',
      updatedAt: '2026-08-20T06:00:00.000Z',
    },
  ];
  outputProfileService.getAll = async () => [
    {
      id: 'output-formal',
      novelId: 'novel-001',
      name: '四千字输出',
      chapterWordRange: { min: 3_500, max: 4_500, default: 4_000 },
      paragraphLength: 'medium',
      povType: 'third_person_limited',
      tenseType: 'past',
      endingHookRequired: true,
      isDefault: true,
      createdAt: '2026-08-20T07:00:00.000Z',
      updatedAt: '2026-08-20T07:00:00.000Z',
    },
  ];

  try {
    const candidate = await novelContextCompressionProvider.propose('novel-001', 8_000);
    assert.equal(candidate.valid, true);
    assert.deepEqual(candidate.coverage.world.required, ['雾城世界']);
    assert.deepEqual(candidate.coverage.rules.required, ['记忆守恒']);
    assert.deepEqual(candidate.coverage.outlines.required, [
      '失忆调查总纲',
      '旧城调查卷纲',
      '雨夜来客章纲',
    ]);
    assert.deepEqual(candidate.coverage.style.required, ['冷峻悬疑']);
    assert.deepEqual(candidate.coverage.output.required, ['四千字输出']);
    assert.match(candidate.compressedText, /记忆可以被储存与交易/);
    assert.match(candidate.compressedText, /不存在无代价恢复/);
    assert.match(candidate.compressedText, /调查逐步揭开城市真相/);
    assert.match(candidate.compressedText, /第三人称有限/);
    assert.match(candidate.compressedText, /四千字输出/);

    worldUpdatedAt = '2026-08-20T08:00:00.000Z';
    const revised = await novelContextCompressionProvider.propose('novel-001', 8_000);
    assert.notEqual(revised.sourceRevision, candidate.sourceRevision);
  } finally {
    settingRepository.getWorldSettings = originals.getWorldSettings;
    settingRepository.getRuleSystems = originals.getRuleSystems;
    volumeRepository.getByNovelId = originals.getVolumes;
    masterOutlineService.getActive = originals.getMasterOutline;
    volumeOutlineService.getActive = originals.getVolumeOutline;
    chapterOutlineService.getActive = originals.getChapterOutline;
    styleProfileService.getAll = originals.getStyles;
    outputProfileService.getAll = originals.getOutputs;
  }
});

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
  assert.equal(compressed[0].content, candidate.compressedText);
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

test('workbench compression apply fails closed while persisting its browser decision audit', async () => {
  const storage = new MemoryStorage();
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    storage as unknown as Storage;
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
  assert.match(card.content ?? '', /ans.novel-context.extractive-v1/);
  const storageBeforeApply = storage.snapshot();
  const recordsBeforeApply = await contextRecordService.getByNovelId('novel-001');
  const originalApply = novelContextCompressionProvider.apply;
  let domainApplyCalls = 0;
  novelContextCompressionProvider.apply = async (...args) => {
    domainApplyCalls += 1;
    return originalApply(...args);
  };
  const input = {
    conversationId: conversation.conversationId,
    cardId: card.cardId,
    artifactId: card.artifactId ?? '',
    decision: 'request_apply' as const,
    targetType: 'asset',
    targetId: 'novel-001',
    novelId: 'novel-001',
  };
  let first;
  let replay;
  try {
    first = await artifactDecisionService.applyStructured(input);
    replay = await artifactDecisionService.applyStructured(input);
  } finally {
    novelContextCompressionProvider.apply = originalApply;
  }

  assert.equal(first.decision.conflictCode, 'BROWSER_APPLY_UNSUPPORTED');
  assert.equal(first.decision.applyTransactionId, undefined);
  assert.equal(replay.decision.conflictCode, 'BROWSER_APPLY_UNSUPPORTED');
  assert.equal(replay.decision.decisionId, first.decision.decisionId);
  assert.equal(replay.decision.idempotencyKey, first.decision.idempotencyKey);
  assert.equal(domainApplyCalls, 0);
  const withoutConversationAudit = (entries: Array<[string, string]>) =>
    entries.filter(([key]) => key !== 'ai_novel_studio_task_conversations');
  assert.deepEqual(
    withoutConversationAudit(storage.snapshot()),
    withoutConversationAudit(storageBeforeApply),
  );
  const conversationAfterApply = await taskConversationService.get(conversation.conversationId);
  assert.equal(conversationAfterApply?.conversation.status, 'failed');
  assert.equal(conversationAfterApply?.decisions?.length, 1);
  assert.equal(conversationAfterApply?.decisions?.[0].conflictCode, 'BROWSER_APPLY_UNSUPPORTED');
  assert.equal(
    conversationAfterApply?.artifacts[0].latestDecision?.decisionId,
    first.decision.decisionId,
  );
  const records = await contextRecordService.getByNovelId('novel-001');
  assert.deepEqual(records, recordsBeforeApply);
  assert.equal(
    records.some((record) => record.title.startsWith('小说上下文压缩')),
    false,
  );
});

test('desktop rejects generic_json derivation metadata without a valid compression payload', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalRecord = artifactDecisionService.record;
  const originalGetArtifact = aiTaskRuntimeService.getArtifact;
  let recordCalls = 0;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI__: {} },
  });
  artifactDecisionService.record = async () => {
    recordCalls += 1;
    throw new Error('unrecognized context compression must not record an apply decision');
  };
  aiTaskRuntimeService.getArtifact = async () => ({
    artifact: {
      artifactId: 'artifact-desktop',
      taskId: 'task-desktop',
      attemptId: 'attempt-desktop',
      sourceInputSnapshotId: 'snapshot-desktop',
      artifactType: 'generic_json',
      schemaVersion: 1,
      rawContentRefId: 'raw-desktop',
      sourceNovelId: 'novel-001',
      contentHash: 'artifact-hash',
      contentLength: 2,
      processingStatus: 'valid',
      derivationType: 'context_compression',
      createdAt: '2026-08-27T00:00:00Z',
    },
    rawContent: '{}',
    issues: [],
  });

  try {
    await assert.rejects(
      artifactDecisionService.applyStructured({
        conversationId: 'conversation-desktop',
        cardId: 'card-desktop',
        artifactId: 'artifact-desktop',
        decision: 'request_apply',
        targetType: 'asset',
        targetId: 'novel-001',
        novelId: 'novel-001',
      }),
      /不支持原子应用/,
    );
    assert.equal(recordCalls, 0);
  } finally {
    artifactDecisionService.record = originalRecord;
    aiTaskRuntimeService.getArtifact = originalGetArtifact;
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
