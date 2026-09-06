import type {
  BackupRow,
  BackupValue,
  CompleteProjectBackup,
  LocalProjectBackupData,
} from './projectBackupSchema';
import { canonicalHash } from '../ai/compilation/canonical.ts';
import {
  LOCAL_BACKUP_POLICY,
  parseLocalBackupEntryKey,
  validateLocalProjectBackup,
} from './projectBackupLocalStoragePolicy.ts';

export interface LocalStorageLike {
  readonly length: number;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

type IdFactory = () => string;

const PROJECT_COLLECTION_KEYS = LOCAL_BACKUP_POLICY.collections;

const AUTONOMOUS_PLANS_KEY = 'ai_novel_studio_autonomous_story_plans';
const GENERATION_JOBS_KEY = 'ai_novel_studio_generation_jobs';
const REFERENCE_LIBRARY_KEY = LOCAL_BACKUP_POLICY.referenceLibraryKey;
const CHAPTER_SCOPED_PREFIXES = [
  ...LOCAL_BACKUP_POLICY.chapterPrefixes,
  LOCAL_BACKUP_POLICY.rawChapterPrefix,
] as const;
const RAW_TEXT_ENTRY_PREFIXES = [LOCAL_BACKUP_POLICY.rawChapterPrefix];
const JOB_SCOPED_PREFIX = LOCAL_BACKUP_POLICY.jobPrefix;

function resolveStorage(storage?: LocalStorageLike): LocalStorageLike | undefined {
  if (storage) return storage;
  return typeof localStorage === 'undefined' ? undefined : localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBackupRecord(value: BackupValue): value is { [key: string]: BackupValue } {
  return isRecord(value);
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
      .map((row) => (typeof row.id === 'string' ? row.id : undefined))
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
  if (isRecord(value.session)) {
    return belongsToProject(
      value.session as BackupValue,
      novelId,
      chapterIds,
      volumeIds,
      referencedProfileIds,
      jobIds,
    );
  }
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
      if (
        [
          'coverPath',
          'cover_path',
          'filePath',
          'file_path',
          'sourceFilePath',
          'source_file_path',
        ].includes(key)
      ) {
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
  for (const key of LOCAL_BACKUP_POLICY.identityKeys) {
    const id = value[key];
    if (typeof id === 'string' && id) ids.add(id);
  }
  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) nested.forEach((entry) => addRecordId(entry as BackupValue, ids));
    else if (isRecord(nested)) addRecordId(nested as BackupValue, ids);
  }
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
    for (const key of [
      'style_profile_id',
      'output_profile_id',
      'styleProfileId',
      'outputProfileId',
    ]) {
      const id = snapshot[key];
      if (typeof id === 'string') referencedProfileIds.add(id);
    }
  }

  const collections: Record<string, BackupValue[]> = {};
  for (const key of PROJECT_COLLECTION_KEYS) {
    const stored = safeParse(resolvedStorage.getItem(key));
    if (!Array.isArray(stored)) continue;
    const scoped = stored.filter((entry) =>
      key === 'ai_novel_studio_novels'
        ? isSourceNovel(entry, novelId)
        : belongsToProject(entry, novelId, chapterIds, volumeIds, referencedProfileIds, jobIds),
    );
    if (key === GENERATION_JOBS_KEY) {
      for (const entry of scoped) addRecordId(entry, jobIds);
    }
    if (scoped.length > 0) collections[key] = scoped.map(sanitizePortableValue);
  }

