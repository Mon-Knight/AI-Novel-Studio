/**
 * AI Novel Studio - 风格方案服务
 * Tauri 桌面端使用 SQLite，浏览器开发态使用 localStorage 回退。
 */
import { dbCall, getDbMode, lsGet, lsSet, generateId, nowISO } from '../database/db';
import type {
  StyleProfile,
  CreateStyleProfileInput,
  UpdateStyleProfileInput,
} from '../../types/style';

const STYLE_KEY = 'ai_novel_studio_style_profiles';

interface StyleProfileDto {
  id: string;
  projectId?: string | null;
  name: string;
  description?: string;
  narrativePerspective?: string;
  tone?: string;
  pace?: string;
  sentenceStyle?: string;
  dialogueRatio: number;
  descriptionRatio: number;
  psychologicalRatio?: number;
  battleStyle?: string;
  battleIntensity?: string;
  emotionTendency?: string;
  chapterEnding?: string;
  forbiddenStylesJson?: string;
  styleSummary?: string;
  rawConfigJson?: string;
  isActive: boolean;
  sourceType: string;
  sourceAssetId?: string;
  sourceReferenceWorkId?: string;
  sourceReferenceImportId?: string;
  sourceContentHash?: string;
  sourceState?: StyleProfile['sourceState'];
  analysisMetadataJson?: string;
  createdAt: string;
  updatedAt: string;
}

function fromDto(dto: StyleProfileDto): StyleProfile {
  let forbidden: string[] = [];
  try {
    forbidden = JSON.parse(dto.forbiddenStylesJson || '[]');
  } catch {
    /* ignore */
  }
  return {
    id: dto.id,
    novelId: dto.projectId?.trim() || undefined,
    name: dto.name,
    sourceType: dto.sourceType as StyleProfile['sourceType'],
    sourceAssetId: dto.sourceAssetId,
    sourceReferenceWorkId: dto.sourceReferenceWorkId,
    sourceReferenceImportId: dto.sourceReferenceImportId,
    sourceContentHash: dto.sourceContentHash,
    sourceState: dto.sourceState,
    analysisMetadataJson: dto.analysisMetadataJson,
    description: dto.description,
    narrativePerspective: dto.narrativePerspective,
    tone: dto.tone,
    pace: dto.pace,
    sentenceStyle: dto.sentenceStyle,
    dialogueRatio: dto.dialogueRatio,
    descriptionRatio: dto.descriptionRatio,
    psychologicalRatio: dto.psychologicalRatio,
    battleStyle: dto.battleStyle,
    battleIntensity: dto.battleIntensity,
    emotionTendency: dto.emotionTendency,
    chapterEnding: dto.chapterEnding,
    prohibitedStyles: forbidden,
    forbiddenStyles: forbidden,
    styleSummary: dto.styleSummary,
    rawConfigJson: dto.rawConfigJson,
    isActive: dto.isActive,
    targetWordsPerChapter: 4000,
    rhythmPreference: dto.pace === '快' ? 'fast' : dto.pace === '慢' ? 'slow' : 'moderate',
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  };
}

const defaultSeed: CreateStyleProfileInput[] = [
  {
    name: '默认小说风格',
    sourceType: 'system_default',
    narrativePerspective: '第三人称有限视角',
    tone: '中性偏沉稳',
    pace: '中等',
    dialogueRatio: 0.35,
    descriptionRatio: 0.4,
    styleSummary: '适合大多数小说的通用风格配置。',
  },
  {
    name: '快节奏战斗风',
    sourceType: 'system_default',
    narrativePerspective: '第三人称',
    tone: '紧张、压迫',
    pace: '快',
    dialogueRatio: 0.25,
    descriptionRatio: 0.45,
    battleStyle: '重视动作连贯和代价',
    battleIntensity: 'high',
    emotionTendency: '紧张、压迫、爆发',
    styleSummary: '适合战斗密集的章节。',
  },
  {
    name: '抒情日常风',
    sourceType: 'system_default',
    narrativePerspective: '第三人称有限视角',
    tone: '温暖、细腻',
    pace: '慢',
    dialogueRatio: 0.4,
    descriptionRatio: 0.35,
    psychologicalRatio: 0.25,
    emotionTendency: '柔和、深情',
    styleSummary: '适合日常过渡和角色情感发展章节。',
  },
];

function getLocalStoredAll(): StyleProfile[] {
  return lsGet<StyleProfile[]>(STYLE_KEY) ?? [];
}

function getLocalAll(): StyleProfile[] {
  let list = getLocalStoredAll();
  if (list.length === 0) {
    const now = nowISO();
    list = defaultSeed.map((s, index) => ({
      ...s,
      id: generateId(),
      sourceType: 'system_default' as StyleProfile['sourceType'],
      targetWordsPerChapter: 4000,
      rhythmPreference:
        s.pace === '快'
          ? ('fast' as const)
          : s.pace === '慢'
            ? ('slow' as const)
            : ('moderate' as const),
      dialogueRatio: s.dialogueRatio || 0.35,
      descriptionRatio: s.descriptionRatio || 0.4,
      prohibitedStyles: [],
      isActive: index === 0,
      createdAt: now,
      updatedAt: now,
    }));
    lsSet(STYLE_KEY, list);
  }
  return list;
}

