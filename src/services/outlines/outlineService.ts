/**
 * AI Novel Studio - 大纲服务
 */
import { dbCall } from '../database/db';
import type {
  MasterOutline, VolumeOutline, ChapterOutline,
  OutlineGenerationContext, OutlineType,
} from '../../types/outline';

// ==================== Master Outline ====================

export const masterOutlineService = {
  async getActive(projectId: string): Promise<MasterOutline | null> {
    return dbCall<MasterOutline | null>('get_master_outline', { projectId }, () => null);
  },

  async getVersions(projectId: string): Promise<MasterOutline[]> {
    return dbCall<MasterOutline[]>('get_master_outline_versions', { projectId }, () => []);
  },

  async save(input: {
    projectId: string; title: string; content: string;
    sourceType?: string; contextSnapshot?: string; saveAsNewVersion?: boolean;
  }): Promise<MasterOutline> {
    return dbCall<MasterOutline>('save_master_outline', { input }, () => {
      throw new Error('浏览器模式暂不支持大纲持久化');
    });
  },

  async setActive(id: string, projectId: string): Promise<void> {
    return dbCall<void>('set_active_master_outline', { input: { id, projectId } }, () => {});
  },
};

// ==================== Volume Outline ====================

export const volumeOutlineService = {
  async getActive(projectId: string, volumeId?: string): Promise<VolumeOutline | null> {
    return dbCall<VolumeOutline | null>('get_volume_outline', { projectId, volumeId }, () => null);
  },

  async getVersions(projectId: string, volumeId?: string): Promise<VolumeOutline[]> {
    return dbCall<VolumeOutline[]>('get_volume_outline_versions', { projectId, volumeId }, () => []);
  },

  async save(input: {
    projectId: string; masterOutlineId?: string; volumeId?: string;
    volumeIndex?: number; title: string; content: string;
    sourceType?: string; contextSnapshot?: string; saveAsNewVersion?: boolean;
  }): Promise<VolumeOutline> {
    return dbCall<VolumeOutline>('save_volume_outline', { input }, () => {
      throw new Error('浏览器模式暂不支持大纲持久化');
    });
  },

  async setActive(id: string, projectId: string): Promise<void> {
    return dbCall<void>('set_active_volume_outline', { input: { id, projectId } }, () => {});
  },
};

// ==================== Chapter Outline ====================

export const chapterOutlineService = {
  async getActive(projectId: string, chapterId?: string): Promise<ChapterOutline | null> {
    return dbCall<ChapterOutline | null>('get_chapter_outline', { projectId, chapterId }, () => null);
  },

  async getVersions(projectId: string, chapterId?: string): Promise<ChapterOutline[]> {
    return dbCall<ChapterOutline[]>('get_chapter_outline_versions', { projectId, chapterId }, () => []);
  },

  async save(input: {
    projectId: string; volumeOutlineId?: string; chapterId?: string;
    chapterIndex?: number; title: string; content: string;
    sourceType?: string; contextSnapshot?: string; saveAsNewVersion?: boolean;
  }): Promise<ChapterOutline> {
    return dbCall<ChapterOutline>('save_chapter_outline', { input }, () => {
      throw new Error('浏览器模式暂不支持大纲持久化');
    });
  },

  async setActive(id: string, projectId: string): Promise<void> {
    return dbCall<void>('set_active_chapter_outline', { input: { id, projectId } }, () => {});
  },
};

// ==================== Context ====================

export async function loadOutlineContext(projectId: string): Promise<OutlineGenerationContext> {
  // 优先使用后端 Rust 命令，降级使用前端 fallback
  try {
    const result = await dbCall<OutlineGenerationContext | null>('build_outline_context', { projectId }, () => null);
    if (result && result.novelTitle) return result;
  } catch { /* 降级到前端构建 */ }

  // 前端 fallback：从 localStorage 构建基础上下文
  try {
    const { novelRepository } = await import('../database/novelRepository');
    const { settingRepository } = await import('../database/settingRepository');
    const { protagonistRepository } = await import('../database/protagonistRepository');
    const { volumeRepository } = await import('../database/volumeRepository');
    const { chapterRepository } = await import('../database/chapterRepository');

    const [novel, worldSettings, ruleSystems, protagonist, volumes, chapters] = await Promise.all([
      novelRepository.getById(projectId),
      settingRepository.getWorldSettings(projectId).catch(() => []),
      settingRepository.getRuleSystems(projectId).catch(() => []),
      protagonistRepository.getByNovelId(projectId).catch(() => null),
      volumeRepository.getByNovelId(projectId).catch(() => []),
      chapterRepository.getByNovelId(projectId).catch(() => []),
    ]);

    const activeWorld = worldSettings.find((item) => item.isActive) || worldSettings[0];
    const activeRules = ruleSystems.filter((item) => item.isActive);

    // v1.0.35: 加载上层大纲
    let activeMasterOutline: string | undefined;
    let activeVolumeOutline: string | undefined;
    try {
      const masterOutline = await masterOutlineService.getActive(projectId);
      if (masterOutline) activeMasterOutline = masterOutline.content;
      else {
        const versions = await masterOutlineService.getVersions(projectId);
        if (versions.length > 0) activeMasterOutline = versions[0].content;
      }
    } catch { /* ignore */ }

    return {
      novelTitle: novel?.title || '未命名作品',
      novelGenre: novel?.genre,
      description: novel?.description,
      targetWordCount: novel?.targetWordCount,
      worldBackground: activeWorld?.content?.slice(0, 1600),
      ruleSystems: activeRules.map((item) => `《${item.title}》${item.content}`).join('\n').slice(0, 2400),
      protagonistName: protagonist?.name,
      protagonistIdentity: protagonist?.identity,
      protagonistPersonality: protagonist?.personality,
      protagonistGoal: protagonist?.goal,
      protagonistAbility: protagonist?.specialAbility,
      protagonistAbilityLimits: protagonist?.abilityLimits,
      protagonistForbidden: protagonist?.forbiddenBehaviors,
      activeMasterOutline,
      existingVolumes: volumes.map((item) => `- ${item.title}：${item.summary || item.goal || ''}`).join('\n'),
      existingChapters: chapters.map((item) => `- ${item.title}：${item.outline || item.goal || ''}`).join('\n').slice(0, 3000),
    };
  } catch {
    return {
      novelTitle: '未命名作品（浏览器模式）',
    };
  }
}
