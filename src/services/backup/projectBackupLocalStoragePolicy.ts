import policy from './projectBackupLocalStoragePolicy.json' with { type: 'json' };
import type { CompleteProjectBackup, LocalProjectBackupData } from './projectBackupSchema';

// The Rust import boundary reads the same policy, before opening its transaction.
export const LOCAL_BACKUP_POLICY = policy;
type Row = Record<string, unknown>;
type BackupScope = Pick<CompleteProjectBackup, 'novel' | 'tables'>;

function fail(): never {
  throw new Error('项目备份的补充缓存包含不支持的键、无效记录或跨项目作用域。');
}

function record(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeTree(value: unknown, depth = 0): void {
  if (depth > 100) fail();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail();
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => safeTree(entry, depth + 1));
    return;
  }
  if (!record(value)) fail();
  for (const [key, entry] of Object.entries(value)) {
    if (policy.forbiddenKeys.includes(key)) fail();
    if (policy.identityKeys.includes(key)) strings(value, [key]);
    safeTree(entry, depth + 1);
  }
}

function strings(row: Row, keys: readonly string[]): string[] {
  return keys.flatMap((key) => {
    const value = row[key];
    if (value === undefined || value === null || value === '') return [];
    if (typeof value !== 'string' || !value.trim() || policy.forbiddenKeys.includes(value)) fail();
    return [value];
  });
}

function rows(value: unknown): Row[] {
  if (!Array.isArray(value) || !value.every(record)) fail();
  return value;
}

function ids(value: unknown): Set<string> {
  return new Set(rows(value ?? []).flatMap((row) => strings(row, ['id'])));
}

interface Scope {
  novelId: string;
  chapters: Set<string>;
  volumes: Set<string>;
  jobs: Set<string>;
  profiles: Set<string>;
  drafts: Map<string, string>;
}

function checkLinks(row: Row, keys: readonly string[], allowed: Set<string>): boolean {
  const values = strings(row, keys);
  if (values.some((value) => !allowed.has(value))) fail();
  return values.length > 0;
}

function chapterOf(row: Row, inherited?: string): string | undefined {
  const chapters = strings(row, policy.directChapterKeys);
  if (new Set(chapters).size > 1) fail();
  return chapters[0] ?? inherited;
}

function registerDraft(row: Row, scope: Scope, chapterId: string): void {
  const id = strings(row, ['id'])[0];
  if (!id || !scope.chapters.has(chapterId)) fail();
  if (strings(row, policy.ownerKeys).some((owner) => owner !== scope.novelId)) fail();
  if (chapterOf(row, chapterId) !== chapterId) fail();
  if (scope.drafts.has(id) && scope.drafts.get(id) !== chapterId) fail();
  scope.drafts.set(id, chapterId);
}

function checkTree(
  value: unknown,
  scope: Scope,
  inheritedChapter?: string,
  checkDrafts = true,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => checkTree(entry, scope, inheritedChapter, checkDrafts));
  } else if (record(value)) {
    if (strings(value, policy.ownerKeys).some((id) => id !== scope.novelId)) fail();
    checkLinks(value, policy.chapterKeys, scope.chapters);
    checkLinks(value, policy.volumeKeys, scope.volumes);
    checkLinks(value, policy.jobKeys, scope.jobs);
    const chapter = chapterOf(value, inheritedChapter);
    if (checkDrafts) {
      for (const id of strings(value, policy.draftKeys)) {
        const ownerChapter = scope.drafts.get(id);
        if (!ownerChapter || (chapter && ownerChapter !== chapter)) fail();
      }
      // Autonomous predecessor candidates intentionally come from a different chapter.
      if (strings(value, policy.crossChapterDraftKeys).some((id) => !scope.drafts.has(id))) fail();
    }
    Object.values(value).forEach((entry) => checkTree(entry, scope, chapter, checkDrafts));
  }
}

function checkRecord(
  value: Row,
  scope: Scope,
  inherited = false,
  profile = false,
  checkDrafts = true,
): void {
  const root = record(value.session) ? value.session : value;
  const owners = strings(root, policy.ownerKeys);
  if (owners.some((id) => id !== scope.novelId)) fail();
  const chapter = checkLinks(root, policy.chapterKeys, scope.chapters);
  const volume = checkLinks(root, policy.volumeKeys, scope.volumes);
  const job = checkLinks(root, policy.jobKeys, scope.jobs);
  const linkedProfile = profile && strings(root, ['id']).some((id) => scope.profiles.has(id));
  if (!inherited && !owners.length && !chapter && !volume && !job && !linkedProfile) fail();
  checkTree(value, scope, chapterOf(root), checkDrafts);
}

export function parseLocalBackupEntryKey(
  key: string,
  raw: boolean,
): { prefix: string; id: string; scope: 'chapter' | 'job' } {
  const prefixes = raw ? [policy.rawChapterPrefix] : [...policy.chapterPrefixes, policy.jobPrefix];
  const prefix = prefixes.find((item) => key.startsWith(item));
  if (!prefix || key.length === prefix.length) fail();
  return {
    prefix,
    id: key.slice(prefix.length),
    scope: prefix === policy.jobPrefix ? 'job' : 'chapter',
  };
}

