/**
 * AI Novel Studio - 输出控制方案服务
 */
import { lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { OutputProfile, CreateOutputProfileInput } from '../../types/output';

const OUTPUT_KEY = 'ai_novel_studio_output_profiles';

function getAll(): OutputProfile[] {
  return lsGet<OutputProfile[]>(OUTPUT_KEY) ?? [];
}

function saveAll(items: OutputProfile[]): void {
  lsSet(OUTPUT_KEY, items);
}

const defaultSeeds: CreateOutputProfileInput[] = [
  { name: '默认章节配置', targetWordCount: 4000, minWordCount: 3000, maxWordCount: 6000, paceLevel: 'medium', dialogueRatio: 0.35, descriptionRatio: 0.4, endingHookRequired: true, isDefault: true },
  { name: '战斗章节配置', targetWordCount: 4500, minWordCount: 3500, maxWordCount: 6000, paceLevel: 'fast', dialogueRatio: 0.25, descriptionRatio: 0.45, battleIntensity: 'high', endingHookRequired: true, extraRequirements: '战斗过程要有代价，不要无脑碾压。' },
  { name: '日常过渡配置', targetWordCount: 3000, minWordCount: 2000, maxWordCount: 4500, paceLevel: 'slow', dialogueRatio: 0.4, descriptionRatio: 0.35, battleIntensity: 'low', endingHookRequired: false },
];

export const outputProfileService = {
  async getAll(novelId?: string): Promise<OutputProfile[]> {
    let list = getAll();
    if (list.length === 0) {
      const now = nowISO();
      list = defaultSeeds.map((s) => ({
        ...s,
        id: generateId(),
        chapterWordRange: { min: s.minWordCount || 3000, max: s.maxWordCount || 6000, default: s.targetWordCount || 4000 },
        paragraphLength: 'medium' as const,
        povType: 'third_person_limited' as const,
        tenseType: 'past' as const,
        endingHookRequired: s.endingHookRequired || false,
        isDefault: s.isDefault || false,
        createdAt: now,
        updatedAt: now,
      }));
      saveAll(list);
    }
    if (novelId) return list.filter((o) => !o.novelId || o.novelId === novelId);
    return list;
  },

  async getById(id: string): Promise<OutputProfile | null> {
    return getAll().find((o) => o.id === id) ?? null;
  },

  async create(input: CreateOutputProfileInput): Promise<OutputProfile> {
    const list = getAll();
    const now = nowISO();
    const profile: OutputProfile = {
      ...input,
      id: generateId(),
      chapterWordRange: { min: input.minWordCount || 3000, max: input.maxWordCount || 6000, default: input.targetWordCount || 4000 },
      paragraphLength: 'medium',
      povType: 'third_person_limited',
      tenseType: 'past',
      endingHookRequired: input.endingHookRequired || false,
      isDefault: input.isDefault || false,
      createdAt: now,
      updatedAt: now,
    };
    list.push(profile);
    saveAll(list);
    return profile;
  },

  async update(id: string, input: Partial<CreateOutputProfileInput>): Promise<OutputProfile | null> {
    const list = getAll();
    const idx = list.findIndex((o) => o.id === id);
    if (idx === -1) return null;
    const updated = { ...list[idx], ...input, updatedAt: nowISO() };
    if (input.minWordCount || input.maxWordCount || input.targetWordCount) {
      updated.chapterWordRange = { min: input.minWordCount || list[idx].chapterWordRange.min, max: input.maxWordCount || list[idx].chapterWordRange.max, default: input.targetWordCount || list[idx].chapterWordRange.default };
    }
    list[idx] = updated;
    saveAll(list);
    return list[idx];
  },

  async remove(id: string): Promise<void> {
    saveAll(getAll().filter((o) => o.id !== id));
  },
};
