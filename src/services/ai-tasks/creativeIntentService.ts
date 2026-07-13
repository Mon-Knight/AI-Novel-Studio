import type {
  AuthorConfirmationV1,
  CreativeIntentRecordV1,
  CreativeIntentSnapshotV1,
  CreativeIntentStatementInputV1,
  FreezeCreativeIntentCommandInput,
} from '../../types/creativeIntent';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { dbCall, generateId, isTauri, lsSet, nowISO } from '../database/db';
import {
  freezeCreativeIntent as buildFrozenIntent,
  stableCanonicalStringify,
  validateCreativeIntentSnapshot,
} from './stage3PrerequisiteService';

interface BrowserStoredCreativeIntent extends CreativeIntentRecordV1 {
  operationId: string;
  requestHash: string;
}

const STORAGE_PREFIX = 'ai_novel_studio_creative_intents_v1_';
const browserFreezeTails = new Map<string, Promise<unknown>>();

interface BrowserLockManager {
  request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
}

function storageKey(novelId: string): string {
  return `${STORAGE_PREFIX}${novelId}`;
}

function appError(code: string, message: string, details?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { code, details });
}

function textContainsSecret(value: string): boolean {
  return /(?:api[_ -]?key\s*[:=]|apikey\s*[:=]|authorization\s*[:=]|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,})/i.test(value);
}

function containsSecret(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecret);
  if (typeof value === 'string') return textContainsSecret(value);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => (
    ['apikey', 'api_key', 'authorization', 'secret'].includes(key.toLowerCase())
    || containsSecret(child)
  ));
}

function contentIsEmpty(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length === 0;
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

function normalizeInput(input: FreezeCreativeIntentCommandInput): FreezeCreativeIntentCommandInput {
  return {
    ...input,
    novelId: input.novelId.trim(),
    expectedContentHash: input.expectedContentHash?.trim() || undefined,
    statements: input.statements.map((statement) => ({
      ...statement,
      statementId: statement.statementId.trim(),
    })),
  };
}

function validateInput(input: FreezeCreativeIntentCommandInput): void {
  if (!input.novelId || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0
      || input.statements.length === 0) {
    throw appError('OPERATION_PAYLOAD_CONFLICT', '创作意图冻结请求无效');
  }
  if ((input.expectedRevision === 0 && input.expectedContentHash)
      || (input.expectedRevision > 0 && !input.expectedContentHash)) {
    throw appError('OPERATION_PAYLOAD_CONFLICT', '创作意图冻结基线无效');
  }
  const statementIds = new Set<string>();
  for (const statement of input.statements) {
    if (!statement.statementId || statementIds.has(statement.statementId)) {
      throw appError('OPERATION_PAYLOAD_CONFLICT', '创作意图陈述 ID 不能为空或重复');
    }
    statementIds.add(statement.statementId);
    if (!['goal', 'preference', 'fact', 'constraint'].includes(statement.kind)
        || !['author_explicit', 'inferred_preference', 'requires_confirmation']
          .includes(statement.knowledgeClass)
        || !['pending', 'confirmed', 'rejected'].includes(statement.confirmation.status)) {
      throw appError('OPERATION_PAYLOAD_CONFLICT', '创作意图陈述协议无效');
    }
    if (contentIsEmpty(statement.value)) {
      throw appError('OPERATION_PAYLOAD_CONFLICT', '创作意图内容不能为空');
    }
    if (!Number.isFinite(statement.confidence)
        || statement.confidence < 0 || statement.confidence > 1) {
      throw appError('OPERATION_PAYLOAD_CONFLICT', '创作意图 confidence 必须位于 0 到 1');
    }
    if (statement.knowledgeClass === 'author_explicit'
        && statement.confirmation.status !== 'confirmed') {
      throw appError('OPERATION_PAYLOAD_CONFLICT', '作者明确输入必须逐项确认后才能冻结');
    }
    if (statement.knowledgeClass !== 'author_explicit' && statement.evidence.length === 0) {
      throw appError('OPERATION_PAYLOAD_CONFLICT', '推断偏好和待确认信息必须提供证据');
    }
    const evidenceIds = new Set<string>();
    for (const evidence of statement.evidence) {
      if (!evidence.evidenceId.trim() || evidenceIds.has(evidence.evidenceId.trim())) {
        throw appError('OPERATION_PAYLOAD_CONFLICT', '证据 ID 不能为空或重复');
      }
      evidenceIds.add(evidence.evidenceId.trim());
      if (!['author_input', 'project_document', 'canon', 'ai_inference']
        .includes(evidence.sourceType)) {
        throw appError('OPERATION_PAYLOAD_CONFLICT', '证据来源类型无效');
      }
    }
  }
  if (containsSecret(input)) {
    throw appError('OPERATION_PAYLOAD_CONFLICT', '创作意图 Snapshot 禁止包含 API Key 或授权信息');
  }
}

async function requestHash(input: FreezeCreativeIntentCommandInput): Promise<string> {
  const serializable = JSON.parse(JSON.stringify({
    contract: 'creative_intent_freeze_v1',
    novelId: input.novelId,
    expectedRevision: input.expectedRevision,
    expectedContentHash: input.expectedContentHash ?? null,
    statements: input.statements,
  }));
  return computeContentSha256(stableCanonicalStringify(serializable));
}

function readBrowserRecords(novelId: string): BrowserStoredCreativeIntent[] {
  const key = storageKey(novelId);
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    throw appError('DATABASE_TRANSACTION_FAILED', '无法读取浏览器创作意图存储');
  }
  if (raw === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw appError('ARTIFACT_VALIDATION_FAILED', '浏览器创作意图历史已损坏，已停止覆盖');
  }
  if (!Array.isArray(parsed) || parsed.some((item) => (
    !item || typeof item !== 'object'
    || typeof (item as BrowserStoredCreativeIntent).taskId !== 'string'
    || typeof (item as BrowserStoredCreativeIntent).operationId !== 'string'
    || typeof (item as BrowserStoredCreativeIntent).requestHash !== 'string'
    || !(item as BrowserStoredCreativeIntent).intent
  ))) {
    throw appError('ARTIFACT_VALIDATION_FAILED', '浏览器创作意图历史结构无效，已停止覆盖');
  }
  return parsed as BrowserStoredCreativeIntent[];
}

