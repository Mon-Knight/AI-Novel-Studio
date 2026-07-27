export type MemorySourceType = 'chapter_summary' | 'context_record' | 'character_state';

export interface MemorySnapshotSourceRecord {
  snapshotId: string;
  sourceOrdinal: number;
  sourceType: MemorySourceType;
  sourceId: string;
  novelId: string;
  chapterId?: string | null;
  chapterRank?: number | null;
  sourceVersion: string;
  sourceHash: string;
  included: boolean;
  omissionReason?: 'budget' | null;
  createdAt: string;
}

export interface MemoryItem {
  sourceType: MemorySourceType;
  sourceId: string;
  chapterId?: string | null;
  chapterRank?: number | null;
  sourceVersion: string;
  sourceHash: string;
  data: Record<string, unknown>;
}

export interface ChapterContinuityMemory {
  schemaVersion: 1;
  kind: 'chapter_continuity';
  compiler: { id: 'structured_memory_compiler_v1'; version: 1 };
  novelId: string;
  targetChapterId: string;
  targetChapterRank: number;
  lookbackChapters: number;
  budgetBytes: number;
  stats: {
    candidateCount: number;
    includedCount: number;
    omittedCount: number;
  };
  items: MemoryItem[];
}

export interface MemorySnapshotRecord {
  snapshotId: string;
  operationId: string;
  requestHash: string;
  contractVersion: 'memory_snapshot_v1';
  memoryKind: 'chapter_continuity';
  compilerId: 'structured_memory_compiler_v1';
  compilerVersion: 1;
  novelId: string;
  targetChapterId: string;
  targetChapterRank: number;
  lookbackChapters: number;
  budgetBytes: number;
  sourceManifestJson: Array<Record<string, unknown>>;
  sourceManifestHash: string;
  memoryJson: ChapterContinuityMemory;
  memoryHash: string;
  candidateCount: number;
  includedCount: number;
  omittedCount: number;
  memoryBytes: number;
  createdAt: string;
}

export interface MemorySnapshotBundle {
  snapshot: MemorySnapshotRecord;
  sources: MemorySnapshotSourceRecord[];
}

export interface MemorySourceDrift {
  sourceType: MemorySourceType;
  sourceId: string;
  kind: 'missing' | 'changed' | 'unexpected';
}

export interface MemorySnapshotVerification {
  snapshotId: string;
  valid: boolean;
  requestHashValid: boolean;
  storedManifestValid: boolean;
  storedMemoryValid: boolean;
  recompiledManifestHash: string;
  recompiledMemoryHash: string;
  drift: MemorySourceDrift[];
}

