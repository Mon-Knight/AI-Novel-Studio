/**
 * Runtime safety primitives for applying or loading chapter documents.
 *
 * This module intentionally has no React or persistence dependency so every
 * workspace entry point can share the same target, revision and race checks.
 */

export type DocumentApplyMode = 'append' | 'replace_all';

export interface DocumentTarget {
  novelId: string;
  chapterId: string;
}

export type DocumentTargetLike = Partial<DocumentTarget> | null | undefined;

export interface DraftDocumentTarget {
  novelId?: string;
  chapterId?: string;
}

export interface DocumentApplyIdentity {
  resultId: string;
  target: DocumentTarget;
  baseContentHash: string;
  mode: DocumentApplyMode;
}

export interface LiveDocumentState extends DocumentTarget {
  contentHash: string;
}

export type DocumentSafetyFailureCode =
  | 'invalid_target'
  | 'invalid_result_id'
  | 'invalid_apply_mode'
  | 'missing_live_target'
  | 'novel_target_mismatch'
  | 'chapter_target_mismatch'
  | 'missing_draft_target'
  | 'draft_novel_mismatch'
  | 'draft_chapter_mismatch'
  | 'missing_base_content_hash'
  | 'missing_live_content_hash'
  | 'base_content_hash_conflict'
  | 'stale_load_token';

export interface DocumentSafetyPass {
  ok: true;
}

