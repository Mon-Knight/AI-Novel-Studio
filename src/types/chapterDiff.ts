export type ChapterDiffBlockKind = 'added' | 'removed' | 'modified' | 'unchanged';

export interface ChapterDiffBlock {
  kind: ChapterDiffBlockKind;
  baseIndex?: number;
  candidateIndex?: number;
  baseText?: string;
  candidateText?: string;
}

export interface ChapterDiffSummary {
  baseDraftId: string;
  baseDraftVersion: number;
  baseContentHash: string;
  candidateArtifactId: string;
  addedBlocks: number;
  removedBlocks: number;
  modifiedBlocks: number;
  unchangedBlocks: number;
  baseCharacterCount: number;
  candidateCharacterCount: number;
  characterDelta: number;
}

export interface ChapterDiffResult {
  status: 'ready' | 'blocked';
  summary?: ChapterDiffSummary;
  blocks: ChapterDiffBlock[];
  reason?: string;
}

export interface ChapterDiffInput {
  novelId: string;
  chapterId: string;
  baseDraftId: string;
  baseDraftVersion: number;
  baseContentHash: string;
  candidateArtifactId: string;
  candidateNovelId: string;
  candidateChapterId: string;
  candidateSourceDraftId: string;
  candidateSourceDraftVersion: number;
  candidateBaseContentHash: string;
  baseContent: string;
  candidateContent: string;
}
