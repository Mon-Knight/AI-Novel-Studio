import type {
  BackupRow,
  BackupValue,
  CompleteProjectBackup,
  LocalProjectBackupData,
} from './projectBackupSchema';

export interface LocalStorageLike {
  readonly length: number;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

type IdFactory = () => string;

const PROJECT_COLLECTION_KEYS = [
  'ai_novel_studio_novels',
  'ai_novel_studio_volumes',
  'ai_novel_studio_chapters',
  'ai_novel_studio_protagonists',
  'ai_novel_studio_world_settings',
  'ai_novel_studio_rule_systems',
  'ai_novel_studio_characters',
  'ai_novel_studio_chapter_characters',
  'ai_novel_studio_chapter_events',
  'ai_novel_studio_character_states',
  'ai_novel_studio_chapter_summaries',
  'ai_novel_studio_context_records',
  'ai_novel_studio_ai_tasks',
  'ai_novel_studio_ai_task_records',
  'ai_novel_studio_style_profiles',
  'ai_novel_studio_output_profiles',
  'ai_novel_studio_imported_assets',
  'ai_novel_studio_quality_reports',
  'ai_novel_studio_quality_items',
  'ai_novel_studio_quality_issue_states',
  'ai_novel_studio_polish_records',
  'ai_novel_studio_fix_runs',
  'ai_novel_studio_setting_suggestions',
  'ai_novel_studio_generation_jobs',
] as const;

const GENERATION_JOBS_KEY = 'ai_novel_studio_generation_jobs';
const CHAPTER_SCOPED_PREFIXES = [
  'ai_novel_studio_drafts_list_',
  'ai_novel_studio_draft_',
  'ai_novel_studio_chapter_engineering_states_',
  'ai_novel_studio_chapter_generation_snapshots_',
  'ai_novel_studio_unsaved_chapter_outline_',
] as const;
const RAW_TEXT_ENTRY_PREFIXES = ['ai_novel_studio_unsaved_chapter_outline_'] as const;
const JOB_SCOPED_PREFIX = 'ai_novel_studio_generation_steps_';

function resolveStorage(storage?: LocalStorageLike): LocalStorageLike | undefined {
  if (storage) return storage;
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

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

function getString(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function getRecordIdSet(rows: BackupRow[] | undefined): Set<string> {
  return new Set(
    (rows ?? [])
      .map((row) => typeof row.id === 'string' ? row.id : undefined)
      .filter((id): id is string => Boolean(id)),
  );
}

function safeParse(raw: string | null): BackupValue | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return isBackupValue(value) ? value : null;
  } catch {
    return null;
  }
}

function belongsToProject(
  value: BackupValue,
  novelId: string,
  chapterIds: Set<string>,
  volumeIds: Set<string>,
  referencedProfileIds: Set<string>,
  jobIds: Set<string>,
): boolean {
  if (!isRecord(value)) return false;
  const owner = getString(value, 'novelId', 'novel_id', 'projectId', 'project_id');
  if (owner === novelId) return true;
  const chapterId = getString(value, 'chapterId', 'chapter_id');
  if (chapterId && chapterIds.has(chapterId)) return true;
  const volumeId = getString(value, 'volumeId', 'volume_id');
  if (volumeId && volumeIds.has(volumeId)) return true;
  const jobId = getString(value, 'jobId', 'job_id');
  if (jobId && jobIds.has(jobId)) return true;
  const id = getString(value, 'id');
  return Boolean(id && referencedProfileIds.has(id));
}

function isSourceNovel(value: BackupValue, novelId: string): boolean {
  return isRecord(value) && value.id === novelId;
}

function sanitizePortableValue(value: BackupValue): BackupValue {
  if (Array.isArray(value)) return value.map(sanitizePortableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (key === 'coverPath' || key === 'cover_path' || key === 'filePath' || key === 'file_path') {
        return [key, null];
      }
      return [key, sanitizePortableValue(entry as BackupValue)];
    }),
  ) as BackupValue;
}

