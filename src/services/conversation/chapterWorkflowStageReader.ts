/**
 * Read-only reader for authoritative chapter workflow stage facts.
 *
 * The only accepted source is the desktop `list_chapter_workflow_stages`
 * command. Browser development has no SQLite stage fact source, so this module
 * returns an explicit `none` authority instead of calling Tauri or inventing a
 * localStorage equivalent. Every record is re-checked in TypeScript because the
 * projection is rendered directly and must never trust unvalidated IPC fields.
 */
import { dbCall, isTauri } from '../database/db';
import type {
  ChapterWorkflowStageKind,
  ChapterWorkflowStageStatus,
  ChapterWorkflowStageView,
} from '../../types/chapterWorkflowStage';

/** Hard upper bound for one read; the UI must not present a bounded page as full history. */
export const CHAPTER_WORKFLOW_STAGE_READ_LIMIT = 200;

const SHA256_HEX = /^[0-9a-f]{64}$/u;

const STAGE_KINDS: ReadonlySet<string> = new Set<ChapterWorkflowStageKind>([
  'scene_plan',
  'beat_plan',
  'beat_write',
  'beat_state',
  'scene_close',
  'chapter_assemble',
]);

const STAGE_STATUSES: ReadonlySet<string> = new Set<ChapterWorkflowStageStatus>([
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
]);

export type ChapterWorkflowStageReadErrorCode =
  'invalid_input' | 'invalid_response' | 'scope_mismatch';

export class ChapterWorkflowStageReadError extends Error {
  constructor(
    readonly code: ChapterWorkflowStageReadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ChapterWorkflowStageReadError';
  }
}

export interface ChapterWorkflowStageReadScope {
  readonly novelId: string;
  readonly chapterId: string;
  readonly conversationId?: string;
  readonly workflowId?: string;
  readonly runId?: string;
}

export interface ChapterWorkflowStageReadInput extends ChapterWorkflowStageReadScope {
  readonly limit?: number;
}

export interface ChapterWorkflowStageReadResult {
  /** `none` means no authoritative desktop source was read; it is never a fake SQLite fact. */
  readonly authority: 'sqlite' | 'none';
  readonly reason?: 'browser';
  readonly scope: ChapterWorkflowStageReadScope;
  readonly stages: readonly ChapterWorkflowStageView[];
  readonly limit: number;
  /** True when the returned rows reached the bounded read limit. */
  readonly truncated: boolean;
  readonly notice?: string;
}

function invalidInput(message: string): ChapterWorkflowStageReadError {
  return new ChapterWorkflowStageReadError('invalid_input', message);
}

function invalidResponse(message: string): ChapterWorkflowStageReadError {
  return new ChapterWorkflowStageReadError('invalid_response', message);
}

function scopeMismatch(message: string): ChapterWorkflowStageReadError {
  return new ChapterWorkflowStageReadError('scope_mismatch', message);
}

function requiredScopeId(value: unknown, label: string): string {
  if (typeof value !== 'string') throw invalidInput(`${label} 必须是必填标识`);
  const text = value.trim();
  if (!text) throw invalidInput(`${label} 必须是非空标识`);
  return text;
}

function optionalScopeId(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw invalidInput(`${label} 必须是标识字符串`);
  const text = value.trim();
  return text || undefined;
}

function normalizeScope(input: ChapterWorkflowStageReadInput): ChapterWorkflowStageReadScope {
  const novelId = requiredScopeId(input.novelId, 'novelId');
  const chapterId = requiredScopeId(input.chapterId, 'chapterId');
  const conversationId = optionalScopeId(input.conversationId, 'conversationId');
  const workflowId = optionalScopeId(input.workflowId, 'workflowId');
  const runId = optionalScopeId(input.runId, 'runId');
  return {
    novelId,
    chapterId,
    ...(conversationId ? { conversationId } : {}),
    ...(workflowId ? { workflowId } : {}),
    ...(runId ? { runId } : {}),
  };
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return CHAPTER_WORKFLOW_STAGE_READ_LIMIT;
  if (!Number.isInteger(value) || value < 1) {
    throw invalidInput('limit 必须是正整数');
  }
  return Math.min(value, CHAPTER_WORKFLOW_STAGE_READ_LIMIT);
}

function asRecord(value: unknown, index: number): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidResponse(`第 ${index + 1} 条阶段记录不是对象`);
  }
  return value as Record<string, unknown>;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  index: number,
  label = key,
): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw invalidResponse(`第 ${index + 1} 条阶段记录的 ${label} 必须是字符串`);
  }
  const text = value.trim();
  if (!text) {
    throw invalidResponse(`第 ${index + 1} 条阶段记录的 ${label} 必须是非空字符串`);
  }
  return text;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  index: number,
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw invalidResponse(`第 ${index + 1} 条阶段记录的 ${key} 必须是字符串或空值`);
  }
  const text = value.trim();
  return text || undefined;
}

function requiredHash(record: Record<string, unknown>, key: string, index: number): string {
  const value = requiredString(record, key, index);
  if (!SHA256_HEX.test(value)) {
    throw invalidResponse(`第 ${index + 1} 条阶段记录的 ${key} 必须是 64 位小写 SHA-256`);
  }
  return value;
}

function optionalHash(
  record: Record<string, unknown>,
  key: string,
  index: number,
): string | undefined {
  const value = optionalString(record, key, index);
  if (value !== undefined && !SHA256_HEX.test(value)) {
    throw invalidResponse(`第 ${index + 1} 条阶段记录的 ${key} 必须是 64 位小写 SHA-256`);
  }
  return value;
}

