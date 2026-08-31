import type { TaskModelSnapshot } from '../../../types/conversation';

/**
 * Stable request envelope shared by domain facades.
 *
 * The envelope deliberately carries domain identities instead of repository
 * objects.  A later Tool projection can map model arguments into this shape,
 * while UI and host-protocol callers can use the same contract today.
 */
export interface DomainRequest {
  novelId: string;
  chapterId?: string;
  conversationId?: string;
  cardId?: string;
  artifactId?: string;
  authorizationId?: string;
  draftId?: string;
  query?: string;
  instruction?: string;
  candidateText?: string;
  structuredPayload?: unknown;
  artifactType?: string;
  title?: string;
  summary?: string;
  derivationType?: string;
  modelSnapshot?: TaskModelSnapshot;
  previousCandidateText?: string;
  expectedDraftVersion?: number;
  expectedContentHash?: string;
  userConfirmedAt?: string;
  signal?: AbortSignal;
}

export type DomainStorageMode = 'sqlite' | 'browser_fallback' | 'runtime' | 'artifact';

export interface DomainError {
  code:
    | 'INVALID_SCOPE'
    | 'INVALID_ARGUMENT'
    | 'PERMISSION_DENIED'
    | 'SCOPE_MISMATCH'
    | 'NOT_FOUND'
    | 'INTEGRITY_ERROR'
    | 'CONFIRMATION_REQUIRED'
    | 'MODEL_SNAPSHOT_REQUIRED'
    | 'CANDIDATE_ONLY'
    | 'UPSTREAM_FAILURE'
    | 'CONFLICT';
  message: string;
  retryable: boolean;
}

export interface DomainResult<T> {
  ok: boolean;
  data?: T;
  error?: DomainError;
  /** Stable domain source, never a raw repository/command name. */
  source: 'sqlite' | 'localstorage' | 'runtime' | 'artifact';
  /** Explicitly distinguishes browser fallback from SQLite evidence. */
  storageMode: DomainStorageMode;
  warnings: string[];
  /** Browser fallback has no database revision; null is intentional. */
  revision?: string | null;
  /** Hash of the canonical public DTO or candidate content. */
  contentHash?: string;
}

export type PublicJson =
  string | number | boolean | null | PublicJson[] | { [key: string]: PublicJson };

export interface ProjectSummary {
  id: string;
  title: string;
  description: string;
  genre: string;
  status: string;
  totalWordCount: number;
  targetWordCount: number;
  currentVolumeId?: string;
  currentChapterId?: string;
  updatedAt: string;
}

export interface SettingSummary {
  id: string;
  title: string;
  details: string;
  active: boolean;
}

export interface ProtagonistSummary {
  id: string;
  name: string;
  identity: string;
  goal: string;
  ability: string;
  limits: string;
  behaviorBoundaries: string;
  currentState: string;
}

export interface VolumeSummary {
  id: string;
  novelId: string;
  title: string;
  summary: string;
  goal: string;
  mainConflict: string;
  orderIndex: number;
  status: string;
}

export interface ChapterSummary {
  id: string;
  novelId: string;
  volumeId?: string;
  title: string;
  outline: string;
  goal: string;
  status: string;
  targetWordCount: number;
  wordCount: number;
  adoptedDraftId?: string;
}

export interface ProjectReadModel {
  project: ProjectSummary;
  settings: {
    world: SettingSummary[];
    protagonists: ProtagonistSummary[];
  };
  structure: {
    volumes: VolumeSummary[];
    chapters: ChapterSummary[];
  };
}

export interface ChapterPosition {
  project: ProjectSummary;
  volume?: VolumeSummary;
  chapter: ChapterSummary;
  settings: ProjectReadModel['settings'];
}

export interface MemoryHit {
  chunkId: string;
  documentId: string;
  text: string;
  tokenCount: number;
  sourceType: string;
  sourceId: string;
  sourceVersion: number;
  sourceHash: string;
  adoptedDraftId?: string;
  chapterId?: string;
  score: {
    matchedBy: string[];
    finalScore: number;
  };
}

export interface MemorySearchResult {
  novelId: string;
  query: string;
  retrievalMode: string;
  items: MemoryHit[];
  hasMore: boolean;
  nextOffset: number;
}

export interface StoryContextReadModel {
  project: ProjectSummary;
  chapter: ChapterSummary;
  volume?: VolumeSummary;
  settings: {
    world: SettingSummary[];
    protagonists: ProtagonistSummary[];
  };
  chapterCharacters: Array<{
    id: string;
    characterId: string;
    name: string;
    role: string;
    mustAppear: boolean;
  }>;
  chapterEvents: Array<{
    id: string;
    title: string;
    summary: string;
    status: string;
  }>;
  style: {
    id?: string;
    name?: string;
    narrativePerspective?: string;
    tone?: string;
    pace?: string;
    forbiddenStyles: string[];
  };
  output: {
    id?: string;
    name?: string;
    targetWordCount: number;
    minWordCount: number;
    maxWordCount: number;
    paceLevel?: string;
  };
  memory?: MemorySearchResult;
}

export interface WritingCandidate {
  novelId: string;
  chapterId: string;
  text: string;
  mode: 'generate' | 'continue' | 'rewrite';
  candidateOnly: true;
  artifactId?: string;
  taskId?: string;
  contextHash?: string;
}

export interface ConversationSummary {
  conversationId: string;
  novelId: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  runCount: number;
  artifactCount: number;
}

export interface ConversationRuntimeSnapshot {
  conversation: ConversationSummary;
  turns: Array<{
    turnId: string;
    sequence: number;
    role: string;
    runId?: string;
    createdAt: string;
  }>;
  runs: Array<{
    runId: string;
    turnId: string;
    status: string;
    workerId: string;
    createdAt: string;
    updatedAt: string;
    startedAt?: string;
    finishedAt?: string;
    error?: string;
  }>;
  toolEvents: Array<{
    eventId: string;
    runId: string;
    sequence: number;
    toolName: string;
    status: string;
    durationMs?: number;
    createdAt: string;
    finishedAt?: string;
  }>;
  artifacts: Array<{
    cardId: string;
    artifactId?: string;
    artifactType: string;
    title: string;
    summary: string;
    status: string;
    createdAt: string;
  }>;
}

export interface ArtifactPublishResult {
  conversationId: string;
  cardId: string;
  artifactId?: string;
  artifactType: string;
  status: string;
}

export interface ArtifactReviewResult {
  decisionId: string;
  artifactId: string;
  authorizationId?: string;
  status: string;
}

export interface AdoptedDraftResult {
  authorizationId: string;
  draftId: string;
  chapterId: string;
  novelId: string;
  versionNo: number;
  isAdopted: true;
  contentHash: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function positiveNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function uniqueWarnings(...groups: Array<readonly string[] | undefined>): string[] {
  return [...new Set(groups.flatMap((group) => group ?? []))];
}