async function validateBrowserHistory(
  records: BrowserStoredCreativeIntent[],
  novelId: string,
): Promise<BrowserStoredCreativeIntent[]> {
  const sorted = records.slice().sort((left, right) => left.intent.revision - right.intent.revision);
  const operations = new Set<string>();
  for (const [index, record] of sorted.entries()) {
    await validateCreativeIntentSnapshot(record.intent, novelId);
    const expectedRevision = index + 1;
    const expectedOperation = `creative-intent:${novelId}:revision:${expectedRevision}`;
    const expectedParent = index === 0 ? undefined : sorted[index - 1].intent.intentId;
    if (record.intent.revision !== expectedRevision
        || record.operationId !== expectedOperation
        || record.intent.parentIntentId !== expectedParent
        || !/^[a-f0-9]{64}$/.test(record.requestHash)
        || operations.has(record.operationId)) {
      throw appError('ARTIFACT_VALIDATION_FAILED', '浏览器创作意图版本链无效，已停止覆盖');
    }
    operations.add(record.operationId);
  }
  return sorted;
}

async function getLatestBrowser(novelId: string): Promise<CreativeIntentRecordV1 | null> {
  const records = await validateBrowserHistory(readBrowserRecords(novelId), novelId);
  const latest = records[records.length - 1];
  if (!latest) return null;
  return { taskId: latest.taskId, intent: latest.intent, idempotentReplay: false };
}

function enqueueBrowserFreeze<T>(novelId: string, action: () => Promise<T>): Promise<T> {
  const previous = browserFreezeTails.get(novelId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(action);
  browserFreezeTails.set(novelId, current);
  return current.finally(() => {
    if (browserFreezeTails.get(novelId) === current) browserFreezeTails.delete(novelId);
  });
}

function withBrowserFreezeLock<T>(novelId: string, action: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator & { locks?: BrowserLockManager } | undefined)?.locks;
  if (locks) {
    return locks.request(`ai-novel-studio:creative-intent:${novelId}`, action) as Promise<T>;
  }
  return enqueueBrowserFreeze(novelId, action);
}

