/**
 * AI Novel Studio - 小说作品类型定义
 */

import type { Volume } from './volume';

export type NovelStatus =
  | 'draft'
  | 'planning'
  | 'writing'
  | 'paused'
  | 'completed'
  | 'archived';

export interface Novel {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  outline?: string;
  genre?: string;
  protagonistName?: string;
  worldBackground?: string;
  coverPath?: string;
  coverUrl?: string;
  status: NovelStatus;
  currentVolumeId?: string;
  currentChapterId?: string;
  totalWordCount: number;
  totalWords: number;
  targetWordCount?: number;
  targetWords: number;
  chapterCount?: number;
  volumeCount?: number;
  lastOpenedAt?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  volumes: Volume[];
}

export interface CreateNovelInput {
  title: string;
  subtitle?: string;
  description?: string;
  outline?: string;
  genre?: string;
  targetWordCount?: number;
}

export interface UpdateNovelInput {
  title?: string;
  subtitle?: string;
  description?: string;
  outline?: string;
  genre?: string;
  status?: NovelStatus;
  targetWordCount?: number;
  currentVolumeId?: string;
  currentChapterId?: string;
  totalWordCount?: number;
}
