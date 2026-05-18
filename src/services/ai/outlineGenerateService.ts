/**
 * AI Novel Studio - AI outline generation service.
 */
import { createAiClient, aiSettingsService } from './aiClient';
import {
  buildChapterOutlineGeneratePrompt,
  buildOutlineGeneratePrompt,
  buildVolumeOutlineGeneratePrompt,
} from './promptBuilder';
import { aiTaskService } from './aiTaskService';
import { safeJsonParse } from './jsonUtils';
import { novelRepository } from '../database/novelRepository';
import { settingRepository } from '../database/settingRepository';
import { protagonistRepository } from '../database/protagonistRepository';
import { volumeRepository } from '../database/volumeRepository';
import { chapterRepository } from '../database/chapterRepository';
import { styleProfileService } from '../styles/styleProfileService';
import { masterOutlineService, volumeOutlineService } from '../outlines/outlineService';

export interface VolumeOutlineCandidate {
  title: string;
  summary: string;
  goal?: string;
  mainConflict?: string;
  rawText?: string;
}

export interface ChapterOutlineCandidate {
  title: string;
  outline: string;
  goal?: string;
  targetWordCount?: number;
  rawText?: string;
}

async function buildOutlineContext(novelId: string, volumeId?: string) {
  const [novel, worldSettings, ruleSystems, protagonist, volumes, chapters] = await Promise.all([
    novelRepository.getById(novelId),
    settingRepository.getWorldSettings(novelId).catch(() => []),
    settingRepository.getRuleSystems(novelId).catch(() => []),
    protagonistRepository.getByNovelId(novelId).catch(() => null),
    volumeRepository.getByNovelId(novelId).catch(() => []),
    chapterRepository.getByNovelId(novelId).catch(() => []),
  ]);

  const activeWorld = worldSettings.find((item) => item.isActive) || worldSettings[0];
  const activeRules = ruleSystems.filter((item) => item.isActive);

  // v1.0.35: 加载当前采用总纲
  let activeMasterOutline: string | undefined;
  let activeMasterOutlineId: string | undefined;
  try {
    const masterOutline = await masterOutlineService.getActive(novelId);
    if (masterOutline) {
      activeMasterOutline = masterOutline.content;
      activeMasterOutlineId = masterOutline.id;
    } else {
      // 降级：读取最近更新的总纲
      const versions = await masterOutlineService.getVersions(novelId);
      if (versions.length > 0) {
        activeMasterOutline = versions[0].content;
        activeMasterOutlineId = versions[0].id;
      }
    }
  } catch { /* 总纲加载失败不影响生成 */ }

  // v1.0.35: 加载当前采用分卷大纲
  let activeVolumeOutline: string | undefined;
  let activeVolumeOutlineId: string | undefined;
  if (volumeId) {
    try {
      const volumeOutline = await volumeOutlineService.getActive(novelId, volumeId);
      if (volumeOutline) {
        activeVolumeOutline = volumeOutline.content;
        activeVolumeOutlineId = volumeOutline.id;
      } else {
        // 降级：读取最近更新的该分卷大纲
        const versions = await volumeOutlineService.getVersions(novelId, volumeId);
        if (versions.length > 0) {
          activeVolumeOutline = versions[0].content;
          activeVolumeOutlineId = versions[0].id;
        }
      }
    } catch { /* 分卷大纲加载失败不影响生成 */ }
  }

  // v1.0.33: 加载当前采用风格方案
  let styleSummary: string | undefined;
  try {
    const activeStyle = await styleProfileService.getActive(novelId);
    if (activeStyle) {
      const parts: string[] = [];
      if (activeStyle.narrativePerspective) parts.push(`叙事人称：${activeStyle.narrativePerspective}`);
      if (activeStyle.tone) parts.push(`文风：${activeStyle.tone}`);
      if (activeStyle.pace) parts.push(`节奏：${activeStyle.pace}`);
      parts.push(`对话比例：${Math.round(activeStyle.dialogueRatio * 100)}%，描写比例：${Math.round(activeStyle.descriptionRatio * 100)}%`);
      if (activeStyle.battleIntensity) parts.push(`战斗强度：${activeStyle.battleIntensity}`);
      if (activeStyle.emotionTendency) parts.push(`情绪倾向：${activeStyle.emotionTendency}`);
      if (activeStyle.prohibitedStyles?.length) parts.push(`禁用：${activeStyle.prohibitedStyles.join('、')}`);
      styleSummary = parts.join('\n');
    }
  } catch { /* 风格加载失败不影响生成 */ }

  // v1.0.35: 构建上下文快照（记录使用的大纲 ID）
  const contextSnapshot = JSON.stringify({
    used_master_outline_id: activeMasterOutlineId || null,
    used_volume_outline_id: activeVolumeOutlineId || null,
    has_active_master: !!activeMasterOutline,
    has_active_volume: !!activeVolumeOutline,
  });

  return {
    novelTitle: novel?.title || '未命名作品',
    novelGenre: novel?.genre,
    description: novel?.description,
    worldBackground: activeWorld?.content?.slice(0, 1600),
    ruleSystems: activeRules.map((item) => `《${item.title}》${item.content}`).join('\n').slice(0, 2400),
    protagonist: protagonist ? [protagonist.name, protagonist.identity, protagonist.personality, protagonist.goal].filter(Boolean).join('；') : undefined,
    specialAbility: protagonist?.specialAbility,
    existingVolumes: volumes.map((item) => `- ${item.title}：${item.summary || item.goal || ''}`).join('\n'),
    existingChapters: chapters.map((item) => `- ${item.title}：${item.outline || item.goal || ''}`).join('\n').slice(0, 3000),
    styleSummary,
    activeMasterOutline,
    activeMasterOutlineId,
    activeVolumeOutline,
    activeVolumeOutlineId,
    contextSnapshot,
  };
}

