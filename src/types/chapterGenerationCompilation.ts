import type { AiGenerateRequest, ChapterGenerationContext } from './ai';
import type { ChapterEngineeringState } from './chapterEngineering';

export type ChapterGenerationContextPriority =
  | 'critical'
  | 'high'
  | 'normal'
  | 'background';

export type ChapterGenerationConstraintKind = 'must' | 'should' | 'forbid';

export interface ChapterGenerationSourceRef {
  kind: string;
  sourceId?: string;
  status: 'used' | 'missing' | 'trimmed';
  originalChars: number;
  includedChars: number;
  contentHash?: string;
}

export interface ChapterGenerationContextSection {
  key: string;
  title: string;
  priority: ChapterGenerationContextPriority;
  content: string;
  sourceRefs: ChapterGenerationSourceRef[];
}

export interface ChapterGenerationContextBudget {
  maxChars: number;
  usedChars: number;
  truncatedChars: number;
  omittedSections: string[];
  trimmedSections: string[];
  promptChars?: number;
}

export interface ChapterGenerationConstraint {
  id: string;
  kind: ChapterGenerationConstraintKind;
  text: string;
  sourceRefs: ChapterGenerationSourceRef[];
}

export interface ChapterGenerationConstraintSet {
  must: ChapterGenerationConstraint[];
  should: ChapterGenerationConstraint[];
  forbid: ChapterGenerationConstraint[];
  text: string;
  hash: string;
  budget: {
    maxChars: number;
    usedChars: number;
    omittedShouldCount: number;
  };
}

export interface ChapterGenerationPromptTemplate {
  id: string;
  version: string;
  body: string;
  hash: string;
}

export interface ChapterGenerationDraftBaseline {
  id: string;
  novelId: string;
  chapterId: string;
  versionNo: number;
  content: string;
  contentHash: string;
  isAdopted: boolean;
}

export interface ChapterGenerationSummarySource {
  id: string;
  chapterId: string;
  chapterTitle: string;
  orderIndex: number;
  summary: string;
  unresolvedQuestions: string[];
  foreshadowing: string[];
  factsMustRemember: string[];
}

export interface ChapterGenerationRecentState {
  id: string;
  title: string;
  orderIndex: number;
  status: string;
  adoptedDraftId?: string;
}

export interface ChapterGenerationTextSource {
  id: string;
  type: string;
  title: string;
  content: string;
  importance?: number;
}

export interface ChapterGenerationQualityIssue {
  id: string;
  issueType: string;
  severity: string;
  title: string;
  description: string;
  suggestion?: string;
}

export interface ChapterGenerationEventConstraint {
  id: string;
  status: 'required' | 'selected' | 'forbidden';
  title: string;
  description: string;
}

export interface ChapterGenerationCompilationSource {
  novelId: string;
  volumeId?: string;
  chapterId: string;
  baseContext: ChapterGenerationContext;
  sourceDraft: ChapterGenerationDraftBaseline;
  adoptedDraft?: ChapterGenerationDraftBaseline;
  previousSummaries: ChapterGenerationSummarySource[];
  recentStates: ChapterGenerationRecentState[];
  unresolvedThreads: ChapterGenerationTextSource[];
  qualityIssues: ChapterGenerationQualityIssue[];
  events: ChapterGenerationEventConstraint[];
  engineeringState?: ChapterEngineeringState;
  worldRuleForbids: string[];
  warnings: string[];
}

export interface ChapterGenerationContextContract {
  context: ChapterGenerationContext;
  sections: ChapterGenerationContextSection[];
  text: string;
  sourceManifest: {
    schemaVersion: number;
    novelId: string;
    volumeId?: string;
    chapterId: string;
    sourceDraft: Pick<ChapterGenerationDraftBaseline, 'id' | 'versionNo' | 'contentHash'>;
    sources: ChapterGenerationSourceRef[];
    contextHash: string;
  };
  budget: ChapterGenerationContextBudget;
  hash: string;
  warnings: string[];
}

export interface CompiledChapterGeneration {
  contextContract: ChapterGenerationContextContract;
  constraints: ChapterGenerationConstraintSet;
  promptTemplate: ChapterGenerationPromptTemplate;
  request: AiGenerateRequest;
  compiledPrompt: string;
}
