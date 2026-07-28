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
import { dbCall, lsGet, lsSet, generateId, nowISO } from './db';
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

export interface NovelRepairResult {
  before: number;
  after: number;
  repairedCount: number;
  skippedCount: number;
  backupKey: string;
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
    const raw = lsGet<unknown>(NOVELS_KEY);
    const before = Array.isArray(raw) ? raw.length : 0;
    const backupKey = createBackupKey();
    if (raw != null) lsSet(backupKey, raw);

    const report = normalizeNovelsWithReport(raw);
    lsSet(NOVELS_KEY, report.items);
    setRepairSummary(report, before);

    return {
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
    const { lsGet, lsSet } = await import('./db');

    const purge = (key: string) => {
      try {
        const data = lsGet<unknown>(key);
        if (Array.isArray(data)) {
          const filtered = data.filter((item: unknown) => {
            if (!item || typeof item !== 'object') return true;
            return (item as Record<string, unknown>).novelId !== novelId;
          });
          if (filtered.length !== data.length) lsSet(key, filtered);
        }
      } catch {
        /* ignore */
      }
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

    await this.remove(novelId);

    const check = await this.getById(novelId);
    if (check) throw new Error('作品删除后仍可读取，请检查删除链路');
  },
};
