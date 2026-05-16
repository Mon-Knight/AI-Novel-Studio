/**
 * AI Novel Studio - 小说作品类型定义
 */

import type { Chapter } from './chapter';

export type NovelStatus = 'planning' | 'writing' | 'completed' | 'paused';

export interface Novel {
  id: string;
  title: string;
  description: string;
  genre: string;
  coverUrl?: string;
  status: NovelStatus;
  currentVolumeId?: string;
  currentChapterId?: string;
  totalWords: number;
  targetWords: number;
  createdAt: string;
  updatedAt: string;
  volumes: Volume[];
}

export interface Volume {
  id: string;
  novelId: string;
  title: string;
  volumeNumber: number;
  summary: string;
  chapters: Chapter[];
  sortOrder: number;
}