async function freezeBrowser(
  rawInput: FreezeCreativeIntentCommandInput,
): Promise<CreativeIntentRecordV1> {
  const input = normalizeInput(rawInput);
  validateInput(input);
  const targetRevision = input.expectedRevision + 1;
  const operationId = `creative-intent:${input.novelId}:revision:${targetRevision}`;
  const hash = await requestHash(input);
  const records = await validateBrowserHistory(readBrowserRecords(input.novelId), input.novelId);
  const replay = records.find((record) => record.operationId === operationId);
  if (replay) {
    if (replay.requestHash !== hash) {
      throw appError('OPERATION_PAYLOAD_CONFLICT', '同一创作意图 revision 对应不同内容');
    }
    return { taskId: replay.taskId, intent: replay.intent, idempotentReplay: true };
  }
  const latest = records[records.length - 1];
  const actualRevision = latest?.intent.revision ?? 0;
  const actualHash = latest?.intent.contentHash;
  if (actualRevision !== input.expectedRevision
      || (input.expectedRevision > 0 && actualHash !== input.expectedContentHash)
      || (input.expectedRevision === 0 && input.expectedContentHash)) {
    throw appError('DOCUMENT_VERSION_CONFLICT', '创作意图已在其他窗口更新，请重新读取', {
      expectedRevision: input.expectedRevision,
      expectedContentHash: input.expectedContentHash,
      actualRevision,
      actualContentHash: actualHash,
    });
  }
  const confirmedAt = nowISO();
  const confirmation = (status: CreativeIntentStatementInputV1['confirmation']['status']): AuthorConfirmationV1 => (
    status === 'pending'
      ? { status }
      : { status, confirmedBy: 'author', confirmedAt }
  );
  const intent = await buildFrozenIntent({
    novelId: input.novelId,
    revision: targetRevision,
    parentIntentId: latest?.intent.intentId,
    createdAt: confirmedAt,
    statements: input.statements.map((statement) => ({
      ...statement,
      confirmation: confirmation(statement.confirmation.status),
    })),
  });
  await validateCreativeIntentSnapshot(intent, input.novelId);
  const stored: BrowserStoredCreativeIntent = {
    taskId: generateId(),
    intent,
    idempotentReplay: false,
    operationId,
    requestHash: hash,
  };
  lsSet(storageKey(input.novelId), [...records, stored]);
  const persistedRecords = await validateBrowserHistory(
    readBrowserRecords(input.novelId),
    input.novelId,
  );
  const persisted = persistedRecords
    .find((item) => item.operationId === operationId && item.requestHash === hash);
  if (!persisted) {
    throw appError('DATABASE_TRANSACTION_FAILED', '浏览器存储空间不足，创作意图未保存');
  }
  return { taskId: stored.taskId, intent, idempotentReplay: false };
}

export function creativeIntentErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const raw = (error as { rawError?: unknown }).rawError;
  return raw && typeof raw === 'object' && typeof (raw as { code?: unknown }).code === 'string'
    ? (raw as { code: string }).code
    : undefined;
}

function creativeIntentErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const direct = (error as { message?: unknown }).message;
  if (typeof direct === 'string') return direct;
  const raw = (error as { rawError?: unknown }).rawError;
  if (raw && typeof raw === 'object' && typeof (raw as { message?: unknown }).message === 'string') {
    return (raw as { message: string }).message;
  }
  return '';
}

export function isCreativeIntentConcurrencyConflict(error: unknown): boolean {
  const code = creativeIntentErrorCode(error);
  return code === 'DOCUMENT_VERSION_CONFLICT'
    || (code === 'OPERATION_PAYLOAD_CONFLICT'
      && creativeIntentErrorMessage(error).includes('同一创作意图 revision 对应不同内容'));
}

export function snapshotToCreativeIntentInput(
  snapshot: CreativeIntentSnapshotV1,
): CreativeIntentStatementInputV1[] {
  return snapshot.statements.map((statement) => ({
    statementId: statement.statementId,
    kind: statement.kind,
    knowledgeClass: statement.knowledgeClass,
    value: statement.value,
    confidence: statement.confidence,
    evidence: statement.evidence,
    confirmation: { status: statement.confirmation.status },
  }));
}

export function createAuthorStatement(): CreativeIntentStatementInputV1 {
  return {
    statementId: generateId(),
    kind: 'goal',
    knowledgeClass: 'author_explicit',
    value: '',
    confidence: 1,
    evidence: [],
    confirmation: { status: 'pending' },
  };
}

export const creativeIntentService = {
  async getLatest(novelId: string): Promise<CreativeIntentRecordV1 | null> {
    const normalizedNovelId = novelId.trim();
    if (!normalizedNovelId) throw appError('OPERATION_PAYLOAD_CONFLICT', '作品 ID 不能为空');
    if (!isTauri()) return getLatestBrowser(normalizedNovelId);
    return dbCall<CreativeIntentRecordV1 | null>('get_latest_creative_intent', {
      novelId: normalizedNovelId,
    });
  },

  async freeze(input: FreezeCreativeIntentCommandInput): Promise<CreativeIntentRecordV1> {
    const normalized = normalizeInput(input);
    validateInput(normalized);
    if (!isTauri()) {
      return withBrowserFreezeLock(normalized.novelId, () => freezeBrowser(normalized));
    }
    return dbCall<CreativeIntentRecordV1>('freeze_creative_intent', { input: normalized });
  },
};
