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
  | 'chapter_event'
  | 'context_record'
  | 'current_editor';

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
  currentEditorContent?: string;
}
