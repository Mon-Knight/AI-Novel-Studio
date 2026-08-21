import assert from 'node:assert/strict';
import test from 'node:test';

const backupSchema = await import('./projectBackupSchema.ts');
const localStorageBackup = await import('./projectBackupLocalStorage.ts');
const jsonImport = await import('../import/jsonImportService.ts');
const canonical = await import('../ai/compilation/canonical.ts');

const tables = [
  'world_settings',
  'rule_systems',
  'protagonists',
  'volumes',
  'chapters',
  'reference_works',
  'reference_imports',
  'reference_sections',
  'memory_documents',
  'memory_chunks',
  'memory_embeddings',
  'memory_retrieval_logs',
  'style_profiles',
  'output_profiles',
  'imported_assets',
  'characters',
  'ai_task_records',
  'chapter_drafts',
  'autonomous_book_runs',
  'autonomous_run_leases',
  'autonomous_run_chapter_attempts',
  'autonomous_run_checkpoints',
  'chapter_engineering_states',
  'multi_agent_sessions',
  'multi_agent_rounds',
  'multi_agent_opinions',
  'chapter_generation_snapshots',
  'generation_jobs',
  'generation_step_results',
  'character_states',
  'chapter_characters',
  'chapter_events',
  'factions',
  'locations',
  'faction_relations',
  'location_links',
  'character_factions',
  'chapter_factions',
  'chapter_locations',
  'chapter_event_factions',
  'chapter_event_locations',
  'task_conversations',
  'conversation_turns',
  'task_runs',
  'tool_call_events',
  'conversation_artifact_cards',
  'ai_tasks',
  'ai_task_attempts',
  'ai_input_snapshots',
  'ai_context_snapshots',
  'ai_constraint_snapshots',
  'result_artifacts',
  'artifact_validation_issues',
  'artifact_decisions',
  'review_authorizations',
  'chapter_summaries',
  'context_records',
  'quality_check_reports',
  'quality_check_items',
  'quality_issue_states',
  'polish_records',
  'quality_fix_runs',
  'context_read_logs',
  'master_outlines',
  'volume_outlines',
  'chapter_outlines',
  'autonomous_story_plans',
  'large_text_documents',
  'large_text_chunks',
];

const introducedSchema = new Map([
  ['quality_issue_states', 3],
  ['multi_agent_sessions', 4],
  ['multi_agent_rounds', 4],
  ['multi_agent_opinions', 4],
  ['autonomous_story_plans', 5],
  ['reference_works', 6],
  ['reference_imports', 6],
  ['reference_sections', 6],
  ['memory_documents', 7],
  ['memory_chunks', 7],
  ['memory_embeddings', 7],
  ['memory_retrieval_logs', 7],
  ['autonomous_book_runs', 8],
  ['autonomous_run_leases', 8],
  ['autonomous_run_chapter_attempts', 8],
  ['autonomous_run_checkpoints', 8],
  ['factions', 9],
  ['locations', 9],
  ['faction_relations', 9],
  ['location_links', 9],
  ['character_factions', 9],
  ['chapter_factions', 9],
  ['chapter_locations', 9],
  ['chapter_event_factions', 9],
  ['chapter_event_locations', 9],
  ['task_conversations', 10],
  ['conversation_turns', 10],
  ['task_runs', 10],
  ['tool_call_events', 10],
  ['conversation_artifact_cards', 10],
  ['ai_tasks', 10],
  ['ai_task_attempts', 10],
  ['ai_input_snapshots', 10],
  ['ai_context_snapshots', 10],
  ['ai_constraint_snapshots', 10],
  ['result_artifacts', 10],
  ['artifact_validation_issues', 10],
  ['artifact_decisions', 11],
  ['review_authorizations', 11],
]);

