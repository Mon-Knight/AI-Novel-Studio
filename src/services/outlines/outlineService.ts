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
  return dbCall<OutlineGenerationContext>('build_outline_context', { projectId }, () => ({
    novelTitle: '未命名作品（浏览器模式）',
  }));
}
