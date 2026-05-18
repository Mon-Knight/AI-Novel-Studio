/**
 * AI Novel Studio - 风格方案服务
 * Tauri 桌面端使用 SQLite，浏览器开发态使用 localStorage 回退。
 */
import { dbCall, lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { StyleProfile, CreateStyleProfileInput, UpdateStyleProfileInput } from '../../types/style';

const STYLE_KEY = 'ai_novel_studio_style_profiles';

interface StyleProfileDto {
  id: string; projectId: string; name: string; description?: string;
  narrativePerspective?: string; tone?: string; pace?: string; sentenceStyle?: string;
  dialogueRatio: number; descriptionRatio: number; psychologicalRatio?: number;
  battleStyle?: string; battleIntensity?: string; emotionTendency?: string;
  chapterEnding?: string; forbiddenStylesJson?: string;
  styleSummary?: string; rawConfigJson?: string;
  isActive: boolean; sourceType: string; createdAt: string; updatedAt: string;
}

function fromDto(dto: StyleProfileDto): StyleProfile {
  let forbidden: string[] = [];
  try { forbidden = JSON.parse(dto.forbiddenStylesJson || '[]'); } catch { /* ignore */ }
  return {
    id: dto.id, novelId: dto.projectId, name: dto.name,
    sourceType: dto.sourceType as StyleProfile['sourceType'],
    description: dto.description, narrativePerspective: dto.narrativePerspective,
    tone: dto.tone, pace: dto.pace, sentenceStyle: dto.sentenceStyle,
    dialogueRatio: dto.dialogueRatio, descriptionRatio: dto.descriptionRatio,
    psychologicalRatio: dto.psychologicalRatio, battleStyle: dto.battleStyle,
    battleIntensity: dto.battleIntensity, emotionTendency: dto.emotionTendency,
    chapterEnding: dto.chapterEnding,
    prohibitedStyles: forbidden, forbiddenStyles: forbidden,
    styleSummary: dto.styleSummary, rawConfigJson: dto.rawConfigJson,
    isActive: dto.isActive, targetWordsPerChapter: 4000,
    rhythmPreference: dto.pace === '快' ? 'fast' : dto.pace === '慢' ? 'slow' : 'moderate',
    createdAt: dto.createdAt, updatedAt: dto.updatedAt,
  };
}

const defaultSeed: CreateStyleProfileInput[] = [
  { name: '默认小说风格', sourceType: 'system_default', narrativePerspective: '第三人称有限视角', tone: '中性偏沉稳', pace: '中等', dialogueRatio: 0.35, descriptionRatio: 0.40, styleSummary: '适合大多数小说的通用风格配置。' },
  { name: '快节奏战斗风', sourceType: 'system_default', narrativePerspective: '第三人称', tone: '紧张、压迫', pace: '快', dialogueRatio: 0.25, descriptionRatio: 0.45, battleStyle: '重视动作连贯和代价', battleIntensity: 'high', emotionTendency: '紧张、压迫、爆发', styleSummary: '适合战斗密集的章节。' },
  { name: '抒情日常风', sourceType: 'system_default', narrativePerspective: '第三人称有限视角', tone: '温暖、细腻', pace: '慢', dialogueRatio: 0.40, descriptionRatio: 0.35, psychologicalRatio: 0.25, emotionTendency: '柔和、深情', styleSummary: '适合日常过渡和角色情感发展章节。' },
];

function getLocalAll(): StyleProfile[] {
  let list = lsGet<StyleProfile[]>(STYLE_KEY) ?? [];
  if (list.length === 0) {
    const now = nowISO();
    list = defaultSeed.map((s) => ({
      ...s, id: generateId(), sourceType: 'system_default' as StyleProfile['sourceType'],
      targetWordsPerChapter: 4000,
      rhythmPreference: s.pace === '快' ? 'fast' as const : s.pace === '慢' ? 'slow' as const : 'moderate' as const,
      dialogueRatio: s.dialogueRatio || 0.35, descriptionRatio: s.descriptionRatio || 0.4,
      prohibitedStyles: [], isActive: true, createdAt: now, updatedAt: now,
    }));
    lsSet(STYLE_KEY, list);
  }
  return list;
}

export const styleProfileService = {
  async getAll(novelId?: string): Promise<StyleProfile[]> {
    try {
      const dtos = await dbCall<StyleProfileDto[]>('list_style_profiles', { projectId: novelId }, () => {
        return getLocalAll().map((s): StyleProfileDto => ({
          id: s.id, projectId: s.novelId || '', name: s.name,
          description: s.description, narrativePerspective: s.narrativePerspective,
          tone: s.tone, pace: s.pace, sentenceStyle: s.sentenceStyle,
          dialogueRatio: s.dialogueRatio, descriptionRatio: s.descriptionRatio,
          psychologicalRatio: s.psychologicalRatio, battleStyle: s.battleStyle,
          battleIntensity: s.battleIntensity, emotionTendency: s.emotionTendency,
          chapterEnding: s.chapterEnding,
          forbiddenStylesJson: JSON.stringify(s.prohibitedStyles || []),
          styleSummary: s.styleSummary, rawConfigJson: s.rawConfigJson,
          isActive: s.isActive, sourceType: s.sourceType,
          createdAt: s.createdAt, updatedAt: s.updatedAt,
        }));
      });
      const profiles = dtos.map(fromDto);
      return novelId ? profiles.filter((s) => s.novelId === novelId) : profiles;
    } catch { return novelId ? getLocalAll().filter((s) => !s.novelId || s.novelId === novelId) : getLocalAll(); }
  },

  async getActive(novelId: string): Promise<StyleProfile | null> {
    try {
      const dto = await dbCall<StyleProfileDto | null>('get_active_style_profile', { projectId: novelId }, () => null);
      return dto ? fromDto(dto) : null;
    } catch {
      const local = getLocalAll().filter((s) => s.novelId === novelId);
      return local.find((s) => s.isActive) || local[0] || null;
    }
  },

  async getById(id: string): Promise<StyleProfile | null> {
    try { const all = await this.getAll(); return all.find((s) => s.id === id) ?? null; }
    catch { return getLocalAll().find((s) => s.id === id) ?? null; }
  },

  async create(input: CreateStyleProfileInput & { projectId?: string; novelId?: string }): Promise<StyleProfile> {
    const pid = input.projectId || input.novelId || '';
    try {
      const dto = await dbCall<StyleProfileDto>('save_style_profile', {
        id: undefined, input: { projectId: pid, name: input.name, narrativePerspective: input.narrativePerspective, tone: input.tone, pace: input.pace, sentenceStyle: input.sentenceStyle, dialogueRatio: input.dialogueRatio, descriptionRatio: input.descriptionRatio, psychologicalRatio: input.psychologicalRatio, battleStyle: input.battleStyle, battleIntensity: input.battleIntensity, emotionTendency: input.emotionTendency, chapterEnding: input.chapterEnding, forbiddenStyles: input.forbiddenStyles || [], styleSummary: input.styleSummary, sourceType: input.sourceType || 'manual' },
      }, () => { throw new Error('fallback'); });
      return fromDto(dto);
    } catch {
      const list = getLocalAll(); const now = nowISO();
      const profile: StyleProfile = { ...input, id: generateId(), novelId: pid, sourceType: input.sourceType || 'manual', targetWordsPerChapter: 4000,
        rhythmPreference: input.pace === '快' ? 'fast' : input.pace === '慢' ? 'slow' : 'moderate', dialogueRatio: input.dialogueRatio || 0.35, descriptionRatio: input.descriptionRatio || 0.4, prohibitedStyles: input.forbiddenStyles || [], isActive: true, createdAt: now, updatedAt: now };
      list.push(profile); lsSet(STYLE_KEY, list); return profile;
    }
  },

  async update(id: string, input: UpdateStyleProfileInput & { projectId?: string; novelId?: string }): Promise<StyleProfile | null> {
    const pid = input.projectId || input.novelId || '';
    try {
      const dto = await dbCall<StyleProfileDto>('save_style_profile', { id, input: { projectId: pid, name: input.name || '', narrativePerspective: input.narrativePerspective, tone: input.tone, pace: input.pace, sentenceStyle: input.sentenceStyle, dialogueRatio: input.dialogueRatio, descriptionRatio: input.descriptionRatio, psychologicalRatio: input.psychologicalRatio, battleStyle: input.battleStyle, battleIntensity: input.battleIntensity, emotionTendency: input.emotionTendency, chapterEnding: input.chapterEnding, forbiddenStyles: input.forbiddenStyles, styleSummary: input.styleSummary, sourceType: input.sourceType || undefined } }, () => { throw new Error('fallback'); });
      return fromDto(dto);
    } catch {
      const list = getLocalAll(); const idx = list.findIndex((s) => s.id === id);
      if (idx === -1) return null;
      list[idx] = { ...list[idx], ...input, updatedAt: nowISO() };
      if (input.forbiddenStyles) list[idx].prohibitedStyles = input.forbiddenStyles;
      lsSet(STYLE_KEY, list); return list[idx];
    }
  },

  async setActive(projectId: string, styleProfileId: string): Promise<void> {
    try { await dbCall<void>('set_active_style_profile', { input: { projectId, styleProfileId } }, () => {}); }
    catch {
      const list = getLocalAll();
      for (const s of list) { if (s.novelId === projectId) s.isActive = (s.id === styleProfileId); }
      lsSet(STYLE_KEY, list);
    }
  },

  async remove(projectIdOrId: string, id?: string): Promise<void> {
    const pid = id ? projectIdOrId : '';
    const sid = id || projectIdOrId;
    try { await dbCall<void>('delete_style_profile', { projectId: pid, styleProfileId: sid }, () => {}); }
    catch { lsSet(STYLE_KEY, getLocalAll().filter((s) => s.id !== sid)); }
  },
};
