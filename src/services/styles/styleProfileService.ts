/**
 * AI Novel Studio - 风格方案服务
 */
import { lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { StyleProfile, CreateStyleProfileInput, UpdateStyleProfileInput, StyleSourceType } from '../../types/style';

const STYLE_KEY = 'ai_novel_studio_style_profiles';

function getAll(): StyleProfile[] {
  return lsGet<StyleProfile[]>(STYLE_KEY) ?? [];
}

function saveAll(items: StyleProfile[]): void {
  lsSet(STYLE_KEY, items);
}

// 默认种子方案
const defaultSeed: CreateStyleProfileInput[] = [
  { name: '默认小说风格', sourceType: 'system_default', narrativePerspective: '第三人称有限视角', tone: '中性偏沉稳', pace: '中等', dialogueRatio: 0.35, descriptionRatio: 0.40, styleSummary: '适合大多数小说的通用风格配置。' },
  { name: '快节奏战斗风', sourceType: 'system_default', narrativePerspective: '第三人称', tone: '紧张、压迫', pace: '快', dialogueRatio: 0.25, descriptionRatio: 0.45, battleStyle: '重视动作连贯和代价', battleIntensity: 'high', emotionTendency: '紧张、压迫、爆发', styleSummary: '适合战斗密集的章节。' },
  { name: '抒情日常风', sourceType: 'system_default', narrativePerspective: '第三人称有限视角', tone: '温暖、细腻', pace: '慢', dialogueRatio: 0.40, descriptionRatio: 0.35, psychologicalRatio: 0.25, emotionTendency: '柔和、深情', styleSummary: '适合日常过渡和角色情感发展章节。' },
];

export const styleProfileService = {
  async getAll(novelId?: string): Promise<StyleProfile[]> {
    let list = getAll();
    // 首次初始化种子数据
    if (list.length === 0) {
      const now = nowISO();
      list = defaultSeed.map((s, i) => ({
        ...s,
        id: generateId(),
        sourceType: 'system_default' as StyleSourceType,
        targetWordsPerChapter: 4000,
        rhythmPreference: s.pace === '快' ? 'fast' as const : s.pace === '慢' ? 'slow' as const : 'moderate' as const,
        dialogueRatio: s.dialogueRatio || 0.35,
        descriptionRatio: s.descriptionRatio || 0.4,
        prohibitedStyles: [],
        isActive: true,
        createdAt: now,
        updatedAt: now,
      }));
      saveAll(list);
    }
    if (novelId) return list.filter((s) => !s.novelId || s.novelId === novelId);
    return list;
  },

  async getById(id: string): Promise<StyleProfile | null> {
    return getAll().find((s) => s.id === id) ?? null;
  },

  async create(input: CreateStyleProfileInput): Promise<StyleProfile> {
    const list = getAll();
    const now = nowISO();
    const profile: StyleProfile = {
      ...input,
      id: generateId(),
      sourceType: input.sourceType || 'manual',
      targetWordsPerChapter: 4000,
      rhythmPreference: input.pace === '快' ? 'fast' : input.pace === '慢' ? 'slow' : 'moderate',
      dialogueRatio: input.dialogueRatio || 0.35,
      descriptionRatio: input.descriptionRatio || 0.4,
      prohibitedStyles: input.forbiddenStyles || [],
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    list.push(profile);
    saveAll(list);
    return profile;
  },

  async update(id: string, input: UpdateStyleProfileInput): Promise<StyleProfile | null> {
    const list = getAll();
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    list[idx] = { ...list[idx], ...input, updatedAt: nowISO() };
    if (input.forbiddenStyles) list[idx].prohibitedStyles = input.forbiddenStyles;
    saveAll(list);
    return list[idx];
  },

  async remove(id: string): Promise<void> {
    saveAll(getAll().filter((s) => s.id !== id));
  },
};