function completeBackup(schemaVersion = 11) {
  const schemaTables = tables.filter((name) => schemaVersion >= (introducedSchema.get(name) ?? 2));
  return {
    type: 'ai_novel_studio_project',
    schemaVersion,
    exportedAt: '2026-07-20T00:00:00.000Z',
    sourceAppVersion: '2.1.2',
    novel: { id: 'novel-1', title: '测试作品' },
    tables: Object.fromEntries(schemaTables.map((name) => [name, []])),
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

  const missingCurrentTable = completeBackup();
  delete missingCurrentTable.tables.autonomous_story_plans;
  assert.equal(backupSchema.isCompleteProjectBackup(missingCurrentTable), false);
});

test('schemaVersion 2 备份保持兼容并允许缺少新增质量状态表', () => {
  const previous = completeBackup(2);
  delete previous.tables.quality_issue_states;
  delete previous.tables.multi_agent_sessions;
  delete previous.tables.multi_agent_rounds;
  delete previous.tables.multi_agent_opinions;
  delete previous.tables.autonomous_story_plans;
  delete previous.tables.reference_works;
  delete previous.tables.reference_imports;
  delete previous.tables.reference_sections;
  delete previous.tables.memory_documents;
  delete previous.tables.memory_chunks;
  delete previous.tables.memory_embeddings;
  delete previous.tables.memory_retrieval_logs;
  assert.equal(backupSchema.isCompleteProjectBackup(previous), true);
});

test('schemaVersion 3 备份保持兼容并允许缺少 Multi-Agent 表', () => {
  const previous = completeBackup(3);
  delete previous.tables.multi_agent_sessions;
  delete previous.tables.multi_agent_rounds;
  delete previous.tables.multi_agent_opinions;
  delete previous.tables.autonomous_story_plans;
  delete previous.tables.reference_works;
  delete previous.tables.reference_imports;
  delete previous.tables.reference_sections;
  delete previous.tables.memory_documents;
  delete previous.tables.memory_chunks;
  delete previous.tables.memory_embeddings;
  delete previous.tables.memory_retrieval_logs;
  assert.equal(backupSchema.isCompleteProjectBackup(previous), true);
});

test('schemaVersion 4 backups remain compatible without autonomous planning data', () => {
  const previous = completeBackup(4);
  delete previous.tables.autonomous_story_plans;
  delete previous.tables.reference_works;
  delete previous.tables.reference_imports;
  delete previous.tables.reference_sections;
  delete previous.tables.memory_documents;
  delete previous.tables.memory_chunks;
  delete previous.tables.memory_embeddings;
  delete previous.tables.memory_retrieval_logs;
  assert.equal(backupSchema.isCompleteProjectBackup(previous), true);
});

test('schemaVersion 5 backups remain compatible without reference library data', () => {
  const previous = completeBackup(5);
  delete previous.tables.reference_works;
  delete previous.tables.reference_imports;
  delete previous.tables.reference_sections;
  delete previous.tables.memory_documents;
  delete previous.tables.memory_chunks;
  delete previous.tables.memory_embeddings;
  delete previous.tables.memory_retrieval_logs;
  assert.equal(backupSchema.isCompleteProjectBackup(previous), true);
});

test('schemaVersion 6 备份保持兼容并允许缺少混合语义 Memory 数据', () => {
  const previous = completeBackup(6);
  delete previous.tables.memory_documents;
  delete previous.tables.memory_chunks;
  delete previous.tables.memory_embeddings;
  delete previous.tables.memory_retrieval_logs;
  assert.equal(backupSchema.isCompleteProjectBackup(previous), true);
});

test('schemaVersion 7 accepts Memory backups without scheduler or story assets', () => {
  const previous = completeBackup(7);
  assert.equal(backupSchema.isCompleteProjectBackup(previous), true);
  assert.equal(previous.tables.autonomous_book_runs, undefined);
  assert.equal(previous.tables.factions, undefined);
});

