export const PROJECT_BACKUP_SCHEMA_VERSION = 3;
export const MIN_SUPPORTED_PROJECT_BACKUP_SCHEMA_VERSION = 2;

export type BackupValue = null | boolean | number | string | BackupValue[] | { [key: string]: BackupValue };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBackupValue(value: unknown): value is BackupValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return true;
  }
  if (Array.isArray(value)) return value.every(isBackupValue);
  return isRecord(value) && Object.values(value).every(isBackupValue);
}

export function isLocalProjectBackupData(data: unknown): data is LocalProjectBackupData {
  if (!isRecord(data) || data.version !== 1 || !isRecord(data.collections) || !isRecord(data.entries)) {
    return false;
  }
  if (!Object.values(data.collections).every((rows) => (
    Array.isArray(rows) && rows.every(isBackupValue)
  ))) {
    return false;
  }
  if (!Object.values(data.entries).every(isBackupValue)) return false;
  return data.rawEntries === undefined || (
    isRecord(data.rawEntries) && Object.values(data.rawEntries).every((value) => typeof value === 'string')
  );
}

export function isCompleteProjectBackup(data: unknown): data is CompleteProjectBackup {
  if (!isRecord(data)) return false;
  if (data.type !== 'ai_novel_studio_project'
    || typeof data.schemaVersion !== 'number'
    || !Number.isInteger(data.schemaVersion)
    || data.schemaVersion < MIN_SUPPORTED_PROJECT_BACKUP_SCHEMA_VERSION
    || data.schemaVersion > PROJECT_BACKUP_SCHEMA_VERSION) return false;
  if (!isRecord(data.novel) || typeof data.novel.id !== 'string' || typeof data.novel.title !== 'string') return false;
  if (!isRecord(data.tables)) return false;
  const tables = data.tables as Record<string, unknown>;
  const requiredTables = data.schemaVersion >= 3
    ? [...REQUIRED_TABLES, 'quality_issue_states']
    : REQUIRED_TABLES;
  return requiredTables.every((table) => Array.isArray(tables[table]))
    && (data.localStorage === undefined || isLocalProjectBackupData(data.localStorage));
}

export function getProjectBackupSummary(backup: CompleteProjectBackup): string {
  const volumes = backup.tables.volumes?.length ?? 0;
  const chapters = backup.tables.chapters?.length ?? 0;
  const drafts = backup.tables.chapter_drafts?.length ?? 0;
  return `含 ${volumes} 卷、${chapters} 章、${drafts} 个正文版本`;
}