  const entries: Record<string, BackupValue> = {};
  const rawEntries: Record<string, string> = {};
  const referenceState = safeParse(resolvedStorage.getItem(REFERENCE_LIBRARY_KEY));
  if (
    isRecord(referenceState) &&
    Array.isArray(referenceState.works) &&
    Array.isArray(referenceState.imports) &&
    Array.isArray(referenceState.sections)
  ) {
    const works = referenceState.works.filter(
      (work): work is { [key: string]: BackupValue } =>
        isBackupRecord(work) && getString(work, 'novelId', 'novel_id') === novelId,
    );
    const workIds = new Set(
      works.map((work) => getString(work, 'id')).filter((id): id is string => Boolean(id)),
    );
    const imports = referenceState.imports.filter(
      (item): item is { [key: string]: BackupValue } =>
        isBackupRecord(item) && workIds.has(getString(item, 'workId', 'reference_work_id') ?? ''),
    );
    const importIds = new Set(
      imports.map((item) => getString(item, 'id')).filter((id): id is string => Boolean(id)),
    );
    const sections = referenceState.sections.filter(
      (item): item is { [key: string]: BackupValue } =>
        isBackupRecord(item) &&
        importIds.has(getString(item, 'importId', 'reference_import_id') ?? ''),
    );
    if (works.length > 0) {
      entries[REFERENCE_LIBRARY_KEY] = sanitizePortableValue({
        schemaVersion: 1,
        works,
        imports,
        sections,
        operations: {},
      } as BackupValue);
    }
  }
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
  validateLocalProjectBackup(backup, data);
  return data;
}

export function mergeLocalStorageIdMap(
  data: LocalProjectBackupData | undefined,
  databaseIdMap: Record<string, string>,
  idFactory: IdFactory = createLocalId,
): Record<string, string> {
  const mergedIdMap: Record<string, string> = Object.assign(Object.create(null), databaseIdMap);
  if (!data) return mergedIdMap;

  const usedIds = new Set([...Object.keys(mergedIdMap), ...Object.values(mergedIdMap)]);
  for (const sourceId of collectLocalEntityIds(data)) {
    if (Object.prototype.hasOwnProperty.call(mergedIdMap, sourceId)) continue;
    const targetId = nextAvailableId(idFactory, usedIds);
    mergedIdMap[sourceId] = targetId;
    usedIds.add(targetId);
  }
  return mergedIdMap;
}

function remapValue(value: BackupValue, idMap: Record<string, string>): BackupValue {
  if (typeof value === 'string') {
    return Object.prototype.hasOwnProperty.call(idMap, value) ? idMap[value] : value;
  }
  if (Array.isArray(value)) return value.map((entry) => remapValue(entry, idMap));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, remapValue(entry as BackupValue, idMap)]),
    ) as BackupValue;
  }
  return value;
}

function remapStorageKey(key: string, idMap: Record<string, string>, raw = false): string {
  if (!raw && key === REFERENCE_LIBRARY_KEY) return key;
  const { prefix, id } = parseLocalBackupEntryKey(key, raw);
  const targetId = Object.prototype.hasOwnProperty.call(idMap, id) ? idMap[id] : undefined;
  if (!targetId) throw new Error('项目备份的补充缓存缺少作用域 ID 映射。');
  return `${prefix}${targetId}`;
}

function mergeReferenceLibraryState(
  current: BackupValue | null,
  incoming: BackupValue,
): BackupValue {
  const empty = { schemaVersion: 1, works: [], imports: [], sections: [], operations: {} };
  if (
    current !== null &&
    (!isRecord(current) ||
      !Array.isArray(current.works) ||
      !Array.isArray(current.imports) ||
      !Array.isArray(current.sections) ||
      !isRecord(current.operations))
  ) {
    throw new Error('现有参考资料缓存无效，已停止恢复。');
  }
  const existingIds = new Set<string>();
  const incomingIds = new Set<string>();
  if (current !== null) addRecordId(current, existingIds);
  addRecordId(incoming, incomingIds);
  if ([...incomingIds].some((id) => existingIds.has(id))) {
    throw new Error('项目备份的参考资料缓存目标 ID 已存在。');
  }
  const currentState = isRecord(current) ? current : empty;
  const incomingState = isRecord(incoming) ? incoming : empty;
  return {
    schemaVersion: 1,
    works: [
      ...(Array.isArray(currentState.works) ? currentState.works : []),
      ...(Array.isArray(incomingState.works) ? incomingState.works : []),
    ],
    imports: [
      ...(Array.isArray(currentState.imports) ? currentState.imports : []),
      ...(Array.isArray(incomingState.imports) ? incomingState.imports : []),
    ],
    sections: [
      ...(Array.isArray(currentState.sections) ? currentState.sections : []),
      ...(Array.isArray(incomingState.sections) ? incomingState.sections : []),
    ],
    operations: isRecord(currentState.operations) ? currentState.operations : {},
  } as BackupValue;
}

