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

export type ProtagonistMode = 'single' | 'dual';

export interface ProtagonistProfile {
  id: string;
  label: 'primary' | 'secondary';
  name: string;
  gender?: string;
  identity?: string;
  personality?: string;
  goal?: string;
  motivation?: string;
  specialAbility?: string;
  abilityLimits?: string;
  forbiddenBehaviors?: string;
  background?: string;
  arc?: string;
  notes?: string;
}

export interface DualProtagonistRelation {
  type: 'partner' | 'romance' | 'rival' | 'bound' | 'mentor_student' | 'family' | 'enemy_to_ally' | 'parallel' | 'custom';
  description: string;
  conflict?: string;
  cooperation?: string;
  emotionalProgression?: string;
  narrativeWeight?: 'balanced' | 'primary_main' | 'secondary_main';
}

export interface Novel {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  outline?: string;
  genre?: string;
  protagonistName?: string;
  protagonistMode: ProtagonistMode;
  protagonists: ProtagonistProfile[];
  dualProtagonistRelation?: DualProtagonistRelation;
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
