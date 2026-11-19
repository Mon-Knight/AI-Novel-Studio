import type { AiGenerateOptions } from './ai';
import type { Chapter } from './chapter';
import type { ArtifactDecision } from './conversation';
import type { ChapterOutline, MasterOutline, OutlineType, VolumeOutline } from './outline';
import type { Volume } from './volume';

export interface VolumeOutlineCandidate {
  title: string;
  summary: string;
  goal?: string;
  mainConflict?: string;
  rawText?: string;
}

export interface ChapterOutlineCandidate {
  title: string;
  outline: string;
  goal?: string;
  targetWordCount?: number;
  rawText?: string;
  /** Native batch position, retained through UI edits; never formal-write authority. */
  runtimeIndex?: number;
}

/** A dedicated UI objective, not authority to save, adopt or create structure. */
export interface OutlineRuntimeEntry {
  kind: 'outline_generate';
  outlineType: OutlineType;
  format: 'editor_text' | 'volume_candidate' | 'chapter_candidates';
  targetId?: string;
  volumeId?: string;
  targetTitle?: string;
  targetIndex?: number;
  parentOutlineId?: string;
  chapterGoal?: string;
  chapterCount?: number;
}

/** Immutable native candidate identity; the application service re-reads every fact. */
export interface OutlineGenerationEvidence {
  version: 1;
  novelId: string;
  conversationId: string;
  turnId: string;
  runId: string;
  cardId: string;
  artifactId: string;
  artifactHash: string;
  request: OutlineRuntimeEntry;
}

export interface OutlineGenerationOptions extends AiGenerateOptions {
  onCandidate?: (source: OutlineGenerationEvidence) => void;
}

export type OutlineCandidateApplicationAction =
  | {
      kind: 'adopt_outline_version';
      outlineType: OutlineType;
      targetId?: string;
      outlineId: string;
      expectedVersion: number;
      expectedContentHash: string;
      expectedActive: { id: string; version: number; contentHash: string } | null;
    }
  | {
      kind: 'outline_version';
      outlineType: OutlineType;
      targetId?: string;
      parentOutlineId?: string;
      targetIndex?: number;
      title: string;
      content: string;
      saveAsNewVersion: boolean;
    }
  | {
      kind: 'volume';
      targetVolumeId?: string;
      candidate: Pick<VolumeOutlineCandidate, 'title' | 'summary' | 'goal' | 'mainConflict'>;
    }
  | {
      kind: 'chapter';
      targetVolumeId?: string;
      candidateIndex: number;
      candidate: Pick<ChapterOutlineCandidate, 'title' | 'outline' | 'goal' | 'targetWordCount'>;
    };

export interface ApplyOutlineCandidateInput {
  source: OutlineGenerationEvidence;
  operationId: string;
  action: OutlineCandidateApplicationAction;
}

/** A committed native receipt; generation and applying are different operations. */
export interface OutlineCandidateApplicationReceipt {
  receiptId: string;
  operationId: string;
  artifactId: string;
  artifactHash: string;
  baselineBefore: string;
  baselineAfter: string;
  appliedContentHash: string;
  entityType: 'master_outline' | 'volume_outline' | 'chapter_outline' | 'volume' | 'chapter';
  entityId: string;
  authority: 'manual_confirmation';
}

export interface ApplyOutlineCandidateResult {
  receipt: OutlineCandidateApplicationReceipt;
  decision: ArtifactDecision;
  outline?: MasterOutline | VolumeOutline | ChapterOutline;
  volume?: Volume;
  chapter?: Chapter;
}