test('schemaVersion 8 requires scheduler tables and still omits story assets', () => {
  const schedulerBackup = completeBackup(8);
  assert.equal(backupSchema.isCompleteProjectBackup(schedulerBackup), true);
  assert.ok(Array.isArray(schedulerBackup.tables.autonomous_book_runs));
  assert.ok(Array.isArray(schedulerBackup.tables.autonomous_run_checkpoints));
  assert.equal(schedulerBackup.tables.factions, undefined);

  delete schedulerBackup.tables.autonomous_run_leases;
  assert.equal(backupSchema.isCompleteProjectBackup(schedulerBackup), false);
});

test('schemaVersion 9 requires all official faction and location asset tables', () => {
  const assetBackup = completeBackup(9);
  assert.equal(backupSchema.isCompleteProjectBackup(assetBackup), true);
  assert.ok(Array.isArray(assetBackup.tables.factions));
  assert.ok(Array.isArray(assetBackup.tables.chapter_event_locations));
  assert.equal(assetBackup.tables.task_conversations, undefined);

  delete assetBackup.tables.locations;
  assert.equal(backupSchema.isCompleteProjectBackup(assetBackup), false);
});

test('schemaVersion 10 requires conversation workbench tables without decisions', () => {
  const workbenchBackup = completeBackup(10);
  assert.equal(backupSchema.isCompleteProjectBackup(workbenchBackup), true);
  assert.ok(Array.isArray(workbenchBackup.tables.task_conversations));
  assert.ok(Array.isArray(workbenchBackup.tables.result_artifacts));
  assert.equal(workbenchBackup.tables.artifact_decisions, undefined);

  delete workbenchBackup.tables.task_runs;
  assert.equal(backupSchema.isCompleteProjectBackup(workbenchBackup), false);
});

test('schemaVersion 11 requires artifact decisions and review authorizations', () => {
  const currentBackup = completeBackup(11);
  assert.equal(backupSchema.PROJECT_BACKUP_SCHEMA_VERSION, 11);
  assert.equal(backupSchema.isCompleteProjectBackup(currentBackup), true);
  assert.ok(Array.isArray(currentBackup.tables.artifact_decisions));
  assert.ok(Array.isArray(currentBackup.tables.review_authorizations));

  delete currentBackup.tables.review_authorizations;
  assert.equal(backupSchema.isCompleteProjectBackup(currentBackup), false);
});

test('非整数 schemaVersion 不得进入 Rust 完整恢复链路', () => {
  const fractional = completeBackup();
  fractional.schemaVersion = 2.5;
  assert.equal(backupSchema.isCompleteProjectBackup(fractional), false);
});