function positiveInteger(record: Record<string, unknown>, key: string, index: number): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw invalidResponse(`第 ${index + 1} 条阶段记录的 ${key} 必须是正整数`);
  }
  return value;
}

function isStageKind(value: string): value is ChapterWorkflowStageKind {
  return STAGE_KINDS.has(value);
}

function isStageStatus(value: string): value is ChapterWorkflowStageStatus {
  return STAGE_STATUSES.has(value);
}

function normalizeStage(
  raw: unknown,
  index: number,
  scope: ChapterWorkflowStageReadScope,
): ChapterWorkflowStageView {
  const record = asRecord(raw, index);
  const stageId = requiredString(record, 'stageId', index);
  const workflowId = requiredString(record, 'workflowId', index);
  const conversationId = requiredString(record, 'conversationId', index);
  const novelId = requiredString(record, 'novelId', index);
  const chapterId = requiredString(record, 'chapterId', index);
  const runId = requiredString(record, 'runId', index);
  const stageKey = requiredString(record, 'stageKey', index);
  const stageKind = requiredString(record, 'stageKind', index);
  const status = requiredString(record, 'status', index);
  if (!isStageKind(stageKind)) {
    throw invalidResponse(`第 ${index + 1} 条阶段记录的 stageKind 不受支持：${stageKind}`);
  }
  if (!isStageStatus(status)) {
    throw invalidResponse(`第 ${index + 1} 条阶段记录的 status 不受支持：${status}`);
  }
  if (novelId !== scope.novelId || chapterId !== scope.chapterId) {
    throw scopeMismatch('阶段记录的作品或章节与本轮查询作用域不一致');
  }
  if (scope.conversationId && conversationId !== scope.conversationId) {
    throw scopeMismatch('阶段记录的会话与本轮查询过滤不一致');
  }
  if (scope.workflowId && workflowId !== scope.workflowId) {
    throw scopeMismatch('阶段记录的工作流与本轮查询过滤不一致');
  }
  if (scope.runId && runId !== scope.runId) {
    throw scopeMismatch('阶段记录的运行与本轮查询过滤不一致');
  }

  const planVersion = positiveInteger(record, 'planVersion', index);
  const attempt = positiveInteger(record, 'attempt', index);
  const revision = positiveInteger(record, 'revision', index);
  const modelSnapshotHash = requiredHash(record, 'modelSnapshotHash', index);
  const contextHash = requiredHash(record, 'contextHash', index);
  const baseHash = requiredHash(record, 'baseHash', index);
  const inputHash = requiredHash(record, 'inputHash', index);
  const planHash = requiredHash(record, 'planHash', index);
  const resultHash = optionalHash(record, 'resultHash', index);
  if (status === 'succeeded' && !resultHash) {
    throw invalidResponse(`第 ${index + 1} 条成功阶段记录缺少 resultHash`);
  }
  const sceneId = optionalString(record, 'sceneId', index);
  const beatId = optionalString(record, 'beatId', index);
  const resultDocumentId = optionalString(record, 'resultDocumentId', index);
  const resultJson = optionalString(record, 'resultJson', index);
  const verifiedArtifactId = optionalString(record, 'verifiedArtifactId', index);
  const errorCode = optionalString(record, 'errorCode', index);
  const createdAt = requiredString(record, 'createdAt', index);
  const updatedAt = requiredString(record, 'updatedAt', index);

  return {
    stageId,
    workflowId,
    conversationId,
    novelId,
    chapterId,
    runId,
    stageKey,
    stageKind,
    ...(sceneId ? { sceneId } : {}),
    ...(beatId ? { beatId } : {}),
    planVersion,
    modelSnapshotHash,
    contextHash,
    baseHash,
    inputHash,
    planHash,
    status,
    attempt,
    revision,
    ...(resultHash ? { resultHash } : {}),
    ...(resultDocumentId ? { resultDocumentId } : {}),
    ...(resultJson ? { resultJson } : {}),
    ...(verifiedArtifactId ? { verifiedArtifactId } : {}),
    ...(errorCode ? { errorCode } : {}),
    createdAt,
    updatedAt,
  };
}

export function chapterWorkflowStageHistoryNotice(limit: number): string {
  return `已加载 ${limit} 条阶段记录，可能不是全部历史；更早或更多记录未显示，当前进度树不代表完整历史。`;
}

/**
 * Reads one bounded page of stage facts. `novelId` and `chapterId` are
 * required; conversation/workflow/run are optional narrowing filters that also
 * make every returned row scope-checked. Browser mode returns `none`.
 */
export async function readChapterWorkflowStages(
  input: ChapterWorkflowStageReadInput,
): Promise<ChapterWorkflowStageReadResult> {
  const scope = normalizeScope(input);
  const limit = normalizeLimit(input.limit);
  if (!isTauri()) {
    return {
      authority: 'none',
      reason: 'browser',
      scope,
      stages: [],
      limit,
      truncated: false,
    };
  }

  const raw = await dbCall<unknown[]>('list_chapter_workflow_stages', {
    input: { ...scope, limit },
  });
  if (!Array.isArray(raw)) {
    throw invalidResponse('list_chapter_workflow_stages 必须返回数组');
  }
  if (raw.length > limit) {
    throw invalidResponse('list_chapter_workflow_stages 返回条数超过本轮有界请求上限');
  }
  const stages = raw.map((record, index) => normalizeStage(record, index, scope));
  const truncated = stages.length >= limit;
  return {
    authority: 'sqlite',
    scope,
    stages,
    limit,
    truncated,
    ...(truncated ? { notice: chapterWorkflowStageHistoryNotice(limit) } : {}),
  };
}