export const outlineGenerateService = {
  async generateNovelOutline(novelId: string): Promise<string> {
    const settings = aiSettingsService.getSettings();
    const context = await buildOutlineContext(novelId);
    const request = buildOutlineGeneratePrompt(context);
    const task = await aiTaskService.create('outline_generate', {
      novelId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `生成作品总大纲：${context.novelTitle}`,
    }).catch(() => null);

    try {
      const client = createAiClient(settings);
      const response = await client.generate(request);
      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: response.text,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });
      return response.text;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '作品大纲生成失败';
      if (task) await aiTaskService.markFailed(task.id, message);
      throw e;
    }
  },

  async generateVolumeOutline(input: { novelId: string; volumeTitle?: string }): Promise<VolumeOutlineCandidate> {
    const settings = aiSettingsService.getSettings();
    const context = await buildOutlineContext(input.novelId);
    const request = buildVolumeOutlineGeneratePrompt({
      novelTitle: context.novelTitle,
      novelGenre: context.novelGenre,
      description: context.description,
      worldBackground: context.worldBackground,
      ruleSystems: context.ruleSystems,
      protagonist: context.protagonist,
      specialAbility: context.specialAbility,
      existingVolumes: context.existingVolumes,
      existingChapters: context.existingChapters,
      volumeTitle: input.volumeTitle,
      activeMasterOutline: context.activeMasterOutline,
      styleSummary: context.styleSummary,
    });
    const task = await aiTaskService.create('volume_outline_generate', {
      novelId: input.novelId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `生成分卷大纲：${input.volumeTitle || context.novelTitle}${context.activeMasterOutline ? '（已结合总纲）' : '（⚠️ 缺少总纲）'}`,
    }).catch(() => null);

    try {
      const client = createAiClient(settings);
      const response = await client.generate(request);
      const parsed = safeJsonParse<Partial<VolumeOutlineCandidate>>(response.text, {});
      const result: VolumeOutlineCandidate = {
        title: parsed.title?.trim() || input.volumeTitle || '新分卷',
        summary: parsed.summary?.trim() || response.text.slice(0, 1000),
        goal: parsed.goal,
        mainConflict: parsed.mainConflict,
        rawText: response.text,
      };
      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: `${result.title}：${result.summary}${context.activeMasterOutlineId ? ` [使用总纲:${context.activeMasterOutlineId.slice(0, 8)}]` : ''}`,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });
      return result;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '分卷大纲生成失败';
      if (task) await aiTaskService.markFailed(task.id, message);
      throw e;
    }
  },

  async generateChapterOutlines(input: {
    novelId: string;
    volumeId?: string;
    chapterId?: string;
    chapterTitle?: string;
    chapterGoal?: string;
    chapterCount?: number;
  }): Promise<ChapterOutlineCandidate[]> {
    const settings = aiSettingsService.getSettings();
    const [context, volume] = await Promise.all([
      buildOutlineContext(input.novelId, input.volumeId),
      input.volumeId ? volumeRepository.getById(input.volumeId).catch(() => null) : Promise.resolve(null),
    ]);
    const request = buildChapterOutlineGeneratePrompt({
      novelTitle: context.novelTitle,
      novelGenre: context.novelGenre,
      description: context.description,
      worldBackground: context.worldBackground,
      ruleSystems: context.ruleSystems,
      protagonist: context.protagonist,
      specialAbility: context.specialAbility,
      existingVolumes: context.existingVolumes,
      existingChapters: context.existingChapters,
      volumeTitle: volume?.title || context.novelTitle,
      volumeSummary: volume?.summary || volume?.goal,
      currentChapterTitle: input.chapterTitle,
      currentChapterGoal: input.chapterGoal,
      chapterCount: input.chapterCount,
      activeMasterOutline: context.activeMasterOutline,
      activeVolumeOutline: context.activeVolumeOutline,
      styleSummary: context.styleSummary,
    });

    const parentInfo: string[] = [];
    if (context.activeMasterOutline) parentInfo.push('有总纲');
    if (context.activeVolumeOutline) parentInfo.push('有分卷大纲');
    const parentTag = parentInfo.length > 0 ? `（${parentInfo.join('、')}）` : '（⚠️ 无上级大纲）';

    const task = await aiTaskService.create('chapter_outline_generate', {
      novelId: input.novelId,
      chapterId: input.chapterId,
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
      inputSummary: `生成章节大纲：${input.chapterTitle || volume?.title || context.novelTitle}${parentTag}${input.chapterGoal ? '，有本章目标' : ''}`,
    }).catch(() => null);

    try {
      const client = createAiClient(settings);
      const response = await client.generate(request);
      const parsed = safeJsonParse<{ chapters: ChapterOutlineCandidate[] }>(response.text, { chapters: [] });
      const chapters = Array.isArray(parsed.chapters)
        ? parsed.chapters.filter((item) => item.title && item.outline).map((item) => ({
          ...item,
          targetWordCount: (Number.isFinite(item.targetWordCount) && (item.targetWordCount as number) > 0) ? item.targetWordCount : undefined,
        }))
        : [];

      const usedOutlines: string[] = [];
      if (context.activeMasterOutlineId) usedOutlines.push(`总纲:${context.activeMasterOutlineId.slice(0, 8)}`);
      if (context.activeVolumeOutlineId) usedOutlines.push(`分卷大纲:${context.activeVolumeOutlineId.slice(0, 8)}`);

      await aiTaskService.markSucceeded(task?.id || '', {
        resultText: chapters.length > 0
          ? `生成了 ${chapters.length} 个章节大纲${usedOutlines.length > 0 ? ` [${usedOutlines.join(', ')}]` : ''}`
          : response.text,
        tokenInput: response.tokenInput,
        tokenOutput: response.tokenOutput,
        tokenTotal: response.tokenTotal,
      });

      if (chapters.length > 0) return chapters;
      return [{
        title: 'AI 原始返回',
        outline: response.text.slice(0, 1000),
        targetWordCount: 4000,
        rawText: response.text,
      }];
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : '章节大纲生成失败';
      if (task) await aiTaskService.markFailed(task.id, message);
      throw e;
    }
  },
};