function validateReferenceLibrary(value: unknown, scope: Scope): void {
  if (!record(value) || value.schemaVersion !== 1 || !record(value.operations)) fail();
  if (Object.keys(value.operations).length) fail();
  const works = rows(value.works);
  const imports = rows(value.imports);
  const sections = rows(value.sections);
  const workIds = ids(works);
  const importIds = ids(imports);
  for (const work of works) checkRecord(work, scope);
  for (const item of imports) {
    if (!checkLinks(item, ['workId', 'reference_work_id'], workIds)) fail();
    checkRecord(item, scope, true);
  }
  for (const section of sections) {
    if (!checkLinks(section, ['importId', 'reference_import_id'], importIds)) fail();
    checkLinks(section, ['workId', 'reference_work_id'], workIds);
    checkRecord(section, scope, true);
  }
}

/** Pure preflight: no storage reads, ID generation, IPC or writes. */
export function validateLocalProjectBackupShape(
  data: unknown,
): asserts data is LocalProjectBackupData | undefined {
  if (data === undefined) return;
  safeTree(data);
  if (!record(data) || data.version !== 1 || !record(data.collections) || !record(data.entries))
    fail();
  if (
    Object.keys(data).some(
      (key) => !['version', 'collections', 'entries', 'rawEntries'].includes(key),
    )
  )
    fail();
  const rawEntries = data.rawEntries === undefined ? {} : data.rawEntries;
  if (!record(rawEntries)) fail();
  for (const [key, collection] of Object.entries(data.collections)) {
    if (!policy.collections.includes(key)) fail();
    rows(collection);
  }
  for (const key of Object.keys(data.entries)) {
    if (key !== policy.referenceLibraryKey) parseLocalBackupEntryKey(key, false);
  }
  for (const [key, value] of Object.entries(rawEntries)) {
    parseLocalBackupEntryKey(key, true);
    if (typeof value !== 'string') fail();
  }
}

export function validateLocalProjectBackup(
  backup: BackupScope,
  data: unknown,
): asserts data is LocalProjectBackupData | undefined {
  validateLocalProjectBackupShape(data);
  if (data === undefined) return;
  const rawEntries = data.rawEntries ?? {};
  const novelId = strings(backup.novel, ['id'])[0];
  if (!novelId) fail();
  const scope: Scope = {
    novelId,
    chapters: ids(backup.tables.chapters),
    volumes: ids(backup.tables.volumes),
    jobs: ids(backup.tables.generation_jobs),
    profiles: new Set(),
    drafts: new Map(),
  };
  const entryChapters = new Set(scope.chapters);
  for (const snapshot of backup.tables.chapter_generation_snapshots ?? []) {
    strings(snapshot, [
      'style_profile_id',
      'output_profile_id',
      'styleProfileId',
      'outputProfileId',
    ]).forEach((id) => scope.profiles.add(id));
  }
  // Local-only jobs and planned identities remain portable, but their parent
  // must already be anchored to this novel before they can authorize any child.
  for (const [key, target] of [
    ['ai_novel_studio_volumes', scope.volumes],
    ['ai_novel_studio_chapters', scope.chapters],
    ['ai_novel_studio_generation_jobs', scope.jobs],
  ] as const) {
    for (const row of rows(data.collections[key] ?? [])) {
      checkRecord(row, scope, false, false, false);
      strings(row, ['id']).forEach((id) => target.add(id));
    }
  }
  for (const plan of rows(data.collections.ai_novel_studio_autonomous_story_plans ?? [])) {
    const owners = strings(plan, policy.ownerKeys);
    if (!owners.length || owners.some((id) => id !== novelId)) fail();
    ids(plan.chapters).forEach((id) => scope.chapters.add(id));
    ids(plan.volumes).forEach((id) => scope.volumes.add(id));
  }
  for (const draft of backup.tables.chapter_drafts ?? []) {
    const chapter = chapterOf(draft);
    if (!chapter) fail();
    registerDraft(draft, scope, chapter);
  }
  // Build the complete trusted draft set first: reports may precede the local-only
  // drafts they reference, and current/history entries may repeat the same identity.
  for (const [key, value] of Object.entries(data.entries)) {
    if (
      !key.startsWith('ai_novel_studio_draft_') &&
      !key.startsWith('ai_novel_studio_drafts_list_')
    )
      continue;
    const { id: chapter } = parseLocalBackupEntryKey(key, false);
    if (!entryChapters.has(chapter)) fail();
    for (const draft of rows(key.startsWith('ai_novel_studio_draft_') ? [value] : value)) {
      registerDraft(draft, scope, chapter);
    }
  }
  for (const [key, collection] of Object.entries(data.collections)) {
    for (const row of rows(collection)) {
      const novel = key === 'ai_novel_studio_novels';
      if (novel && row.id !== novelId) fail();
      const profile =
        key === 'ai_novel_studio_style_profiles' || key === 'ai_novel_studio_output_profiles';
      checkRecord(row, scope, novel, profile);
    }
  }
  for (const [raw, entries] of [
    [false, data.entries],
    [true, rawEntries],
  ] as const) {
    for (const [key, value] of Object.entries(entries)) {
      if (!raw && key === policy.referenceLibraryKey) {
        validateReferenceLibrary(value, scope);
        continue;
      }
      const parsed = parseLocalBackupEntryKey(key, raw);
      if (!(parsed.scope === 'chapter' ? entryChapters : scope.jobs).has(parsed.id)) fail();
      if (raw) {
        if (typeof value !== 'string') fail();
      } else {
        const entryRows = key.startsWith('ai_novel_studio_draft_') ? [value] : value;
        for (const row of rows(entryRows)) {
          const keys = parsed.scope === 'chapter' ? policy.chapterKeys : policy.jobKeys;
          if (strings(row, keys).some((id) => id !== parsed.id)) fail();
          checkRecord(row, scope, true);
        }
      }
    }
  }
}
