/**
 * AI Novel Studio - Novel repository.
 */
import type {
  CreateNovelInput,
  DualProtagonistRelation,
  Novel,
  ProtagonistMode,
  ProtagonistProfile,
  UpdateNovelInput,
} from '../../types/novel';
import { dbCall, getDbMode, lsGet, lsRemove, lsSet, generateId, nowISO } from './db';
import { mockNovels } from '../../features/novels/mockNovels';
import {
  getDefaultDualProtagonistRelation,
  normalizeDualProtagonistRelation,
  normalizeNovel,
  normalizeNovelsWithReport,
  type NovelNormalizeReport,
} from '../../features/novels/novelNormalizer';
import { toIsoDateOrNow } from '../../utils/date';

const NOVELS_KEY = 'ai_novel_studio_novels';
const REFERENCE_LIBRARY_KEY = 'ai_novel_studio_reference_library_v1';
const RECOVERY_KEY_PREFIX = 'ai_novel_studio_workspace_recovery_';
const CHAPTER_SCOPED_KEY_PREFIXES = [
  'ai_novel_studio_drafts_list_',
  'ai_novel_studio_draft_',
  'ai_novel_studio_chapter_engineering_states_',
  'ai_novel_studio_chapter_generation_snapshots_',
  'ai_novel_studio_unsaved_chapter_outline_',
] as const;
const JOB_SCOPED_KEY_PREFIX = 'ai_novel_studio_generation_steps_';

type StorageRecord = Record<string, unknown>;

function isStorageRecord(value: unknown): value is StorageRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringField(value: StorageRecord, ...keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof value[key] === 'string' && value[key]) return value[key] as string;
  }
  return undefined;
}

function rowBelongsToNovel(
  value: unknown,
  novelId: string,
  chapterIds: ReadonlySet<string>,
  volumeIds: ReadonlySet<string>,
  jobIds: ReadonlySet<string>,
): boolean {
  if (!isStorageRecord(value)) return false;
  const owner = stringField(value, 'novelId', 'novel_id', 'projectId', 'project_id');
  if (owner === novelId) return true;
  const chapterId = stringField(value, 'chapterId', 'chapter_id', 'currentChapterId');
  if (chapterId && chapterIds.has(chapterId)) return true;
  const volumeId = stringField(value, 'volumeId', 'volume_id', 'currentVolumeId');
  if (volumeId && volumeIds.has(volumeId)) return true;
  const jobId = stringField(value, 'jobId', 'job_id');
  return Boolean(jobId && jobIds.has(jobId));
}

function scopedIds(key: string, novelId: string): Set<string> {
  const rows = lsGet<unknown>(key);
  if (!Array.isArray(rows)) return new Set();
  return new Set(
    rows.flatMap((row) => {
      if (
        !isStorageRecord(row) ||
        !rowBelongsToNovel(row, novelId, new Set(), new Set(), new Set())
      ) {
        return [];
      }
      const id = stringField(row, 'id', 'jobId', 'job_id');
      return id ? [id] : [];
    }),
  );
}

export interface NovelRepairResult {
  before: number;
  after: number;
  repairedCount: number;
  skippedCount: number;
  backupKey: string;
  storage?: 'sqlite' | 'localstorage';
  integrityOk?: boolean;
  integrityMessage?: string;
  foreignKeyViolations?: number;
}

export interface NovelRepairSummary {
  repairedCount: number;
  skippedCount: number;
  totalCount: number;
}

export interface UpdateNovelProtagonistsInput {
  protagonistMode: ProtagonistMode;
  protagonists: ProtagonistProfile[];
  dualProtagonistRelation?: DualProtagonistRelation | null;
}

let lastRepairSummary: NovelRepairSummary | null = null;

function buildSeedNovels(): Novel[] {
  return mockNovels
    .map((n) =>
      normalizeNovel({
        ...n,
        totalWordCount: n.totalWords ?? n.totalWordCount,
        targetWordCount: n.targetWords ?? n.targetWordCount,
      }),
    )
    .filter((n): n is Novel => n !== null);
}

function setRepairSummary(report: NovelNormalizeReport, totalCount: number) {
  if (report.repairedCount > 0 || report.skippedCount > 0) {
    lastRepairSummary = {
      repairedCount: report.repairedCount,
      skippedCount: report.skippedCount,
      totalCount,
    };
  } else {
    lastRepairSummary = null;
  }
}

