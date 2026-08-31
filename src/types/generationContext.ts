import type { ChapterGenerationContext } from './ai';
import type { ChapterEngineeringState } from './chapterEngineering';

export type GenerationContextSourceType =
  | 'novel'
  | 'world_setting'
  | 'rule_system'
  | 'protagonist'
  | 'master_outline'
  | 'volume_outline'
  | 'chapter_outline'
  | 'chapter_engineering'
  | 'style_profile'
  | 'output_profile'
  | 'chapter_character'
  | 'character_state'
  | 'chapter_event'
  | 'faction'
  | 'location'
  | 'reference_material'
  | 'context_record'
  | 'world_state'
  | 'memory_context'
  | 'user_instruction'
  | 'adopted_chapter'
  | 'provisional_candidate'
  | 'current_editor';

export interface AdoptedPreviousChapterContext {
  chapterId: string;
  draftId: string;
  contentHash: string;
  content: string;
}

export interface ProvisionalPreviousChapterContext {
  chapterId: string;
  draftId: string;
  contentHash: string;
  content: string;
}

export interface GenerationContextSource {
  type: GenerationContextSourceType;
  title: string;
  sourceId?: string;
  status: 'used' | 'missing' | 'fallback';
  summary?: string;
}

export interface GenerationContextSection {
  key: string;
  title: string;
  content: string;
  sourceTypes: GenerationContextSourceType[];
}

export interface CompiledGenerationContext {
  chapterId: string;
  novelId: string;
  volumeId?: string;
  baseContext: ChapterGenerationContext;
  activeEngineeringState?: ChapterEngineeringState;
  sections: GenerationContextSection[];
  sources: GenerationContextSource[];
  warnings: string[];
  compiledAt: string;
}

export interface ChapterGenerationSnapshot {
  id: string;
  novelId: string;
  volumeId?: string;
  chapterId: string;
  engineeringStateId?: string;
  styleProfileId?: string;
  outputProfileId?: string;
  compiledContext: CompiledGenerationContext;
  compiledPromptText: string;
  promptSummary: string;
  contextHash: string;
  sources: GenerationContextSource[];
  createdAt: string;
}

export interface CompileGenerationContextInput {
  novelId: string;
  volumeId?: string;
  chapterId: string;
  engineeringStateId?: string;
  styleProfileId?: string;
  outputProfileId?: string;
  userInstruction?: string;
  /** Retrieved durable facts frozen into the same snapshot as the final prompt. */
  retrievedMemoryContext?: string;
  currentEditorContent?: string;
  /** Workbench-only readiness gate. Legacy generation callers remain permissive. */
  requireCoreAssets?: boolean;
  adoptedPreviousChapter?: AdoptedPreviousChapterContext;
  provisionalPreviousChapter?: ProvisionalPreviousChapterContext;
}
