import type { ChapterCharacterContext, OutlineKeyPoint } from './ai';

/**
 * Assembled per-chapter generation context. Extracted from `types/ai.ts` so that the
 * type module keeps its size budget; the public import path is unchanged because
 * `types/ai.ts` re-exports this module's interface.
 */

export interface ChapterGenerationContext {
  novelTitle: string;
  novelGenre?: string;
  novelDescription?: string;
  novelOutline?: string;
  masterOutline?: string;
  worldBackground?: string;
  /** Complete world material projection; not a narrative consistency verdict. */
  worldSettingCoverage?: import('./generationContext').GenerationRuleCoverage;
  worldSettingSources?: Array<{
    id: string;
    title: string;
    role: 'primary' | 'supplemental';
    updatedAt: string;
  }>;
  ruleSystems?: string;
  /** Coverage of the actual rule projection, not a semantic-consistency verdict. */
  ruleSystemCoverage?: import('./generationContext').GenerationRuleCoverage;
  protagonist?: string;
  specialAbility?: string;
  abilityLimits?: string;
  forbiddenBehaviors?: string;
  protagonistMode?: string;
  protagonistsSummary?: string;
  dualProtagonistSummary?: string;
  protagonistNames?: string;
  protagonistAppearance?: string;
  protagonistMustAppear?: boolean;
  volumeTitle?: string;
  volumeOutline?: string;
  volumeGoal?: string;
  volumeConflict?: string;
  chapterTitle: string;
  chapterOutline?: string;
  outlineKeyPoints?: OutlineKeyPoint[];
  outlineChecklistText?: string;
  chapterGoal?: string;
  targetWordCount?: number;
  styleProfile?: string;
  outputProfile?: string;
  chapterCharacters?: string;
  chapterCharacterList?: ChapterCharacterContext[];
  requiredCharacters?: ChapterCharacterContext[];
  requiredCharactersSummary?: string;
  requiredCharacterNames?: string;
  characterStates?: string;
  characterStateSources?: Array<{
    id: string;
    characterId: string;
    characterName: string;
    chapterId?: string;
    origin: 'character_state' | 'character_current_state';
  }>;
  chapterEvents?: string;
  chapterSettings?: string;
  /** Read-time projection from persisted adopted summaries and ContextRecords. */
  worldStateTimeline?: string;
  worldStateTimelineSource?: {
    latestChapterId: string;
    chapterCount: number;
    sourceSummaryIds: string[];
    sourceContextRecordIds: string[];
  };
  previousContext?: string;
  userInstruction?: string;
  /** 当前草稿正文（重新生成/改写模式时传入） */
  draftContent?: string;
  chapterOutlineSource?: 'active_chapter_outline' | 'chapter_field' | 'draft' | 'empty';
  volumeOutlineSource?: 'active_outline' | 'volume_field' | 'none';
  masterOutlineSource?: 'active_outline' | 'novel_field' | 'novel_description' | 'none';
  /** Optional context sources that could not be read while this context was built. */
  contextWarnings?: string[];
}