function normalizeNovelOrThrow(raw: unknown, message: string): Novel {
  const normalized = normalizeNovel(raw);
  if (!normalized) throw new Error(message);
  return normalized;
}

function getLocalNovels(): Novel[] {
  const stored = lsGet<unknown>(NOVELS_KEY);
  const totalCount = Array.isArray(stored) ? stored.length : 0;
  const report = normalizeNovelsWithReport(stored);
  setRepairSummary(report, totalCount);

  if (report.items.length > 0) {
    if (report.repairedCount > 0 || report.skippedCount > 0 || !Array.isArray(stored)) {
      lsSet(NOVELS_KEY, report.items);
    }
    return report.items;
  }

  const seed = buildSeedNovels();
  lsSet(NOVELS_KEY, seed);
  return seed;
}

function saveLocalNovels(novels: Novel[]): void {
  lsSet(NOVELS_KEY, novels);
}

function createBackupKey(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${NOVELS_KEY}_backup_${stamp}`;
}

function normalizePatch(existing: Novel, input: UpdateNovelInput): Novel {
  const mergedRelation =
    input.dualProtagonistRelation === null
      ? getDefaultDualProtagonistRelation()
      : normalizeDualProtagonistRelation(
          input.dualProtagonistRelation ?? existing.dualProtagonistRelation,
        );
  const merged = normalizeNovel({
    ...existing,
    ...input,
    dualProtagonistRelation: mergedRelation,
    totalWordCount: input.totalWordCount ?? existing.totalWordCount,
    totalWords: input.totalWordCount ?? existing.totalWords,
    targetWordCount: input.targetWordCount ?? existing.targetWordCount,
    targetWords: input.targetWordCount ?? existing.targetWords,
    mainCharacter: input.mainCharacter ?? input.protagonists?.[0]?.name ?? existing.mainCharacter,
    protagonistAbility:
      input.protagonistAbility ??
      input.protagonists?.[0]?.ability ??
      input.protagonists?.[0]?.specialAbility ??
      existing.protagonistAbility,
    updatedAt: toIsoDateOrNow(new Date()),
  });
  if (!merged) throw new Error('作品更新数据无效，无法保存');
  return merged;
}

export const novelRepository = {
  async getAll(): Promise<Novel[]> {
    const raw = await dbCall<unknown[]>('get_all_novels', undefined, () => getLocalNovels());
    return normalizeNovelsWithReport(raw).items;
  },

  async getById(id: string): Promise<Novel | null> {
    const raw = await dbCall<unknown | null>('get_novel_by_id', { id }, () => {
      const novels = getLocalNovels();
      return novels.find((n) => n.id === id) ?? null;
    });
    return normalizeNovel(raw);
  },

  getLastRepairSummary(): NovelRepairSummary | null {
    return lastRepairSummary;
  },

  async repairData(): Promise<NovelRepairResult> {
    if (getDbMode() === 'tauri') {
      return dbCall<NovelRepairResult>('repair_database');
    }

    const raw = lsGet<unknown>(NOVELS_KEY);
    const before = Array.isArray(raw) ? raw.length : 0;
    const backupKey = createBackupKey();
    if (raw != null) lsSet(backupKey, raw);

    const report = normalizeNovelsWithReport(raw);
    lsSet(NOVELS_KEY, report.items);
    setRepairSummary(report, before);

    return {
      storage: 'localstorage',
      before,
      after: report.items.length,
      repairedCount: report.repairedCount,
      skippedCount: report.skippedCount,
      backupKey,
    };
  },

  async create(input: CreateNovelInput): Promise<Novel> {
    const raw = await dbCall<unknown>('create_novel', { input }, () => {
      const novels = getLocalNovels();
      const now = nowISO();
      const novel = normalizeNovel({
        id: generateId(),
        title: input.title,
        subtitle: input.subtitle,
        description: input.description ?? '',
        outline: input.outline ?? '',
        genre: input.genre ?? '',
        protagonistMode: 'single',
        protagonists: [],
        dualProtagonistRelation: getDefaultDualProtagonistRelation(),
        mainCharacter: '',
        protagonistAbility: '',
        coverPath: undefined,
        coverUrl: undefined,
        status: 'draft',
        totalWordCount: 0,
        totalWords: 0,
        targetWordCount: input.targetWordCount ?? 0,
        targetWords: input.targetWordCount ?? 0,
        lastOpenedAt: now,
        createdAt: now,
        updatedAt: now,
        volumes: [],
      });
      if (!novel) throw new Error('作品创建数据无效');
      novels.unshift(novel);
      saveLocalNovels(novels);
      return novel;
    });

    return normalizeNovelOrThrow(raw, '作品创建返回无效数据');
  },

  async update(id: string, input: UpdateNovelInput): Promise<Novel | null> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('作品不存在，无法保存');

    const merged = normalizePatch(existing, input);
    const raw = await dbCall<unknown>('update_novel', { id, input: merged }, () => {
      const novels = getLocalNovels();
      const idx = novels.findIndex((n) => n.id === id);
      if (idx === -1) throw new Error('作品不存在，无法保存');
      novels[idx] = merged;
      saveLocalNovels(novels);
      return merged;
    });

    const saved = normalizeNovelOrThrow(raw, '作品保存返回无效数据');
    const reread = await this.getById(id);
    if (!reread) throw new Error('作品保存后无法读取');
    if (saved.protagonistMode !== reread.protagonistMode) {
      throw new Error('主角模式保存后反查不一致');
    }
    return reread;
  },

  async updateProtagonists(novelId: string, input: UpdateNovelProtagonistsInput): Promise<Novel> {
    const relation = input.dualProtagonistRelation ?? getDefaultDualProtagonistRelation();
    const updated = await this.update(novelId, {
      protagonistMode: input.protagonistMode,
      protagonists: input.protagonists,
      dualProtagonistRelation: relation,
    });
    if (!updated) throw new Error('主角设定保存后无法读取作品');
    return updated;
  },

  async remove(id: string): Promise<void> {
    return dbCall<void>('delete_novel', { id }, () => {
      const novels = getLocalNovels().filter((n) => n.id !== id);
      saveLocalNovels(novels);
    });
  },

  async deleteCascade(novelId: string): Promise<void> {
    if (getDbMode() === 'tauri') {
      await dbCall<void>('delete_novel_cascade', { id: novelId });
      const remaining = await this.getById(novelId);
      if (remaining) throw new Error('作品删除后仍可读取，请检查 SQLite 级联删除链路');
      return;
    }

    const chapterIds = scopedIds('ai_novel_studio_chapters', novelId);
    const volumeIds = scopedIds('ai_novel_studio_volumes', novelId);
    const jobIds = scopedIds('ai_novel_studio_generation_jobs', novelId);

    const purge = (key: string) => {
      const data = lsGet<unknown>(key);
      if (!Array.isArray(data)) return;
      const filtered = data.filter(
        (item: unknown) => !rowBelongsToNovel(item, novelId, chapterIds, volumeIds, jobIds),
      );
      if (filtered.length !== data.length) lsSet(key, filtered);
    };

    const keys = [
      'ai_novel_studio_volumes',
      'ai_novel_studio_chapters',
      'ai_novel_studio_chapter_drafts',
      'ai_novel_studio_characters',
      'ai_novel_studio_chapter_characters',
      'ai_novel_studio_chapter_events',
      'ai_novel_studio_world_settings',
      'ai_novel_studio_rule_systems',
      'ai_novel_studio_chapter_summaries',
      'ai_novel_studio_context_records',
      'ai_novel_studio_character_states',
      'ai_novel_studio_ai_task_records',
      'ai_novel_studio_ai_tasks',
      'ai_novel_studio_style_profiles',
      'ai_novel_studio_output_profiles',
      'ai_novel_studio_polish_records',
      'ai_novel_studio_quality_check_reports',
      'ai_novel_studio_quality_check_items',
      'ai_novel_studio_protagonists',
      'ai_novel_studio_imported_assets',
      'ai_novel_studio_autonomous_story_plans',
    ];
    for (const key of keys) purge(key);

    // Reference data is stored as one object rather than a row collection.
    // Remove the complete work/import/section lineage for this novel while
    // preserving references belonging to every other novel.
    const referenceState = lsGet<unknown>(REFERENCE_LIBRARY_KEY);
    if (isStorageRecord(referenceState)) {
      const works = Array.isArray(referenceState.works) ? referenceState.works : [];
      const imports = Array.isArray(referenceState.imports) ? referenceState.imports : [];
      const sections = Array.isArray(referenceState.sections) ? referenceState.sections : [];
      const workIds = new Set(
        works
          .filter((work) => rowBelongsToNovel(work, novelId, chapterIds, volumeIds, jobIds))
          .flatMap((work) => {
            const id = isStorageRecord(work) ? stringField(work, 'id') : undefined;
            return id ? [id] : [];
          }),
      );
      const importIds = new Set(
        imports
          .filter((item) => {
            if (rowBelongsToNovel(item, novelId, chapterIds, volumeIds, jobIds)) return true;
            if (!isStorageRecord(item)) return false;
            return workIds.has(stringField(item, 'workId', 'reference_work_id') ?? '');
          })
          .flatMap((item) => {
            const id = isStorageRecord(item) ? stringField(item, 'id') : undefined;
            return id ? [id] : [];
          }),
      );
      const nextWorks = works.filter(
        (work) => !workIds.has(stringField((work ?? {}) as StorageRecord, 'id') ?? ''),
      );
      const nextImports = imports.filter(
        (item) =>
          !importIds.has(stringField((item ?? {}) as StorageRecord, 'id') ?? '') &&
          !workIds.has(
            stringField((item ?? {}) as StorageRecord, 'workId', 'reference_work_id') ?? '',
          ),
      );
      const nextSections = sections.filter((section) => {
        if (rowBelongsToNovel(section, novelId, chapterIds, volumeIds, jobIds)) return false;
        if (!isStorageRecord(section)) return true;
        return !importIds.has(stringField(section, 'importId', 'reference_import_id') ?? '');
      });
      const operations = isStorageRecord(referenceState.operations)
        ? Object.fromEntries(
            Object.entries(referenceState.operations).filter(([, operation]) => {
              if (!isStorageRecord(operation)) return true;
              if (rowBelongsToNovel(operation, novelId, chapterIds, volumeIds, jobIds))
                return false;
              return !workIds.has(stringField(operation, 'workId', 'reference_work_id') ?? '');
            }),
          )
        : {};
      if (
        nextWorks.length !== works.length ||
        nextImports.length !== imports.length ||
        nextSections.length !== sections.length ||
        Object.keys(operations).length !==
          (isStorageRecord(referenceState.operations)
            ? Object.keys(referenceState.operations).length
            : 0)
      ) {
        lsSet(REFERENCE_LIBRARY_KEY, {
          ...referenceState,
          works: nextWorks,
          imports: nextImports,
          sections: nextSections,
          operations,
        });
      }
    }

    // Chapter/job caches use dynamic keys and therefore are not covered by
    // the collection purge above. Capture IDs before deleting their rows.
    for (const chapterId of chapterIds) {
      for (const prefix of CHAPTER_SCOPED_KEY_PREFIXES) lsRemove(`${prefix}${chapterId}`);
    }
    for (const jobId of jobIds) lsRemove(`${JOB_SCOPED_KEY_PREFIX}${jobId}`);
    const encodedNovelId = encodeURIComponent(novelId);
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(RECOVERY_KEY_PREFIX)) continue;
      if (key.startsWith(`${RECOVERY_KEY_PREFIX}${encodedNovelId}_`)) {
        lsRemove(key);
        continue;
      }
      const snapshot = lsGet<unknown>(key);
      if (isStorageRecord(snapshot) && stringField(snapshot, 'novelId', 'novel_id') === novelId) {
        lsRemove(key);
      }
    }
    try {
      const taskState = lsGet<{
        bundles?: Array<{ conversation?: { novelId?: string } }>;
      }>('ai_novel_studio_task_conversations');
      if (taskState?.bundles) {
        const bundles = taskState.bundles.filter(
          (bundle) => bundle.conversation?.novelId !== novelId,
        );
        if (bundles.length !== taskState.bundles.length) {
          lsSet('ai_novel_studio_task_conversations', { bundles });
        }
      }
    } catch {
      /* ignore malformed browser task state; the next read normalizes it */
    }

    await this.remove(novelId);

    const check = await this.getById(novelId);
    if (check) throw new Error('作品删除后仍可读取，请检查删除链路');
  },
};