test('损坏或未来版本的完整备份不会降级为旧版项目 JSON', () => {
  const malformed = { ...completeBackup(), schemaVersion: 12 };
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

test('项目缓存保留原始大纲、作品记录和本地 generation steps，并重写本地独有 ID', async () => {
  const backup = completeBackup();
  backup.novel = { id: 'novel-source', title: '测试作品' };
  backup.tables.chapters = [{ id: 'chapter-source' }];

  const source = new MemoryStorage();
  source.setItem(
    'ai_novel_studio_novels',
    JSON.stringify([{ id: 'novel-source', title: '测试作品', currentChapterId: 'chapter-source' }]),
  );
  source.setItem(
    'ai_novel_studio_polish_records',
    JSON.stringify([
      {
        id: 'polish-local',
        novelId: 'novel-source',
        chapterId: 'chapter-source',
        sourceDraftId: 'draft-local',
      },
    ]),
  );
  source.setItem(
    'ai_novel_studio_generation_jobs',
    JSON.stringify([{ id: 'job-local', novelId: 'novel-source', chapterId: 'chapter-source' }]),
  );
  source.setItem(
    'ai_novel_studio_quality_issue_states',
    JSON.stringify([
      {
        id: 'quality-state-local',
        chapterId: 'chapter-source',
        issueKey: 'quality-key-local',
        status: 'resolved',
      },
    ]),
  );
  source.setItem(
    'ai_novel_studio_draft_chapter-source',
    JSON.stringify({
      id: 'draft-local',
      novelId: 'novel-source',
      chapterId: 'chapter-source',
      content: '正文',
    }),
  );
  source.setItem(
    'ai_novel_studio_drafts_list_chapter-source',
    JSON.stringify([
      {
        id: 'draft-local',
        novelId: 'novel-source',
        chapterId: 'chapter-source',
        content: '正文',
      },
      {
        id: 'candidate-local',
        novelId: 'novel-source',
        chapterId: 'chapter-source',
        content: '候选正文',
      },
    ]),
  );
  source.setItem(
    'ai_novel_studio_multi_agent_sessions',
    JSON.stringify([
      {
        session: {
          sessionId: 'session-local',
          operationId: 'operation-local',
          novelId: 'novel-source',
          chapterId: 'chapter-source',
          sourceDraftId: 'draft-local',
          finalDraftId: 'candidate-local',
        },
        rounds: [
          {
            roundNumber: 1,
            inputDraftId: 'draft-local',
            outputDraftId: 'candidate-local',
            expertOpinions: [
              {
                opinionId: 'opinion-local',
                expert: 'quality',
              },
            ],
          },
        ],
      },
      {
        session: {
          sessionId: 'other-session',
          operationId: 'other-operation',
          novelId: 'other-novel',
          chapterId: 'other-chapter',
          sourceDraftId: 'other-draft',
        },
        rounds: [],
      },
    ]),
  );
  source.setItem(
    'ai_novel_studio_autonomous_story_plans',
    JSON.stringify([
      {
        schemaVersion: 1,
        planId: 'plan-local',
        operationId: 'plan-operation-local',
        requestHash: 'stale-request-hash',
        novelId: 'novel-source',
        revision: 1,
        brief: { premise: '旧的创意', targetChapterCount: 12 },
        chapters: [{ id: 'planned-chapter-local', chapterNumber: 1 }],
        volumes: [{ id: 'planned-volume-local', index: 0 }],
      },
    ]),
  );
  source.setItem(
    'ai_novel_studio_generation_steps_job-local',
    JSON.stringify([{ id: 'step-local', jobId: 'job-local', outputJson: { jobId: 'job-local' } }]),
  );
  source.setItem('ai_novel_studio_unsaved_chapter_outline_chapter-source', '未保存的大纲原文');
  source.setItem(
    'ai_novel_studio_reference_library_v1',
    JSON.stringify({
      schemaVersion: 1,
      works: [
        { id: 'reference-work-local', novelId: 'novel-source', title: '参考作品' },
        { id: 'reference-work-other', novelId: 'other-novel', title: '其他参考' },
      ],
      imports: [
        {
          id: 'reference-import-local',
          workId: 'reference-work-local',
          novelId: 'novel-source',
          sourceFilePath: 'C:/private/reference.txt',
        },
        {
          id: 'reference-import-other',
          workId: 'reference-work-other',
          novelId: 'other-novel',
        },
      ],
      sections: [
        {
          id: 'reference-section-local',
          importId: 'reference-import-local',
          workId: 'reference-work-local',
          novelId: 'novel-source',
          content: '参考正文',
        },
        {
          id: 'reference-section-other',
          importId: 'reference-import-other',
          workId: 'reference-work-other',
          novelId: 'other-novel',
          content: '其他正文',
        },
      ],
      operations: { 'operation-reference-local': { workId: 'reference-work-local' } },
    }),
  );

  const data = localStorageBackup.collectLocalProjectData(backup, source);
  assert.ok(data);
  assert.equal(data.collections.ai_novel_studio_novels.length, 1);
  assert.equal(data.collections.ai_novel_studio_quality_issue_states.length, 1);
  assert.equal(data.collections.ai_novel_studio_multi_agent_sessions.length, 1);
  assert.equal(data.collections.ai_novel_studio_autonomous_story_plans.length, 1);
  assert.equal(
    data.collections.ai_novel_studio_multi_agent_sessions[0].session.sessionId,
    'session-local',
  );
  assert.ok(data.entries['ai_novel_studio_generation_steps_job-local']);
  const referenceBackup = data.entries.ai_novel_studio_reference_library_v1;
  assert.equal(referenceBackup.works.length, 1);
  assert.equal(referenceBackup.imports.length, 1);
  assert.equal(referenceBackup.sections.length, 1);
  assert.equal(referenceBackup.imports[0].sourceFilePath, null);
  assert.deepEqual(referenceBackup.operations, {});
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
  assert.notEqual(idMap['quality-state-local'], 'quality-state-local');
  assert.notEqual(idMap['candidate-local'], 'candidate-local');
  assert.notEqual(idMap['session-local'], 'session-local');
  assert.notEqual(idMap['operation-local'], 'operation-local');
  assert.notEqual(idMap['opinion-local'], 'opinion-local');
  assert.notEqual(idMap['plan-local'], 'plan-local');
  assert.notEqual(idMap['plan-operation-local'], 'plan-operation-local');
  assert.notEqual(idMap['planned-chapter-local'], 'planned-chapter-local');
  assert.notEqual(idMap['reference-work-local'], 'reference-work-local');
  assert.notEqual(idMap['reference-import-local'], 'reference-import-local');
  assert.notEqual(idMap['reference-section-local'], 'reference-section-local');
  assert.equal(idMap['other-session'], undefined);
  assert.equal(idMap['reference-work-other'], undefined);

  const target = new MemoryStorage();
  await localStorageBackup.restoreLocalProjectData(data, idMap, target);

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

  const qualityState = JSON.parse(target.getItem('ai_novel_studio_quality_issue_states'))[0];
  assert.equal(qualityState.id, idMap['quality-state-local']);
  assert.equal(qualityState.chapterId, 'chapter-restored');
  assert.equal(qualityState.issueKey, 'quality-key-local');

  const collaboration = JSON.parse(target.getItem('ai_novel_studio_multi_agent_sessions'))[0];
  assert.equal(collaboration.session.sessionId, idMap['session-local']);
  assert.equal(collaboration.session.operationId, idMap['operation-local']);
  assert.equal(collaboration.session.novelId, 'novel-restored');
  assert.equal(collaboration.session.sourceDraftId, idMap['draft-local']);
  assert.equal(collaboration.session.finalDraftId, idMap['candidate-local']);
  assert.equal(collaboration.rounds[0].inputDraftId, idMap['draft-local']);
  assert.equal(collaboration.rounds[0].outputDraftId, idMap['candidate-local']);
  assert.equal(collaboration.rounds[0].expertOpinions[0].opinionId, idMap['opinion-local']);
  const autonomousPlan = JSON.parse(target.getItem('ai_novel_studio_autonomous_story_plans'))[0];
  assert.equal(autonomousPlan.planId, idMap['plan-local']);
  assert.equal(autonomousPlan.operationId, idMap['plan-operation-local']);
  assert.equal(autonomousPlan.novelId, 'novel-restored');
  assert.equal(autonomousPlan.chapters[0].id, idMap['planned-chapter-local']);
  assert.equal(
    autonomousPlan.requestHash,
    await canonical.canonicalHash({
      schemaVersion: 1,
      novelId: 'novel-restored',
      brief: autonomousPlan.brief,
    }),
  );
  assert.equal(
    target.getItem('ai_novel_studio_unsaved_chapter_outline_chapter-restored'),
    '未保存的大纲原文',
  );
  const restoredReferences = JSON.parse(target.getItem('ai_novel_studio_reference_library_v1'));
  assert.equal(restoredReferences.works[0].id, idMap['reference-work-local']);
  assert.equal(restoredReferences.works[0].novelId, 'novel-restored');
  assert.equal(restoredReferences.imports[0].workId, idMap['reference-work-local']);
  assert.equal(restoredReferences.sections[0].importId, idMap['reference-import-local']);
  assert.deepEqual(restoredReferences.operations, {});
});