function isRawTextEntry(key: string): boolean {
  return RAW_TEXT_ENTRY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function isChapterScopedKey(key: string, chapterIds: Set<string>): boolean {
  return CHAPTER_SCOPED_PREFIXES.some((prefix) =>
    [...chapterIds].some((chapterId) => key === `${prefix}${chapterId}`),
  );
}

function addRecordId(value: BackupValue, ids: Set<string>): void {
  if (!isRecord(value)) return;
  const id = value.id;
  if (typeof id === 'string' && id) ids.add(id);
}

function collectLocalEntityIds(data: LocalProjectBackupData): Set<string> {
  const ids = new Set<string>();
  for (const rows of Object.values(data.collections)) {
    for (const row of rows) addRecordId(row, ids);
  }
  for (const value of Object.values(data.entries)) {
    if (Array.isArray(value)) {
      for (const entry of value) addRecordId(entry, ids);
    } else {
      addRecordId(value, ids);
    }
  }
  return ids;
}

function createLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function nextAvailableId(factory: IdFactory, usedIds: Set<string>): string {
  for (let attempts = 0; attempts < 100; attempts += 1) {
    const id = factory();
    if (id && !usedIds.has(id)) return id;
  }
  throw new Error('Unable to generate a unique local backup ID.');
}

export function collectLocalProjectData(
  backup: CompleteProjectBackup,
  storage?: LocalStorageLike,
): LocalProjectBackupData | undefined {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) return undefined;

  const novelId = typeof backup.novel.id === 'string' ? backup.novel.id : '';
  if (!novelId) return undefined;
  const chapterIds = getRecordIdSet(backup.tables.chapters);
  const volumeIds = getRecordIdSet(backup.tables.volumes);
  const jobIds = getRecordIdSet(backup.tables.generation_jobs);
  const referencedProfileIds = new Set<string>();
  for (const snapshot of backup.tables.chapter_generation_snapshots ?? []) {
    for (const key of ['style_profile_id', 'output_profile_id', 'styleProfileId', 'outputProfileId']) {
      const id = snapshot[key];
      if (typeof id === 'string') referencedProfileIds.add(id);
    }
  }

  const collections: Record<string, BackupValue[]> = {};
  for (const key of PROJECT_COLLECTION_KEYS) {
    const stored = safeParse(resolvedStorage.getItem(key));
    if (!Array.isArray(stored)) continue;
    const scoped = stored.filter((entry) => (
      key === 'ai_novel_studio_novels'
        ? isSourceNovel(entry, novelId)
        : belongsToProject(entry, novelId, chapterIds, volumeIds, referencedProfileIds, jobIds)
    ));
    if (key === GENERATION_JOBS_KEY) {
      for (const entry of scoped) addRecordId(entry, jobIds);
    }
    if (scoped.length > 0) collections[key] = scoped.map(sanitizePortableValue);
  }

  const entries: Record<string, BackupValue> = {};
  const rawEntries: Record<string, string> = {};
  for (let index = 0; index < resolvedStorage.length; index += 1) {
    const key = resolvedStorage.key(index);
    if (!key) continue;
    const chapterScoped = isChapterScopedKey(key, chapterIds);
    const jobScoped = [...jobIds].some((jobId) => key === `${JOB_SCOPED_PREFIX}${jobId}`);
    if (!chapterScoped && !jobScoped) continue;
    const raw = resolvedStorage.getItem(key);
    if (isRawTextEntry(key)) {
      if (raw !== null) rawEntries[key] = raw;
      continue;
    }
    const value = safeParse(raw);
    if (value !== null) entries[key] = sanitizePortableValue(value);
  }

  const data: LocalProjectBackupData = { version: 1, collections, entries };
  if (Object.keys(rawEntries).length > 0) data.rawEntries = rawEntries;
  return data;
}

export function mergeLocalStorageIdMap(
  data: LocalProjectBackupData | undefined,
  databaseIdMap: Record<string, string>,
  idFactory: IdFactory = createLocalId,
): Record<string, string> {
  const mergedIdMap = { ...databaseIdMap };
  if (!data) return mergedIdMap;

  const usedIds = new Set([...Object.keys(mergedIdMap), ...Object.values(mergedIdMap)]);
  for (const sourceId of collectLocalEntityIds(data)) {
    if (sourceId in mergedIdMap) continue;
    const targetId = nextAvailableId(idFactory, usedIds);
    mergedIdMap[sourceId] = targetId;
    usedIds.add(targetId);
  }
  return mergedIdMap;
}

function remapValue(value: BackupValue, idMap: Record<string, string>): BackupValue {
  if (typeof value === 'string') return idMap[value] ?? value;
  if (Array.isArray(value)) return value.map((entry) => remapValue(entry, idMap));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, remapValue(entry as BackupValue, idMap)]),
    ) as BackupValue;
  }
  return value;
}

function remapStorageKey(key: string, idMap: Record<string, string>): string {
  return Object.entries(idMap).reduce(
    (result, [sourceId, targetId]) => result.split(sourceId).join(targetId),
    key,
  );
}

export function restoreLocalProjectData(
  data: LocalProjectBackupData | undefined,
  idMap: Record<string, string>,
  storage?: LocalStorageLike,
): void {
  const resolvedStorage = resolveStorage(storage);
  if (!data || !resolvedStorage) return;
  const touched = new Map<string, string | null>();
  const remember = (key: string) => {
    if (!touched.has(key)) touched.set(key, resolvedStorage.getItem(key));
  };

  try {
    for (const [key, rows] of Object.entries(data.collections)) {
      const current = safeParse(resolvedStorage.getItem(key));
      const currentRows = Array.isArray(current) ? current : [];
      const remappedRows = rows.map((row) => remapValue(row, idMap));
      remember(key);
      resolvedStorage.setItem(key, JSON.stringify([...currentRows, ...remappedRows]));
    }
    for (const [sourceKey, value] of Object.entries(data.entries)) {
      const key = remapStorageKey(sourceKey, idMap);
      remember(key);
      resolvedStorage.setItem(key, JSON.stringify(remapValue(value, idMap)));
    }
    for (const [sourceKey, value] of Object.entries(data.rawEntries ?? {})) {
      if (typeof value !== 'string') continue;
      const key = remapStorageKey(sourceKey, idMap);
      remember(key);
      resolvedStorage.setItem(key, value);
    }
  } catch (error) {
    for (const snapshot of [...touched.entries()].reverse()) {
      const [key, value] = snapshot;
      if (value === null) resolvedStorage.removeItem(key);
      else resolvedStorage.setItem(key, value);
    }
    throw error;
  }
}
