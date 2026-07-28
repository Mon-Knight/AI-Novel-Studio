/**
 * AI Novel Studio - 大纲类型定义
 */

export interface MasterOutline {
  id: string;
  projectId: string;
  title: string;
  content: string;
  status: 'draft' | 'active' | 'archived';
  version: number;
  isActive: boolean;
  sourceType: 'manual' | 'ai_generated' | 'ai_edited';
  contextSnapshot?: string;
  createdAt: string;
  updatedAt: string;
}

export interface VolumeOutline {
  id: string;
  projectId: string;
  masterOutlineId?: string;
  volumeId?: string;
  volumeIndex: number;
  title: string;
  content: string;
  status: 'draft' | 'active' | 'archived';
  version: number;
  isActive: boolean;
  sourceType: 'manual' | 'ai_generated' | 'ai_edited';
  contextSnapshot?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterOutline {
  id: string;
  projectId: string;
  volumeOutlineId?: string;
  chapterId?: string;
  chapterIndex: number;
  title: string;
  content: string;
  status: 'draft' | 'active' | 'archived';
  version: number;
  isActive: boolean;
  sourceType: 'manual' | 'ai_generated' | 'ai_edited';
  contextSnapshot?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OutlineGenerationContext {
  novelTitle: string;
  novelGenre?: string;
  description?: string;
  targetWordCount?: number;
  worldBackground?: string;
  ruleSystems?: string;
  protagonistName?: string;
  protagonistIdentity?: string;
  protagonistPersonality?: string;
  protagonistGoal?: string;
  protagonistAbility?: string;
  protagonistAbilityLimits?: string;
  protagonistForbidden?: string;
  activeMasterOutline?: string;
  activeVolumeOutline?: string;
  existingVolumes?: string;
  existingChapters?: string;
  styleSummary?: string;
  outputConfigSummary?: string;
}

export type OutlineType = 'master' | 'volume' | 'chapter';