export interface DocumentSafetyFailure {
  ok: false;
  code: DocumentSafetyFailureCode;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

export type DocumentSafetyDecision = DocumentSafetyPass | DocumentSafetyFailure;

export interface DocumentLoadToken extends DocumentTarget {
  readonly epoch: number;
}

export type GuardedDocumentLoadResult<T> =
  | {
      accepted: true;
      token: DocumentLoadToken;
      value: T;
    }
  | {
      accepted: false;
      token: DocumentLoadToken;
      value: T;
      reason: DocumentSafetyFailure;
    };

export type DocumentApplyClaim = { accepted: true; key: string } | { accepted: false; key: string };

const PASS: DocumentSafetyPass = Object.freeze({ ok: true });

function fail(
  code: DocumentSafetyFailureCode,
  message: string,
  expected?: unknown,
  actual?: unknown,
): DocumentSafetyFailure {
  return { ok: false, code, message, expected, actual };
}

function normalizeRequired(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeTarget(target: DocumentTargetLike): DocumentTarget | null {
  const novelId = normalizeRequired(target?.novelId);
  const chapterId = normalizeRequired(target?.chapterId);
  return novelId && chapterId ? { novelId, chapterId } : null;
}

function requireTarget(target: DocumentTargetLike, label: string): DocumentTarget {
  const normalized = normalizeTarget(target);
  if (!normalized) {
    throw new TypeError(`${label} requires non-empty novelId and chapterId`);
  }
  return normalized;
}

/**
 * Confirms that an operation created for `expected` still points at the live
 * novel and chapter. Both dimensions are checked because chapter IDs alone
 * must not be trusted as a project boundary.
 */
export function validateLiveDocumentTarget(
  expected: DocumentTargetLike,
  live: DocumentTargetLike,
): DocumentSafetyDecision {
  const expectedTarget = normalizeTarget(expected);
  if (!expectedTarget) {
    return fail('invalid_target', '操作目标缺少作品或章节标识。', expected, live);
  }

  const liveTarget = normalizeTarget(live);
  if (!liveTarget) {
    return fail(
      'missing_live_target',
      '当前工作台没有完整的作品和章节目标。',
      expectedTarget,
      live,
    );
  }

  if (expectedTarget.novelId !== liveTarget.novelId) {
    return fail(
      'novel_target_mismatch',
      '结果所属作品与当前工作台作品不一致。',
      expectedTarget.novelId,
      liveTarget.novelId,
    );
  }

  if (expectedTarget.chapterId !== liveTarget.chapterId) {
    return fail(
      'chapter_target_mismatch',
      '结果所属章节与当前工作台章节不一致。',
      expectedTarget.chapterId,
      liveTarget.chapterId,
    );
  }

  return PASS;
}

/** Confirms that a returned draft belongs to the expected chapter. */
export function validateDraftChapter(
  draft: Pick<DraftDocumentTarget, 'chapterId'> | null | undefined,
  expectedChapterId: string,
): DocumentSafetyDecision {
  const expected = normalizeRequired(expectedChapterId);
  if (!expected) {
    return fail(
      'invalid_target',
      '草稿校验缺少目标章节标识。',
      expectedChapterId,
      draft?.chapterId,
    );
  }

  const actual = normalizeRequired(draft?.chapterId);
  if (!actual) {
    return fail('missing_draft_target', '草稿没有可验证的章节标识。', expected, draft?.chapterId);
  }

  if (actual !== expected) {
    return fail('draft_chapter_mismatch', '草稿不属于目标章节。', expected, actual);
  }

  return PASS;
}

/**
 * Stronger draft check for callers that have both project and chapter IDs.
 */
export function validateDraftDocumentTarget(
  draft: DraftDocumentTarget | null | undefined,
  expected: DocumentTargetLike,
): DocumentSafetyDecision {
  const expectedTarget = normalizeTarget(expected);
  if (!expectedTarget) {
    return fail('invalid_target', '草稿校验缺少完整目标。', expected, draft);
  }

  const draftNovelId = normalizeRequired(draft?.novelId);
  const draftChapterId = normalizeRequired(draft?.chapterId);
  if (!draftNovelId || !draftChapterId) {
    return fail('missing_draft_target', '草稿没有可验证的作品或章节标识。', expectedTarget, draft);
  }

  if (draftNovelId !== expectedTarget.novelId) {
    return fail(
      'draft_novel_mismatch',
      '草稿不属于目标作品。',
      expectedTarget.novelId,
      draftNovelId,
    );
  }

  if (draftChapterId !== expectedTarget.chapterId) {
    return fail(
      'draft_chapter_mismatch',
      '草稿不属于目标章节。',
      expectedTarget.chapterId,
      draftChapterId,
    );
  }

  return PASS;
}

/**
 * Rejects an AI result when the editor has moved away from the content hash
 * used to produce that result.
 */
export function validateBaseContentHash(
  baseContentHash: string | null | undefined,
  liveContentHash: string | null | undefined,
): DocumentSafetyDecision {
  const baseHash = normalizeRequired(baseContentHash);
  if (!baseHash) {
    return fail(
      'missing_base_content_hash',
      'AI 结果缺少生成时正文哈希，无法安全应用。',
      baseContentHash,
      liveContentHash,
    );
  }

  const currentHash = normalizeRequired(liveContentHash);
  if (!currentHash) {
    return fail(
      'missing_live_content_hash',
      '当前正文缺少内容哈希，无法检查版本冲突。',
      baseHash,
      liveContentHash,
    );
  }

  if (baseHash !== currentHash) {
    return fail(
      'base_content_hash_conflict',
      '当前正文已在 AI 任务开始后发生变化。',
      baseHash,
      currentHash,
    );
  }

  return PASS;
}

/** Runs the target and base-revision checks required before applying text. */
export function validateDocumentApplication(
  identity: DocumentApplyIdentity,
  live: LiveDocumentState | null | undefined,
): DocumentSafetyDecision {
  if (!normalizeRequired(identity.resultId)) {
    return fail('invalid_result_id', 'AI 结果缺少稳定 resultId，无法防止重复应用。');
  }
  if (identity.mode !== 'append' && identity.mode !== 'replace_all') {
    return fail(
      'invalid_apply_mode',
      '正文应用模式不受支持。',
      ['append', 'replace_all'],
      identity.mode,
    );
  }
  const targetDecision = validateLiveDocumentTarget(identity.target, live);
  if (!targetDecision.ok) return targetDecision;
  return validateBaseContentHash(identity.baseContentHash, live?.contentHash);
}

/**
 * Builds a collision-safe, deterministic key for one result/application tuple.
 * JSON tuple encoding prevents delimiter collisions between adjacent fields.
 */
export function createDocumentApplyIdempotencyKey(identity: DocumentApplyIdentity): string {
  const resultId = normalizeRequired(identity.resultId);
  if (!resultId) throw new TypeError('Document apply identity requires a non-empty resultId');
  const target = requireTarget(identity.target, 'Document apply identity');
  const baseContentHash = normalizeRequired(identity.baseContentHash);
  if (!baseContentHash) {
    throw new TypeError('Document apply identity requires a non-empty baseContentHash');
  }
  if (identity.mode !== 'append' && identity.mode !== 'replace_all') {
    throw new TypeError(`Unsupported document apply mode: ${String(identity.mode)}`);
  }

  return `document-apply:v1:${JSON.stringify([
    resultId,
    target.novelId,
    target.chapterId,
    baseContentHash,
    identity.mode,
  ])}`;
}

/**
 * In-memory claim registry for the current workspace session. Claim before
 * mutating editor state; release the claim if the mutation itself fails.
 */
export class DocumentApplyIdempotencyGuard {
  private readonly claimedKeys = new Set<string>();

  get size(): number {
    return this.claimedKeys.size;
  }

  claim(identity: DocumentApplyIdentity): DocumentApplyClaim {
    const key = createDocumentApplyIdempotencyKey(identity);
    if (this.claimedKeys.has(key)) return { accepted: false, key };
    this.claimedKeys.add(key);
    return { accepted: true, key };
  }

  has(identity: DocumentApplyIdentity): boolean {
    return this.claimedKeys.has(createDocumentApplyIdempotencyKey(identity));
  }

  release(identityOrKey: DocumentApplyIdentity | string): boolean {
    const key =
      typeof identityOrKey === 'string'
        ? identityOrKey
        : createDocumentApplyIdempotencyKey(identityOrKey);
    return this.claimedKeys.delete(key);
  }

  clear(): void {
    this.claimedKeys.clear();
  }
}

/**
 * Issues monotonic load tokens and decides whether an asynchronous result may
 * still commit. A later request permanently invalidates every earlier token,
 * even if the user later returns to the earlier chapter.
 */
export class MonotonicDocumentLoadGuard {
  private epoch = 0;

  get currentEpoch(): number {
    return this.epoch;
  }

  issue(target: DocumentTarget): DocumentLoadToken {
    const normalized = requireTarget(target, 'Document load target');
    this.epoch += 1;
    return Object.freeze({ ...normalized, epoch: this.epoch });
  }

  invalidate(): number {
    this.epoch += 1;
    return this.epoch;
  }

  validateCommit(token: DocumentLoadToken, live: DocumentTargetLike): DocumentSafetyDecision {
    if (token.epoch !== this.epoch) {
      return fail(
        'stale_load_token',
        '已有更新的正文加载请求，本次迟到结果已丢弃。',
        this.epoch,
        token.epoch,
      );
    }
    return validateLiveDocumentTarget(token, live);
  }
}

/**
 * Awaits a load and evaluates commit safety at resolution time using the live
 * target getter, avoiding stale closure checks.
 */
export async function resolveGuardedDocumentLoad<T>(
  guard: MonotonicDocumentLoadGuard,
  token: DocumentLoadToken,
  pending: Promise<T>,
  getLiveTarget: () => DocumentTargetLike,
): Promise<GuardedDocumentLoadResult<T>> {
  const value = await pending;
  const decision = guard.validateCommit(token, getLiveTarget());
  if (decision.ok) return { accepted: true, token, value };
  return { accepted: false, token, value, reason: decision };
}
