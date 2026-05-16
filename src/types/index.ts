/**
 * AI Novel Studio - 类型导出入口
 */

export * from './novel';
export * from './volume';
export * from './chapter';
export * from './character';
export * from './style';
export * from './output';
export * from './setting';
export * from './protagonist';
export type { Character, CharacterRoleType, CharacterSource, ChapterCharacterRole, ChapterCharacter, CharacterState, CreateCharacterInput, CharacterCandidate } from './character';
export { CharacterRoleLabels, ChapterCharacterRoleLabels } from './character';
export * from './chapterEvent';
export * from './context';
export * from './chapterSummary';
export type { ChapterEventStatus, ChapterEventSource, CreateChapterEventInput } from './chapterEvent';
export { ChapterEventStatusLabels } from './chapterEvent';
