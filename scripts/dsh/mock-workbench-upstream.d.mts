/**
 * Type surface of the loopback mock upstream for TypeScript carriers
 * (tests/real-acceptance). Keep in sync with mock-workbench-upstream.mjs.
 */
export type MockWorkbenchMode =
  | 'normal'
  | 'text-only'
  | 'delayed-text'
  | 'tool-error'
  | 'delay'
  | 'cancel'
  | 'attestation-fail'
  | 'attestation-delay'
  | 'forbidden-tool'
  | 'cross-novel'
  | 'upstream-error-once'
  | 'upstream-error'
  | 'hold-generate';

export interface MockWorkbenchOptions {
  mode?: MockWorkbenchMode;
  port?: number;
  novelId?: string;
  chapterId?: string;
  foreignNovelId?: string;
  foreignChapterId?: string;
  candidateText?: string;
  delayMs?: number;
}

export interface MockWorkbenchResolvedOptions {
  mode: MockWorkbenchMode;
  port: number;
  novelId: string;
  chapterId: string;
  foreignNovelId: string;
  foreignChapterId: string;
  candidateText: string;
  delayMs: number;
}

export interface MockWorkbenchRequestSummary {
  sequence: number;
  requestId: string;
  path: string;
  mode: MockWorkbenchMode;
  phase: string;
  model: string;
  outcome: string;
  advertisedToolNames: string[];
  requestedToolNames: string[];
  /** Whether the newest user message carried the host's "用户重试" notice (GAP-19). */
  userRetryNotice: boolean;
  chunksSent: number;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

export interface MockWorkbenchSnapshot {
  mode: MockWorkbenchMode;
  requestCount: number;
  activeRequests: number;
  peakActiveRequests: number;
  injectedUpstreamFailures: number;
  requests: MockWorkbenchRequestSummary[];
}

export interface MockWorkbenchUpstream {
  readonly host: string;
  readonly port: number;
  readonly mode: MockWorkbenchMode;
  readonly baseUrl: string;
  readonly upstreamBaseUrl: string;
  readonly chatCompletionsUrl: string;
  readonly healthUrl: string;
  readonly requestsUrl: string;
  configure(overrides?: MockWorkbenchOptions): MockWorkbenchResolvedOptions;
  snapshot(): MockWorkbenchSnapshot;
  close(): Promise<void>;
}

export function canonicalToolName(value: unknown): string | undefined;
export function startMockWorkbenchUpstream(
  options?: MockWorkbenchOptions,
): Promise<MockWorkbenchUpstream>;