export const styleProfileService = {
  async getAll(novelId?: string, options: { initialize?: boolean } = {}): Promise<StyleProfile[]> {
    const initialize = options.initialize !== false;
    const readLocal = initialize ? getLocalAll : getLocalStoredAll;
    try {
      const dtos = await dbCall<StyleProfileDto[]>(
        'list_style_profiles',
        { projectId: novelId },
        () => {
          return readLocal().map((s): StyleProfileDto => ({
            id: s.id,
            projectId: s.novelId || '',
            name: s.name,
            description: s.description,
            narrativePerspective: s.narrativePerspective,
            tone: s.tone,
            pace: s.pace,
            sentenceStyle: s.sentenceStyle,
            dialogueRatio: s.dialogueRatio,
            descriptionRatio: s.descriptionRatio,
            psychologicalRatio: s.psychologicalRatio,
            battleStyle: s.battleStyle,
            battleIntensity: s.battleIntensity,
            emotionTendency: s.emotionTendency,
            chapterEnding: s.chapterEnding,
            forbiddenStylesJson: JSON.stringify(s.prohibitedStyles || []),
            styleSummary: s.styleSummary,
            rawConfigJson: s.rawConfigJson,
            isActive: s.isActive,
            sourceType: s.sourceType,
            sourceAssetId: s.sourceAssetId,
            sourceReferenceWorkId: s.sourceReferenceWorkId,
            sourceReferenceImportId: s.sourceReferenceImportId,
            sourceContentHash: s.sourceContentHash,
            sourceState: s.sourceState,
            analysisMetadataJson: s.analysisMetadataJson,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          }));
        },
      );
      const profiles = dtos.map(fromDto);
      if (profiles.length > 0)
        return novelId ? profiles.filter((s) => !s.novelId || s.novelId === novelId) : profiles;
      if (getDbMode() === 'tauri') return [];
      return novelId
        ? readLocal().filter((profile) => !profile.novelId || profile.novelId === novelId)
        : readLocal();
    } catch (error) {
      if (getDbMode() === 'tauri') throw error;
      return novelId ? readLocal().filter((s) => !s.novelId || s.novelId === novelId) : readLocal();
    }
  },

  async getActive(novelId: string): Promise<StyleProfile | null> {
    try {
      const dto = await dbCall<StyleProfileDto | null>(
        'get_active_style_profile',
        { projectId: novelId },
        () => null,
      );
      return dto ? fromDto(dto) : null;
    } catch (error) {
      if (getDbMode() === 'tauri') throw error;
      const local = getLocalAll();
      return (
        local.find((profile) => profile.novelId === novelId && profile.isActive) ??
        local.find((profile) => !profile.novelId && profile.isActive) ??
        local.find((profile) => profile.novelId === novelId) ??
        local.find((profile) => !profile.novelId) ??
        null
      );
    }
  },

  async getById(id: string): Promise<StyleProfile | null> {
    try {
      const all = await this.getAll();
      return all.find((s) => s.id === id) ?? null;
    } catch (error) {
      if (getDbMode() === 'tauri') throw error;
      return getLocalAll().find((s) => s.id === id) ?? null;
    }
  },

  async create(
    input: CreateStyleProfileInput & { projectId?: string; novelId?: string },
  ): Promise<StyleProfile> {
    const pid = input.projectId || input.novelId || '';
    try {
      const dto = await dbCall<StyleProfileDto>(
        'save_style_profile',
        {
          id: undefined,
          input: {
            projectId: pid,
            name: input.name,
            narrativePerspective: input.narrativePerspective,
            tone: input.tone,
            pace: input.pace,
            sentenceStyle: input.sentenceStyle,
            dialogueRatio: input.dialogueRatio,
            descriptionRatio: input.descriptionRatio,
            psychologicalRatio: input.psychologicalRatio,
            battleStyle: input.battleStyle,
            battleIntensity: input.battleIntensity,
            emotionTendency: input.emotionTendency,
            chapterEnding: input.chapterEnding,
            forbiddenStyles: input.forbiddenStyles || [],
            styleSummary: input.styleSummary,
            sourceType: input.sourceType || 'manual',
            sourceAssetId: input.sourceAssetId,
            sourceReferenceWorkId: input.sourceReferenceWorkId,
            sourceReferenceImportId: input.sourceReferenceImportId,
            sourceContentHash: input.sourceContentHash,
            sourceState: input.sourceState,
            analysisMetadataJson: input.analysisMetadataJson,
          },
        },
        () => {
          throw new Error('fallback');
        },
      );
      return fromDto(dto);
    } catch (error) {
      if (getDbMode() === 'tauri') throw error;
      const list = getLocalAll();
      const now = nowISO();
      const profile: StyleProfile = {
        ...input,
        id: generateId(),
        novelId: pid,
        sourceType: input.sourceType || 'manual',
        targetWordsPerChapter: 4000,
        rhythmPreference: input.pace === '快' ? 'fast' : input.pace === '慢' ? 'slow' : 'moderate',
        dialogueRatio: input.dialogueRatio || 0.35,
        descriptionRatio: input.descriptionRatio || 0.4,
        prohibitedStyles: input.forbiddenStyles || [],
        isActive: false,
        createdAt: now,
        updatedAt: now,
      };
      list.push(profile);
      lsSet(STYLE_KEY, list);
      return profile;
    }
  },

  async update(
    id: string,
    input: UpdateStyleProfileInput & { projectId?: string; novelId?: string },
  ): Promise<StyleProfile | null> {
    const existing = await this.getById(id);
    if (!existing) return null;
    const requestedOwner = input.projectId ?? input.novelId;
    const pid = requestedOwner?.trim() ?? existing.novelId ?? '';
    try {
      const dto = await dbCall<StyleProfileDto>(
        'save_style_profile',
        {
          id,
          input: {
            projectId: pid,
            name: input.name ?? existing.name,
            description: existing.description,
            narrativePerspective: input.narrativePerspective ?? existing.narrativePerspective,
            tone: input.tone ?? existing.tone,
            pace: input.pace ?? existing.pace,
            sentenceStyle: input.sentenceStyle ?? existing.sentenceStyle,
            dialogueRatio: input.dialogueRatio ?? existing.dialogueRatio,
            descriptionRatio: input.descriptionRatio ?? existing.descriptionRatio,
            psychologicalRatio: input.psychologicalRatio ?? existing.psychologicalRatio,
            battleStyle: input.battleStyle ?? existing.battleStyle,
            battleIntensity: input.battleIntensity ?? existing.battleIntensity,
            emotionTendency: input.emotionTendency ?? existing.emotionTendency,
            chapterEnding: input.chapterEnding ?? existing.chapterEnding,
            forbiddenStyles:
              input.forbiddenStyles ?? existing.forbiddenStyles ?? existing.prohibitedStyles,
            styleSummary: input.styleSummary ?? existing.styleSummary,
            rawConfigJson: existing.rawConfigJson,
            sourceType: input.sourceType ?? existing.sourceType,
            sourceAssetId: input.sourceAssetId ?? existing.sourceAssetId,
            sourceReferenceWorkId: input.sourceReferenceWorkId ?? existing.sourceReferenceWorkId,
            sourceReferenceImportId:
              input.sourceReferenceImportId ?? existing.sourceReferenceImportId,
            sourceContentHash: input.sourceContentHash ?? existing.sourceContentHash,
            sourceState: input.sourceState ?? existing.sourceState,
            analysisMetadataJson: input.analysisMetadataJson ?? existing.analysisMetadataJson,
          },
        },
        () => {
          throw new Error('fallback');
        },
      );
      return fromDto(dto);
    } catch (error) {
      if (getDbMode() === 'tauri') throw error;
      const list = getLocalAll();
      const idx = list.findIndex((s) => s.id === id);
      if (idx === -1) return null;
      list[idx] = { ...list[idx], ...input, updatedAt: nowISO() };
      if (input.forbiddenStyles) list[idx].prohibitedStyles = input.forbiddenStyles;
      lsSet(STYLE_KEY, list);
      return list[idx];
    }
  },

  async setActive(projectId: string, styleProfileId: string): Promise<void> {
    const normalizedProjectId = projectId.trim();
    await dbCall<void>(
      'set_active_style_profile',
      { input: { projectId: normalizedProjectId, styleProfileId } },
      () => {
        const list = getLocalAll();
        const target = list.find((profile) => profile.id === styleProfileId);
        if (!target || (target.novelId ?? '').trim() !== normalizedProjectId) {
          throw new Error('风格方案不存在或不属于当前作品');
        }
        for (const profile of list) {
          if ((profile.novelId ?? '').trim() === normalizedProjectId) {
            profile.isActive = profile.id === styleProfileId;
          }
        }
        lsSet(STYLE_KEY, list);
      },
    );
  },

  async remove(projectIdOrId: string, id?: string): Promise<void> {
    const sid = id || projectIdOrId;
    const existing = id ? null : await this.getById(sid);
    if (!id && !existing) return;
    const pid = id ? projectIdOrId : (existing?.novelId ?? '');
    await dbCall<void>('delete_style_profile', { projectId: pid, styleProfileId: sid }, () => {
      lsSet(
        STYLE_KEY,
        getLocalAll().filter((s) => s.id !== sid),
      );
    });
  },
};
