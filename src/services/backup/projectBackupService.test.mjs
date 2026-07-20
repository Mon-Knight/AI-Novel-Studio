import assert from 'node:assert/strict';
import test from 'node:test';

const backupSchema = await import('./projectBackupSchema.ts');
const localStorageBackup = await import('./projectBackupLocalStorage.ts');
const jsonImport = await import('../import/jsonImportService.ts');

const tables = [
  'world_settings', 'rule_systems', 'protagonists', 'volumes', 'chapters',
  'style_profiles', 'output_profiles', 'imported_assets', 'characters',
  'ai_task_records', 'chapter_drafts', 'chapter_engineering_states',
  'chapter_generation_snapshots', 'generation_jobs', 'generation_step_results',
  'character_states', 'chapter_characters', 'chapter_events', 'chapter_summaries',
  'context_records', 'quality_check_reports', 'quality_check_items', 'polish_records',
  'quality_fix_runs', 'context_read_logs', 'master_outlines', 'volume_outlines',
  'chapter_outlines', 'large_text_documents', 'large_text_chunks',
];

function completeBackup() {
  return {
    type: 'ai_novel_studio_project',
    schemaVersion: 2,
    exportedAt: '2026-07-20T00:00:00.000Z',
    sourceAppVersion: '2.1.2',
    novel: { id: 'novel-1', title: '测试作品' },
    tables: Object.fromEntries(tables.map((name) => [name, []])),
  };
}

test('完整项目备份必须使用受支持的 schema 并包含所有集合', () => {
  const backup = completeBackup();
  assert.equal(backupSchema.isCompleteProjectBackup(backup), true);
  assert.equal(backupSchema.getProjectBackupSummary(backup), '含 0 卷、0 章、0 个正文版本');
});

test('旧版或缺集合的 JSON 不能进入完整恢复链路', () => {
  const legacy = { ...completeBackup(), schemaVersion: 1 };
  assert.equal(backupSchema.isCompleteProjectBackup(legacy), false);

  const incomplete = completeBackup();
  delete incomplete.tables.large_text_chunks;
  assert.equal(backupSchema.isCompleteProjectBackup(incomplete), false);
});

test('损坏或未来版本的完整备份不会降级为旧版项目 JSON', () => {
  const malformed = { ...completeBackup(), schemaVersion: 3 };
  const result = jsonImport.detectJsonImportType(malformed);

  assert.equal(result.type, 'ai_novel_studio_project');
  assert.equal(result.isProjectBackupCandidate, true);
  assert.equal(backupSchema.isCompleteProjectBackup(malformed), false);
});

test('损坏的补充缓存不能通过完整备份校验', () => {
  const malformedCollections = completeBackup();
  malformedCollections.localStorage = { version: 1, collections: null, entries: {} };
  assert.equal(backupSchema.isCompleteProjectBackup(malformedCollections), false);

  const malformedRawEntries = completeBackup();
  malformedRawEntries.localStorage = {
    version: 1,
    collections: {},
    entries: {},
    rawEntries: { outline: 42 },
  };
  assert.equal(backupSchema.isCompleteProjectBackup(malformedRawEntries), false);
});

class MemoryStorage {
  #items = new Map();

  get length() {
    return this.#items.size;
  }

  getItem(key) {
    return this.#items.get(key) ?? null;
  }

  key(index) {
    return [...this.#items.keys()][index] ?? null;
  }

  removeItem(key) {
    this.#items.delete(key);
  }

  setItem(key, value) {
    this.#items.set(key, value);
  }
}

test('项目缓存保留原始大纲、作品记录和本地 generation steps，并重写本地独有 ID', () => {
  const backup = completeBackup();
  backup.novel = { id: 'novel-source', title: '测试作品' };
  backup.tables.chapters = [{ id: 'chapter-source' }];

  const source = new MemoryStorage();
  source.setItem('ai_novel_studio_novels', JSON.stringify([
    { id: 'novel-source', title: '测试作品', currentChapterId: 'chapter-source' },
  ]));
  source.setItem('ai_novel_studio_polish_records', JSON.stringify([
    {
      id: 'polish-local',
      novelId: 'novel-source',
      chapterId: 'chapter-source',
      sourceDraftId: 'draft-local',
    },
  ]));
  source.setItem('ai_novel_studio_generation_jobs', JSON.stringify([
    { id: 'job-local', novelId: 'novel-source', chapterId: 'chapter-source' },
  ]));
  source.setItem('ai_novel_studio_draft_chapter-source', JSON.stringify({
    id: 'draft-local', novelId: 'novel-source', chapterId: 'chapter-source', content: '正文',
  }));
  source.setItem('ai_novel_studio_generation_steps_job-local', JSON.stringify([
    { id: 'step-local', jobId: 'job-local', outputJson: { jobId: 'job-local' } },
  ]));
  source.setItem('ai_novel_studio_unsaved_chapter_outline_chapter-source', '未保存的大纲原文');

  const data = localStorageBackup.collectLocalProjectData(backup, source);
  assert.ok(data);
  assert.equal(data.collections.ai_novel_studio_novels.length, 1);
  assert.ok(data.entries['ai_novel_studio_generation_steps_job-local']);
  assert.equal(
    data.rawEntries['ai_novel_studio_unsaved_chapter_outline_chapter-source'],
    '未保存的大纲原文',
  );

  let sequence = 0;
  const idMap = localStorageBackup.mergeLocalStorageIdMap(
    data,
    { 'novel-source': 'novel-restored', 'chapter-source': 'chapter-restored' },
    () => `local-restored-${++sequence}`,
  );
  assert.equal(idMap['novel-source'], 'novel-restored');
  assert.notEqual(idMap['polish-local'], 'polish-local');
  assert.notEqual(idMap['job-local'], 'job-local');
  assert.notEqual(idMap['draft-local'], 'draft-local');
  assert.notEqual(idMap['step-local'], 'step-local');

  const target = new MemoryStorage();
  localStorageBackup.restoreLocalProjectData(data, idMap, target);

  const novel = JSON.parse(target.getItem('ai_novel_studio_novels'))[0];
  assert.equal(novel.id, 'novel-restored');
  assert.equal(novel.currentChapterId, 'chapter-restored');

  const polish = JSON.parse(target.getItem('ai_novel_studio_polish_records'))[0];
  assert.equal(polish.id, idMap['polish-local']);
  assert.equal(polish.sourceDraftId, idMap['draft-local']);

  const job = JSON.parse(target.getItem('ai_novel_studio_generation_jobs'))[0];
  assert.equal(job.id, idMap['job-local']);
  assert.equal(job.chapterId, 'chapter-restored');

  const stepsKey = `ai_novel_studio_generation_steps_${idMap['job-local']}`;
  const step = JSON.parse(target.getItem(stepsKey))[0];
  assert.equal(step.id, idMap['step-local']);
  assert.equal(step.jobId, idMap['job-local']);
  assert.equal(step.outputJson.jobId, idMap['job-local']);
  assert.equal(
    target.getItem('ai_novel_studio_unsaved_chapter_outline_chapter-restored'),
    '未保存的大纲原文',
  );
});
