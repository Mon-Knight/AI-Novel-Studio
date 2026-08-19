/**
 * AI Novel Studio - 输出控制方案服务。
 * 桌面端以 SQLite 为事实源；浏览器开发模式继续使用 LocalStorage。
 */
import { dbCall, getDbMode, lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { OutputProfile, CreateOutputProfileInput } from '../../types/output';

const OUTPUT_KEY = 'ai_novel_studio_output_profiles';
const OUTPUT_SQLITE_MIGRATION_KEY = 'ai_novel_studio_output_profiles_sqlite_v1';

interface OutputProfileDto {
  id: string;
  novelId?: string | null;
  name: string;
  description?: string | null;
  targetWordCount?: number | null;
  minWordCount?: number | null;
  maxWordCount?: number | null;
  paragraphLength?: string | null;
  povType?: string | null;
  tenseType?: string | null;
  paceLevel?: string | null;
  dialogueRatio?: number | null;
  descriptionRatio?: number | null;
  battleIntensity?: string | null;
  emotionTendency?: string | null;
  endingHookRequired: boolean;
  extraRequirements?: string | null;
  forbiddenItems?: string[] | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

function localGetAll(): OutputProfile[] {
  return lsGet<OutputProfile[]>(OUTPUT_KEY) ?? [];
}

function localSaveAll(items: OutputProfile[]): void {
  lsSet(OUTPUT_KEY, items);
}

function fromDto(dto: OutputProfileDto): OutputProfile {
  return {
    id: dto.id,
    novelId: dto.novelId ?? undefined,
    name: dto.name,
    description: dto.description ?? undefined,
    chapterWordRange: {
      min: dto.minWordCount ?? 3000,
      max: dto.maxWordCount ?? 6000,
      default: dto.targetWordCount ?? 4000,
    },
    targetWordCount: dto.targetWordCount ?? undefined,
    minWordCount: dto.minWordCount ?? undefined,
    maxWordCount: dto.maxWordCount ?? undefined,
    paragraphLength: (dto.paragraphLength as OutputProfile['paragraphLength']) ?? 'medium',
    povType: (dto.povType as OutputProfile['povType']) ?? 'third_person_limited',
    tenseType: (dto.tenseType as OutputProfile['tenseType']) ?? 'past',
    paceLevel: (dto.paceLevel as OutputProfile['paceLevel']) ?? undefined,
    dialogueRatio: dto.dialogueRatio ?? undefined,
    descriptionRatio: dto.descriptionRatio ?? undefined,
    battleIntensity: (dto.battleIntensity as OutputProfile['battleIntensity']) ?? undefined,
    emotionTendency: dto.emotionTendency ?? undefined,
    endingHookRequired: dto.endingHookRequired,
    extraRequirements: dto.extraRequirements ?? undefined,
    forbiddenItems: dto.forbiddenItems ?? [],
    isDefault: dto.isDefault,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

type SaveProfile = Partial<OutputProfile> & { id?: string; name: string };

function toSaveInput(profile: SaveProfile): Record<string, unknown> {
  return {
    id: profile.id,
    novelId: profile.novelId,
    name: profile.name,
    description: profile.description,
    targetWordCount: profile.targetWordCount ?? profile.chapterWordRange?.default,
    minWordCount: profile.minWordCount ?? profile.chapterWordRange?.min,
    maxWordCount: profile.maxWordCount ?? profile.chapterWordRange?.max,
    paragraphLength: profile.paragraphLength ?? 'medium',
    povType: profile.povType ?? 'third_person_limited',
    tenseType: profile.tenseType ?? 'past',
    paceLevel: profile.paceLevel,
    dialogueRatio: profile.dialogueRatio,
    descriptionRatio: profile.descriptionRatio,
    battleIntensity: profile.battleIntensity,
    emotionTendency: profile.emotionTendency,
    endingHookRequired: profile.endingHookRequired ?? false,
    extraRequirements: profile.extraRequirements,
    forbiddenItems: profile.forbiddenItems ?? [],
    isDefault: profile.isDefault ?? false,
  };
}

const defaultSeeds: CreateOutputProfileInput[] = [
  {
    name: '默认章节配置',
    targetWordCount: 4000,
    minWordCount: 3000,
    maxWordCount: 6000,
    paceLevel: 'medium',
    dialogueRatio: 0.35,
    descriptionRatio: 0.4,
    endingHookRequired: true,
    isDefault: true,
  },
  {
    name: '战斗章节配置',
    targetWordCount: 4500,
    minWordCount: 3500,
    maxWordCount: 6000,
    paceLevel: 'fast',
    dialogueRatio: 0.25,
    descriptionRatio: 0.45,
    battleIntensity: 'high',
    endingHookRequired: true,
    extraRequirements: '战斗过程要有代价，不要无脑碾压。',
  },
  {
    name: '日常过渡配置',
    targetWordCount: 3000,
    minWordCount: 2000,
    maxWordCount: 4500,
    paceLevel: 'slow',
    dialogueRatio: 0.4,
    descriptionRatio: 0.35,
    battleIntensity: 'low',
    endingHookRequired: false,
  },
];

function createSeedProfiles(): OutputProfile[] {
  const now = nowISO();
  return defaultSeeds.map((seed) => ({
    ...seed,
    id: generateId(),
    chapterWordRange: {
      min: seed.minWordCount || 3000,
      max: seed.maxWordCount || 6000,
      default: seed.targetWordCount || 4000,
    },
    paragraphLength: 'medium',
    povType: 'third_person_limited',
    tenseType: 'past',
    endingHookRequired: seed.endingHookRequired || false,
    isDefault: seed.isDefault || false,
    createdAt: now,
    updatedAt: now,
  }));
}

function localEnsureSeeded(): OutputProfile[] {
  const current = localGetAll();
  if (current.length > 0) return current;
  const seeded = createSeedProfiles();
  localSaveAll(seeded);
  return seeded;
}

async function saveDesktop(profile: SaveProfile): Promise<OutputProfile> {
  const dto = await dbCall<OutputProfileDto>('save_output_profile', {
    input: toSaveInput(profile),
  });
  return fromDto(dto);
}

async function ensureDesktopInitialized(): Promise<void> {
  if (lsGet<boolean>(OUTPUT_SQLITE_MIGRATION_KEY)) return;
  const sqliteProfiles = (
    await dbCall<OutputProfileDto[]>('list_output_profiles', { projectId: null })
  ).map(fromDto);
  const localProfiles = localGetAll();
  const candidates =
    localProfiles.length > 0
      ? localProfiles
      : sqliteProfiles.length === 0
        ? createSeedProfiles()
        : [];
  const known = new Set(sqliteProfiles.map((profile) => profile.id));
  for (const profile of candidates) {
    if (!known.has(profile.id)) {
      await saveDesktop(profile);
    }
  }
  // The marker is written only after all idempotent SQLite upserts complete.
  lsSet(OUTPUT_SQLITE_MIGRATION_KEY, true);
}

export const outputProfileService = {
  async getAll(novelId?: string): Promise<OutputProfile[]> {
    if (getDbMode() === 'tauri') {
      await ensureDesktopInitialized();
      const dtos = await dbCall<OutputProfileDto[]>('list_output_profiles', {
        projectId: novelId ?? null,
      });
      return dtos.map(fromDto);
    }
    const list = localEnsureSeeded();
    if (novelId) return list.filter((o) => !o.novelId || o.novelId === novelId);
    return list;
  },

  async getById(id: string): Promise<OutputProfile | null> {
    return (await this.getAll()).find((o) => o.id === id) ?? null;
  },

  async create(input: CreateOutputProfileInput): Promise<OutputProfile> {
    if (getDbMode() === 'tauri') {
      await ensureDesktopInitialized();
      return saveDesktop({ ...input, name: input.name });
    }
    const list = localGetAll();
    const now = nowISO();
    const profile: OutputProfile = {
      ...input,
      id: generateId(),
      chapterWordRange: {
        min: input.minWordCount || 3000,
        max: input.maxWordCount || 6000,
        default: input.targetWordCount || 4000,
      },
      paragraphLength: 'medium',
      povType: 'third_person_limited',
      tenseType: 'past',
      endingHookRequired: input.endingHookRequired || false,
      isDefault: input.isDefault || false,
      createdAt: now,
      updatedAt: now,
    };
    list.push(profile);
    localSaveAll(list);
    return profile;
  },

  async update(
    id: string,
    input: Partial<CreateOutputProfileInput>,
  ): Promise<OutputProfile | null> {
    if (getDbMode() === 'tauri') {
      const existing = await this.getById(id);
      if (!existing) return null;
      return saveDesktop({ ...existing, ...input, id });
    }
    const list = localGetAll();
    const idx = list.findIndex((o) => o.id === id);
    if (idx === -1) return null;
    const updated = { ...list[idx], ...input, updatedAt: nowISO() };
    if (input.minWordCount || input.maxWordCount || input.targetWordCount) {
      updated.chapterWordRange = {
        min: input.minWordCount || list[idx].chapterWordRange.min,
        max: input.maxWordCount || list[idx].chapterWordRange.max,
        default: input.targetWordCount || list[idx].chapterWordRange.default,
      };
    }
    list[idx] = updated;
    localSaveAll(list);
    return list[idx];
  },

  async remove(id: string): Promise<void> {
    if (getDbMode() === 'tauri') {
      await dbCall<null>('delete_output_profile', { outputProfileId: id });
      return;
    }
    localSaveAll(localGetAll().filter((o) => o.id !== id));
  },

  async setDefault(novelId: string, id: string): Promise<void> {
    if (getDbMode() === 'tauri') {
      await dbCall<null>('set_default_output_profile', {
        input: { novelId, outputProfileId: id },
      });
      return;
    }
    localSaveAll(
      localGetAll().map((profile) => ({
        ...profile,
        isDefault: profile.novelId === novelId ? profile.id === id : profile.isDefault,
      })),
    );
  },
};
