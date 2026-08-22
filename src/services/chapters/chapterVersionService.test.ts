import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChapterVersionService,
  computeProseCounts,
} from './chapterVersionService';

test('computeProseCounts calculates CJK and word counts accurately', () => {
  const counts = computeProseCounts('夜幕降临，林清玄在竹林中小憩。\n周围一片寂静。');
  assert.ok(counts.characterCount > 15);
  assert.ok(counts.wordCount > 15);
});

test('ChapterVersionService creates sequential revisions with provenance', async () => {
  const service = new ChapterVersionService();
  service.reset('chap-001');

  // v1: AI 生成初稿
  const rev1 = await service.createRevision({
    chapterId: 'chap-001',
    novelId: 'novel-001',
    title: '第1章·暗夜潜行',
    content: '林清玄披上夜行衣，悄然离开洞府。\n夜色很深。',
    source: 'ai_generation',
    provenance: {
      modelId: 'qwen3.8-27b-writer',
      providerId: 'local',
      routeReason: 'local_available',
      memorySnapshotVersion: 1,
    },
    summary: 'AI 自动生成初稿',
  });

  assert.equal(rev1.revisionNumber, 1);
  assert.equal(rev1.isAdopted, true); // 首个版本默认采用
  assert.equal(rev1.tag, 'adopted');
  assert.equal(rev1.provenance.modelId, 'qwen3.8-27b-writer');
  assert.equal(rev1.provenance.memorySnapshotVersion, 1);

  // v2: 人工编辑
  const rev2 = await service.createRevision({
    chapterId: 'chap-001',
    novelId: 'novel-001',
    title: '第1章·暗夜潜行',
    content: '林清玄披上夜行衣，悄然离开洞府。\n夜色如墨，寒风刺骨。',
    source: 'user_edit',
    summary: '人工润色环境描写',
  });

  assert.equal(rev2.revisionNumber, 2);
  assert.equal(rev2.isAdopted, false);
  assert.equal(rev2.tag, 'candidate');
  assert.equal(rev2.source, 'user_edit');

  const history = service.listRevisions('chap-001');
  assert.equal(history.length, 2);
  assert.equal(history[0].revisionNumber, 1);
  assert.equal(history[1].revisionNumber, 2);

  service.reset('chap-001');
});

test('ChapterVersionService manages revision adoption and tags', async () => {
  const service = new ChapterVersionService();
  service.reset('chap-002');

  const v1 = await service.createRevision({
    chapterId: 'chap-002',
    novelId: 'novel-001',
    title: '第2章',
    content: '版本一内容',
    source: 'ai_generation',
  });
  const v2 = await service.createRevision({
    chapterId: 'chap-002',
    novelId: 'novel-001',
    title: '第2章',
    content: '版本二内容',
    source: 'ai_revision',
  });

  assert.equal(v1.isAdopted, true);
  assert.equal(v2.isAdopted, false);

  // 采用 v2
  const adoptedV2 = await service.adoptRevision('chap-002', v2.revisionId);
  assert.equal(adoptedV2.isAdopted, true);
  assert.equal(adoptedV2.tag, 'adopted');

  const recheckV1 = service.getRevision('chap-002', v1.revisionId);
  assert.equal(recheckV1?.isAdopted, false);
  assert.equal(recheckV1?.tag, 'draft');

  service.reset('chap-002');
});

test('ChapterVersionService computes Diff between revisions', async () => {
  const service = new ChapterVersionService();
  service.reset('chap-003');

  const v1 = await service.createRevision({
    chapterId: 'chap-003',
    novelId: 'novel-001',
    title: '第3章',
    content: '第一行不变\n第二行旧内容\n第三行旧内容',
    source: 'ai_generation',
  });

  const v2 = await service.createRevision({
    chapterId: 'chap-003',
    novelId: 'novel-001',
    title: '第3章',
    content: '第一行不变\n第二行已修改为新内容\n第三行旧内容\n第四行新增内容',
    source: 'user_edit',
  });

  const diff = service.compareRevisions(v1, v2);

  assert.equal(diff.fromRevisionNumber, 1);
  assert.equal(diff.toRevisionNumber, 2);
  assert.ok(diff.addedLines > 0);
  assert.ok(diff.diffChunks.length >= 3);
  assert.ok(diff.summary.includes('相对 v1'));

  service.reset('chap-003');
});

test('ChapterVersionService executes safe rollback to a previous revision', async () => {
  const service = new ChapterVersionService();
  service.reset('chap-004');

  const v1 = await service.createRevision({
    chapterId: 'chap-004',
    novelId: 'novel-001',
    title: '第4章',
    content: '经典的优质初稿内容',
    source: 'ai_generation',
  });

  await service.createRevision({
    chapterId: 'chap-004',
    novelId: 'novel-001',
    title: '第4章',
    content: '被错误大幅修改的内容',
    source: 'user_edit',
  });

  // 回滚到 v1
  const rolledBack = await service.rollbackToRevision(
    'chap-004',
    v1.revisionId,
    '撤销错误的修改',
  );

  assert.equal(rolledBack.revisionNumber, 3);
  assert.equal(rolledBack.source, 'rollback');
  assert.equal(rolledBack.isAdopted, true);
  assert.equal(rolledBack.content, '经典的优质初稿内容');
  assert.ok(rolledBack.summary?.includes('从版本 v1 回滚'));

  const history = service.listRevisions('chap-004');
  assert.equal(history.length, 3); // 历史完整保留

  service.reset('chap-004');
});
