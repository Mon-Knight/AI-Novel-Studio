export const PROJECT_BACKUP_SCHEMA_VERSION = 11;
export const MIN_SUPPORTED_PROJECT_BACKUP_SCHEMA_VERSION = 2;

export type BackupValue =
  null | boolean | number | string | BackupValue[] | { [key: string]: BackupValue };
export type BackupRow = Record<string, BackupValue>;

export interface LocalProjectBackupData {
  version: 1;
  collections: Record<string, BackupValue[]>;
  entries: Record<string, BackupValue>;
  rawEntries?: Record<string, string>;
}

export interface CompleteProjectBackup {
  type: 'ai_novel_studio_project';
  schemaVersion: number;
  exportedAt: string;
  sourceAppVersion: string;
  novel: BackupRow;
  tables: Record<string, BackupRow[]>;
  localStorage?: LocalProjectBackupData;
}

export interface ProjectBackupImportResult {
  novelId: string;
  title: string;
  restoredRecords: Record<string, number>;
  idMap: Record<string, string>;
}

const REQUIRED_TABLES = [
  'world_settings',
  'rule_systems',
  'protagonists',
  'volumes',
  'chapters',
  'style_profiles',
  'output_profiles',
  'imported_assets',
  'characters',
  'ai_task_records',
  'chapter_drafts',
  'chapter_engineering_states',
  'chapter_generation_snapshots',
  'generation_jobs',
  'generation_step_results',
  'character_states',
  'chapter_characters',
  'chapter_events',
  'chapter_summaries',
  'context_records',
  'quality_check_reports',
  'quality_check_items',
  'polish_records',
  'quality_fix_runs',
  'context_read_logs',
  'master_outlines',
  'volume_outlines',
  'chapter_outlines',
  'large_text_documents',
  'large_text_chunks',
] as const;

const MULTI_AGENT_TABLES = [
  'multi_agent_sessions',
  'multi_agent_rounds',
  'multi_agent_opinions',
] as const;

const AUTONOMOUS_STORY_TABLES = ['autonomous_story_plans'] as const;

const REFERENCE_LIBRARY_TABLES = [
  'reference_works',
  'reference_imports',
  'reference_sections',
] as const;

const MEMORY_TABLES = [
  'memory_documents',
  'memory_chunks',
  'memory_embeddings',
  'memory_retrieval_logs',
] as const;

const AUTONOMOUS_SCHEDULER_TABLES = [
  'autonomous_book_runs',
  'autonomous_run_leases',
  'autonomous_run_chapter_attempts',
  'autonomous_run_checkpoints',
] as const;

const CONTENT_TRANSACTION_TABLES = [
  'factions',
  'locations',
  'faction_relations',
  'location_links',
  'character_factions',
  'chapter_factions',
  'chapter_locations',
  'chapter_event_factions',
  'chapter_event_locations',
] as const;

const CONVERSATION_WORKBENCH_TABLES = [
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
] as const;

const ARTIFACT_DECISION_TABLES = ['artifact_decisions', 'review_authorizations'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBackupValue(value: unknown): value is BackupValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isBackupValue);
  return isRecord(value) && Object.values(value).every(isBackupValue);
}

export function isLocalProjectBackupData(data: unknown): data is LocalProjectBackupData {
  if (
    !isRecord(data) ||
    data.version !== 1 ||
    !isRecord(data.collections) ||
    !isRecord(data.entries)
  ) {
    return false;
  }
  if (
    !Object.values(data.collections).every(
      (rows) => Array.isArray(rows) && rows.every(isBackupValue),
    )
  ) {
    return false;
  }
  if (!Object.values(data.entries).every(isBackupValue)) return false;
  return (
    data.rawEntries === undefined ||
    (isRecord(data.rawEntries) &&
      Object.values(data.rawEntries).every((value) => typeof value === 'string'))
  );
}

export function isCompleteProjectBackup(data: unknown): data is CompleteProjectBackup {
  if (!isRecord(data)) return false;
  if (
    data.type !== 'ai_novel_studio_project' ||
    typeof data.schemaVersion !== 'number' ||
    !Number.isInteger(data.schemaVersion) ||
    data.schemaVersion < MIN_SUPPORTED_PROJECT_BACKUP_SCHEMA_VERSION ||
    data.schemaVersion > PROJECT_BACKUP_SCHEMA_VERSION
  )
    return false;
  if (
    !isRecord(data.novel) ||
    typeof data.novel.id !== 'string' ||
    typeof data.novel.title !== 'string'
  )
    return false;
  if (!isRecord(data.tables)) return false;
  const tables = data.tables as Record<string, unknown>;
  const requiredTables = [
    ...REQUIRED_TABLES,
    ...(data.schemaVersion >= 3 ? ['quality_issue_states'] : []),
    ...(data.schemaVersion >= 4 ? MULTI_AGENT_TABLES : []),
    ...(data.schemaVersion >= 5 ? AUTONOMOUS_STORY_TABLES : []),
    ...(data.schemaVersion >= 6 ? REFERENCE_LIBRARY_TABLES : []),
    ...(data.schemaVersion >= 7 ? MEMORY_TABLES : []),
    ...(data.schemaVersion >= 8 ? AUTONOMOUS_SCHEDULER_TABLES : []),
    ...(data.schemaVersion >= 9 ? CONTENT_TRANSACTION_TABLES : []),
    ...(data.schemaVersion >= 10 ? CONVERSATION_WORKBENCH_TABLES : []),
    ...(data.schemaVersion >= 11 ? ARTIFACT_DECISION_TABLES : []),
  ];
  const allowedTables = new Set<string>(requiredTables);
  return (
    Object.keys(tables).every((table) => allowedTables.has(table)) &&
    requiredTables.every((table) => Array.isArray(tables[table])) &&
    (data.localStorage === undefined || isLocalProjectBackupData(data.localStorage))
  );
}

export function getProjectBackupSummary(backup: CompleteProjectBackup): string {
  const volumes = backup.tables.volumes?.length ?? 0;
  const chapters = backup.tables.chapters?.length ?? 0;
  const drafts = backup.tables.chapter_drafts?.length ?? 0;
  return `含 ${volumes} 卷、${chapters} 章、${drafts} 个正文版本`;
}