async function refreshLocalAutonomousPlan(value: BackupValue): Promise<BackupValue> {
  if (
    !isRecord(value) ||
    typeof value.schemaVersion !== 'number' ||
    typeof value.novelId !== 'string' ||
    !isRecord(value.brief)
  ) {
    throw new Error('Restored autonomous plan has an invalid identity.');
  }
  return {
    ...value,
    requestHash: await canonicalHash({
      schemaVersion: value.schemaVersion,
      novelId: value.novelId,
      brief: value.brief,
    }),
  } as BackupValue;
}

export async function restoreLocalProjectData(
  backup: CompleteProjectBackup,
  idMap: Record<string, string>,
  storage?: LocalStorageLike,
): Promise<void> {
  const data = backup.localStorage;
  validateLocalProjectBackup(backup, data);
  const resolvedStorage = resolveStorage(storage);
  if (!data || !resolvedStorage) return;
  const sources = new Set(Object.keys(idMap));
  const targets = Object.values(idMap);
  if (
    sources.has('__proto__') ||
    sources.has('constructor') ||
    sources.has('prototype') ||
    targets.some(
      (id) => !id || sources.has(id) || LOCAL_BACKUP_POLICY.forbiddenKeys.includes(id),
    ) ||
    new Set(targets).size !== targets.length ||
    [...collectLocalEntityIds(data)].some((id) => !sources.has(id)) ||
    !idMap[String(backup.novel.id)]
  )
    throw new Error('项目备份的补充缓存 ID 映射无效或冲突。');
  // Complete all asynchronous preparation before observing/writing LocalStorage.
  // Raw attachment keys never become write targets; only this validated plan does.
  const collections = await Promise.all(
    Object.entries(data.collections).map(async ([key, rows]) => {
      let remappedRows = rows.map((row) => remapValue(row, idMap));
      if (key === AUTONOMOUS_PLANS_KEY) {
        remappedRows = await Promise.all(remappedRows.map(refreshLocalAutonomousPlan));
      }
      return [key, remappedRows] as const;
    }),
  );
  const plan = new Map<string, string>();
  const append = (key: string, value: string) => {
    if (plan.has(key)) throw new Error('项目备份的补充缓存包含重复写入目标。');
    plan.set(key, value);
  };
  for (const [key, incoming] of collections) {
    const raw = resolvedStorage.getItem(key);
    const current = safeParse(raw);
    if (raw !== null && !Array.isArray(current)) throw new Error('现有项目缓存无效，已停止恢复。');
    const currentRows = Array.isArray(current) ? current : [];
    const existingIds = new Set<string>();
    currentRows.forEach((row) => addRecordId(row, existingIds));
    const incomingIds = new Set<string>();
    incoming.forEach((row) => addRecordId(row, incomingIds));
    if ([...incomingIds].some((id) => existingIds.has(id)))
      throw new Error('项目备份的补充缓存目标 ID 已存在。');
    append(key, JSON.stringify([...currentRows, ...incoming]));
  }
  for (const [sourceKey, value] of Object.entries(data.entries)) {
    const key = remapStorageKey(sourceKey, idMap);
    const remapped = remapValue(value, idMap);
    const existingRaw = resolvedStorage.getItem(key);
    const existing = safeParse(existingRaw);
    if (key !== REFERENCE_LIBRARY_KEY && existingRaw !== null) {
      throw new Error('项目备份的补充缓存写入目标已存在。');
    }
    if (key === REFERENCE_LIBRARY_KEY && existingRaw !== null && existing === null) {
      throw new Error('现有参考资料缓存无效，已停止恢复。');
    }
    const restored =
      key === REFERENCE_LIBRARY_KEY ? mergeReferenceLibraryState(existing, remapped) : remapped;
    append(key, JSON.stringify(restored));
  }
  for (const [sourceKey, value] of Object.entries(data.rawEntries ?? {})) {
    const key = remapStorageKey(sourceKey, idMap, true);
    if (resolvedStorage.getItem(key) !== null)
      throw new Error('项目备份的补充缓存写入目标已存在。');
    append(key, value);
  }
  const touched = new Map<string, string | null>();
  const remember = (key: string) => {
    if (!touched.has(key)) touched.set(key, resolvedStorage.getItem(key));
  };

  try {
    for (const [key, value] of plan) {
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
