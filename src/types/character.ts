/**
 * AI Novel Studio - 角色类型定义（v0.7.0 增强版）
 */

export type CharacterRoleType = 'protagonist' | 'supporting' | 'antagonist' | 'neutral';
export type CharacterSource = 'manual' | 'ai_generated';
export type ChapterCharacterRole = 'main' | 'supporting' | 'mentioned' | 'hidden';

export const CharacterRoleLabels: Record<CharacterRoleType, string> = {
  protagonist: '主角', supporting: '配角', antagonist: '反派', neutral: '中立',
};
export const ChapterCharacterRoleLabels: Record<ChapterCharacterRole, string> = {
  main: '主要出场', supporting: '辅助出场', mentioned: '仅提及', hidden: '幕后影响',
};

export interface Character {
  id: string; novelId: string; name: string;
  roleType?: CharacterRoleType; identity?: string; faction?: string;
  relationToProtagonist?: string; goal?: string; personality?: string;
  behaviorLimits?: string; forbiddenBehaviors?: string;
  firstAppearanceChapterId?: string; currentState?: string;
  source: CharacterSource; isActive: boolean;
  createdAt: string; updatedAt: string;
}

export interface CharacterState {
  id: string; novelId: string; characterId: string; chapterId?: string;
  stateSummary: string; relationshipChanges?: string; goalChanges?: string;
  location?: string; healthState?: string; knowledgeState?: string;
  createdAt: string;
}

export interface CreateCharacterStateInput {
  novelId: string; characterId: string; chapterId?: string;
  stateSummary: string; relationshipChanges?: string; goalChanges?: string;
  location?: string; healthState?: string; knowledgeState?: string;
}

export interface ChapterCharacter {
  id: string; novelId: string; chapterId: string; characterId: string;
  characterName?: string;
  roleInChapter: ChapterCharacterRole; mustAppear: boolean; note?: string;
  createdAt: string; updatedAt: string;
}

export interface CreateCharacterInput {
  novelId: string; name: string; roleType?: CharacterRoleType; identity?: string;
  faction?: string; relationToProtagonist?: string; goal?: string;
  personality?: string; behaviorLimits?: string; forbiddenBehaviors?: string; currentState?: string;
}

export interface CharacterCandidate {
  name: string; roleType?: string; identity?: string; faction?: string;
  relationToProtagonist?: string; goal?: string; personality?: string;
  behaviorLimits?: string; forbiddenBehaviors?: string; currentState?: string; chapterFunction?: string;
  rawText?: string;
}
