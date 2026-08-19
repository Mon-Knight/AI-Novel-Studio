import type { AiGenerateRequest, AiGenerateResponse, AiSettings } from '../../types/ai';
import { normalizeAppError } from '../../types/appError';
import { isTauriRuntime, tauriInvoke } from '../tauri/runtime';
import { calculateAiUsageCost, createAiPricingSnapshot } from './aiCost';

const LEDGER_KEY = 'ai_novel_studio_ai_request_ledger_v1';
const MINUTE_MS = 60_000;
const RESERVATION_TTL_MS = 30 * 60_000;

interface RequestReservation {
  id: string;
  startedAt: number;
  expiresAt: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTokens: number;
  estimatedCostUsd?: number;
}

interface RequestLedger {
  schemaVersion: 1;
  day: string;
  requestStartedAt: number[];
  tokenInput: number;
  tokenOutput: number;
  costUsd: number;
  usageMissingCount: number;
  unpricedRequestCount: number;
  failedRequestCount: number;
  expiredRequestCount: number;
  reservations: RequestReservation[];
}

export interface AiRequestBudgetSnapshot {
  policy?: AiRequestPolicySnapshot;
  day: string;
  requestsLastMinute: number;
  activeRequests: number;
  tokenUsed: number;
  reservedTokens: number;
  costUsedUsd: number;
  reservedCostUsd: number;
  usageMissingCount: number;
  unpricedRequestCount?: number;
  failedRequestCount?: number;
  expiredRequestCount?: number;
  tokenBudget?: number;
  costBudgetUsd?: number;
  warningPercent: number;
  warning: boolean;
}

export interface AiRequestPolicyLease {
  id: string;
  estimatedTokens: number;
  estimatedCostUsd?: number;
  storage?: 'browser' | 'sqlite';
  ownerId?: string;
  providerRequestId?: string;
  leaseToken?: string;
  expiresAtMs?: number;
  policyRevision?: number;
  inputPricePerMillionTokens?: number;
  outputPricePerMillionTokens?: number;
}

export interface AiRequestPolicySnapshot {
  revision: number;
  policyHash: string;
  maxRequestsPerMinute: number;
  maxConcurrentRequests: number;
  dailyTokenBudget?: number;
  dailyCostBudgetUsd?: number;
  inputPricePerMillionTokens?: number;
  outputPricePerMillionTokens?: number;
  warningPercent: number;
}

type AiRequestPolicyErrorCode =
  | 'AI_RATE_LIMIT_EXCEEDED'
  | 'AI_CONCURRENCY_LIMIT_EXCEEDED'
  | 'AI_DAILY_TOKEN_BUDGET_EXCEEDED'
  | 'AI_DAILY_COST_BUDGET_EXCEEDED'
  | 'AI_BUDGET_PRICING_REQUIRED'
  | 'AI_REQUEST_POLICY_INPUT_INVALID'
  | 'AI_REQUEST_POLICY_CONFIG_CONFLICT'
  | 'AI_REQUEST_POLICY_LEASE_NOT_FOUND'
  | 'AI_REQUEST_POLICY_LEASE_CONFLICT'
  | 'AI_REQUEST_POLICY_LEASE_REQUIRED';

export class AiRequestPolicyError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly code: AiRequestPolicyErrorCode,
    message: string,
    retryable = false,
  ) {
    super(message);
    this.name = 'AiRequestPolicyError';
    this.retryable = retryable;
  }
}

let memoryLedger: RequestLedger | undefined;

function dayKey(now: number): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

function emptyLedger(now: number): RequestLedger {
  return {
    schemaVersion: 1,
    day: dayKey(now),
    requestStartedAt: [],
    tokenInput: 0,
    tokenOutput: 0,
    costUsd: 0,
    usageMissingCount: 0,
    unpricedRequestCount: 0,
    failedRequestCount: 0,
    expiredRequestCount: 0,
    reservations: [],
  };
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizeLedger(value: unknown, now: number): RequestLedger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyLedger(now);
  const source = value as Partial<RequestLedger>;
  if (source.schemaVersion !== 1) return emptyLedger(now);
  const sameDay = source.day === dayKey(now);
  const reservations: RequestReservation[] = [];
  let expiredInputTokens = 0;
  let expiredOutputTokens = 0;
  let expiredCostUsd = 0;
  let newlyExpiredCount = 0;
  let newlyExpiredUnpricedCount = 0;
  for (const raw of Array.isArray(source.reservations) ? source.reservations : []) {
    if (
      !raw ||
      typeof raw.id !== 'string' ||
      typeof raw.startedAt !== 'number' ||
      typeof raw.expiresAt !== 'number'
    ) {
      continue;
    }
    const estimatedTokens = finiteNonNegative(raw.estimatedTokens);
    if (estimatedTokens <= 0) continue;
    const estimatedInputTokens = finiteNonNegative(raw.estimatedInputTokens);
    const storedOutputTokens = finiteNonNegative(raw.estimatedOutputTokens);
    const estimatedOutputTokens =
      estimatedInputTokens + storedOutputTokens > 0
        ? storedOutputTokens
        : Math.max(0, estimatedTokens - estimatedInputTokens);
    const reservation: RequestReservation = {
      id: raw.id,
      startedAt: raw.startedAt,
      expiresAt: raw.expiresAt,
      estimatedInputTokens,
      estimatedOutputTokens:
        estimatedInputTokens + estimatedOutputTokens > 0 ? estimatedOutputTokens : estimatedTokens,
      estimatedTokens,
      estimatedCostUsd:
        typeof raw.estimatedCostUsd === 'number' &&
        Number.isFinite(raw.estimatedCostUsd) &&
        raw.estimatedCostUsd >= 0
          ? raw.estimatedCostUsd
          : undefined,
    };
    if (reservation.expiresAt > now) {
      reservations.push(reservation);
      continue;
    }
    newlyExpiredCount += 1;
    expiredInputTokens += reservation.estimatedInputTokens;
    expiredOutputTokens += reservation.estimatedOutputTokens;
    if (reservation.estimatedCostUsd === undefined) newlyExpiredUnpricedCount += 1;
    else expiredCostUsd += reservation.estimatedCostUsd;
  }
  return {
    schemaVersion: 1,
    day: dayKey(now),
    requestStartedAt: Array.isArray(source.requestStartedAt)
      ? source.requestStartedAt.filter((item) => typeof item === 'number' && item > now - MINUTE_MS)
      : [],
    tokenInput: (sameDay ? finiteNonNegative(source.tokenInput) : 0) + expiredInputTokens,
    tokenOutput: (sameDay ? finiteNonNegative(source.tokenOutput) : 0) + expiredOutputTokens,
    costUsd: (sameDay ? finiteNonNegative(source.costUsd) : 0) + expiredCostUsd,
    usageMissingCount:
      (sameDay ? finiteNonNegative(source.usageMissingCount) : 0) + newlyExpiredCount,
    unpricedRequestCount:
      (sameDay ? finiteNonNegative(source.unpricedRequestCount) : 0) + newlyExpiredUnpricedCount,
    failedRequestCount: sameDay ? finiteNonNegative(source.failedRequestCount) : 0,
    expiredRequestCount:
      (sameDay ? finiteNonNegative(source.expiredRequestCount) : 0) + newlyExpiredCount,
    reservations,
  };
}

function readLedger(now: number): RequestLedger {
  let parsed: unknown = memoryLedger;
  if (parsed === undefined) {
    try {
      const stored = globalThis.localStorage?.getItem(LEDGER_KEY);
      if (stored) parsed = JSON.parse(stored);
    } catch {
      // The in-memory ledger continues to enforce limits for this process.
    }
  }
  const normalized = normalizeLedger(parsed, now);
  writeLedger(normalized);
  return normalized;
}

function writeLedger(ledger: RequestLedger): void {
  memoryLedger = ledger;
  try {
    globalThis.localStorage?.setItem(LEDGER_KEY, JSON.stringify(ledger));
  } catch {
    // In-memory enforcement remains active.
  }
}

function requestEstimate(request: AiGenerateRequest, settings: AiSettings) {
  const encoder = new TextEncoder();
  let utf8Bytes = 0;
  for (const message of request.messages) {
    utf8Bytes += encoder.encode(message.role).byteLength;
    utf8Bytes += encoder.encode(message.content).byteLength;
  }
  // Byte-level tokenizers cannot emit more content tokens than UTF-8 bytes. The fixed and
  // per-message envelopes conservatively cover roles, separators and provider chat templates.
  const estimatedInputTokens = Math.max(1, utf8Bytes + request.messages.length * 64 + 256);
  const estimatedOutputTokens = Math.max(1, request.maxTokens ?? settings.maxTokens ?? 8_000);
  const estimatedTokens = estimatedInputTokens + estimatedOutputTokens;
  const pricing = createAiPricingSnapshot(settings);
  const cost = calculateAiUsageCost(pricing, estimatedInputTokens, estimatedOutputTokens);
  return {
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedTokens,
    estimatedCostUsd: cost.status === 'complete' ? cost.estimatedCost : undefined,
  };
}

function uuid(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`
  );
}

function totals(ledger: RequestLedger) {
  return ledger.reservations.reduce(
    (sum, item) => ({
      tokens: sum.tokens + item.estimatedTokens,
      cost: sum.cost + (item.estimatedCostUsd ?? 0),
    }),
    { tokens: 0, cost: 0 },
  );
}

function requirePricingForCostBudget(settings: AiSettings): void {
  if (settings.dailyCostBudgetUsd === undefined) return;
  const pricing = createAiPricingSnapshot(settings);
  if (pricing.source !== 'user_configured') {
    throw new AiRequestPolicyError(
      'AI_BUDGET_PRICING_REQUIRED',
      '启用每日成本预算前必须配置输入与输出单价。',
    );
  }
}

interface DesktopLeaseGrant {
  reservationId: string;
  ownerId: string;
  providerRequestId: string;
  leaseToken: string;
  expiresAtMs: number;
  policyRevision: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedTokens: number;
  estimatedCostUsd?: number;
  inputPricePerMillionTokens?: number;
  outputPricePerMillionTokens?: number;
}

interface DesktopPolicySettlement {
  reservationId: string;
  status: 'settled' | 'failed' | 'expired';
  replayed: boolean;
}

const POLICY_ERROR_CODES = new Set<AiRequestPolicyErrorCode>([
  'AI_RATE_LIMIT_EXCEEDED',
  'AI_CONCURRENCY_LIMIT_EXCEEDED',
  'AI_DAILY_TOKEN_BUDGET_EXCEEDED',
  'AI_DAILY_COST_BUDGET_EXCEEDED',
  'AI_BUDGET_PRICING_REQUIRED',
  'AI_REQUEST_POLICY_INPUT_INVALID',
  'AI_REQUEST_POLICY_CONFIG_CONFLICT',
  'AI_REQUEST_POLICY_LEASE_NOT_FOUND',
  'AI_REQUEST_POLICY_LEASE_CONFLICT',
  'AI_REQUEST_POLICY_LEASE_REQUIRED',
]);

let desktopOwnerId: string | undefined;
let observedDesktopPolicyRevision: number | undefined;
let desktopPolicyObservationCaptured = false;

function getDesktopOwnerId(): string {
  desktopOwnerId ??= `webview-${uuid()}`;
  return desktopOwnerId;
}

function pricingPair(settings: AiSettings): {
  inputPricePerMillionTokens?: number;
  outputPricePerMillionTokens?: number;
} {
  const pricing = createAiPricingSnapshot(settings);
  return pricing.source === 'user_configured'
    ? {
        inputPricePerMillionTokens: pricing.inputPricePerMillionTokens,
        outputPricePerMillionTokens: pricing.outputPricePerMillionTokens,
      }
    : {};
}

function desktopPolicyInput(settings: AiSettings) {
  return {
    maxRequestsPerMinute: settings.maxRequestsPerMinute ?? 12,
    maxConcurrentRequests: settings.maxConcurrentAiRequests ?? 2,
    dailyTokenBudget: settings.dailyTokenBudget,
    dailyCostBudgetUsd: settings.dailyCostBudgetUsd,
    ...pricingPair(settings),
    warningPercent: settings.budgetWarningPercent ?? 80,
  };
}

function throwPolicyInvokeError(value: unknown): never {
  const normalized = normalizeAppError(value, 'AI 请求全局治理失败。');
  if (POLICY_ERROR_CODES.has(normalized.code as AiRequestPolicyErrorCode)) {
    throw new AiRequestPolicyError(
      normalized.code as AiRequestPolicyErrorCode,
      normalized.message,
      normalized.retryable,
    );
  }
  throw normalized;
}

export const aiRequestPolicyService = {
  async beginRequest(
    settings: AiSettings,
    request: AiGenerateRequest,
    providerRequestId?: string,
  ): Promise<AiRequestPolicyLease> {
    requirePricingForCostBudget(settings);
    if (!isTauriRuntime()) return this.begin(settings, request);

    const estimate = requestEstimate(request, settings);
    const normalizedProviderRequestId = providerRequestId?.trim();
    if (!normalizedProviderRequestId) {
      throw new AiRequestPolicyError(
        'AI_REQUEST_POLICY_INPUT_INVALID',
        '桌面 AI 请求必须在预算预留前生成 Provider request ID。',
      );
    }
    const timeoutMs = Math.max(1, settings.timeoutSeconds ?? 120) * 1_000;
    const ttlMs = Math.max(30 * 60_000, timeoutMs + 60_000);
    try {
      const grant = await tauriInvoke<DesktopLeaseGrant>('reserve_ai_request', {
        input: {
          ownerId: getDesktopOwnerId(),
          providerRequestId: normalizedProviderRequestId,
          ...desktopPolicyInput(settings),
          estimatedInputTokens: estimate.estimatedInputTokens,
          estimatedOutputTokens: estimate.estimatedOutputTokens,
          ttlMs,
        },
      });
      return {
        id: grant.reservationId,
        estimatedTokens: grant.estimatedTokens,
        estimatedCostUsd: grant.estimatedCostUsd,
        storage: 'sqlite',
        ownerId: grant.ownerId,
        providerRequestId: grant.providerRequestId,
        leaseToken: grant.leaseToken,
        expiresAtMs: grant.expiresAtMs,
        policyRevision: grant.policyRevision,
        inputPricePerMillionTokens: grant.inputPricePerMillionTokens,
        outputPricePerMillionTokens: grant.outputPricePerMillionTokens,
      };
    } catch (error) {
      throwPolicyInvokeError(error);
    }
  },

  async settleRequest(
    lease: AiRequestPolicyLease,
    settings: AiSettings,
    response?: AiGenerateResponse,
  ): Promise<void> {
    if (lease.storage !== 'sqlite') {
      this.settle(lease, settings, response);
      return;
    }
    if (!lease.ownerId || !lease.leaseToken) {
      throw new AiRequestPolicyError(
        'AI_REQUEST_POLICY_LEASE_CONFLICT',
        'AI 请求全局 reservation 所有权信息缺失。',
      );
    }
    try {
      await tauriInvoke<DesktopPolicySettlement>('settle_ai_request', {
        input: {
          reservationId: lease.id,
          ownerId: lease.ownerId,
          leaseToken: lease.leaseToken,
          outcome: response ? 'succeeded' : 'failed',
          tokenInput: response?.tokenInput,
          tokenOutput: response?.tokenOutput,
        },
      });
    } catch (error) {
      throwPolicyInvokeError(error);
    }
  },

  async snapshotCurrent(settings: AiSettings): Promise<AiRequestBudgetSnapshot> {
    if (!isTauriRuntime()) return this.snapshot(settings);
    try {
      const snapshot = await tauriInvoke<AiRequestBudgetSnapshot>('get_ai_request_policy_snapshot');
      if (!desktopPolicyObservationCaptured) {
        observedDesktopPolicyRevision = snapshot.policy?.revision;
        desktopPolicyObservationCaptured = true;
      }
      return snapshot;
    } catch (error) {
      throwPolicyInvokeError(error);
    }
  },

  async configureGlobalPolicy(settings: AiSettings): Promise<AiRequestPolicySnapshot | undefined> {
    requirePricingForCostBudget(settings);
    if (!isTauriRuntime()) return undefined;
    try {
      const policy = await tauriInvoke<AiRequestPolicySnapshot>('configure_ai_request_policy', {
        input: {
          expectedRevision: observedDesktopPolicyRevision,
          ...desktopPolicyInput(settings),
        },
      });
      observedDesktopPolicyRevision = policy.revision;
      desktopPolicyObservationCaptured = true;
      return policy;
    } catch (error) {
      throwPolicyInvokeError(error);
    }
  },

  begin(settings: AiSettings, request: AiGenerateRequest, now = Date.now()): AiRequestPolicyLease {
    requirePricingForCostBudget(settings);
    const ledger = readLedger(now);
    const maxPerMinute = settings.maxRequestsPerMinute ?? 12;
    const maxConcurrent = settings.maxConcurrentAiRequests ?? 2;
    if (ledger.requestStartedAt.length >= maxPerMinute) {
      throw new AiRequestPolicyError(
        'AI_RATE_LIMIT_EXCEEDED',
        `一分钟内最多发起 ${maxPerMinute} 个 AI 请求。`,
        true,
      );
    }
    if (ledger.reservations.length >= maxConcurrent) {
      throw new AiRequestPolicyError(
        'AI_CONCURRENCY_LIMIT_EXCEEDED',
        `最多允许 ${maxConcurrent} 个 AI 请求同时运行。`,
        true,
      );
    }

    const estimate = requestEstimate(request, settings);
    const reserved = totals(ledger);
    const usedTokens = ledger.tokenInput + ledger.tokenOutput;
    if (
      settings.dailyTokenBudget !== undefined &&
      usedTokens + reserved.tokens + estimate.estimatedTokens > settings.dailyTokenBudget
    ) {
      throw new AiRequestPolicyError(
        'AI_DAILY_TOKEN_BUDGET_EXCEEDED',
        '本次请求的保守 Token 预估会超过今日硬预算。',
      );
    }
    if (
      settings.dailyCostBudgetUsd !== undefined &&
      ledger.costUsd + reserved.cost + (estimate.estimatedCostUsd ?? 0) >
        settings.dailyCostBudgetUsd
    ) {
      throw new AiRequestPolicyError(
        'AI_DAILY_COST_BUDGET_EXCEEDED',
        '本次请求的保守成本预估会超过今日硬预算。',
      );
    }

    const reservation: RequestReservation = {
      id: uuid(),
      startedAt: now,
      expiresAt: now + RESERVATION_TTL_MS,
      estimatedInputTokens: estimate.estimatedInputTokens,
      estimatedOutputTokens: estimate.estimatedOutputTokens,
      estimatedTokens: estimate.estimatedTokens,
      estimatedCostUsd: estimate.estimatedCostUsd,
    };
    ledger.requestStartedAt.push(now);
    ledger.reservations.push(reservation);
    writeLedger(ledger);
    return {
      id: reservation.id,
      estimatedTokens: reservation.estimatedTokens,
      estimatedCostUsd: reservation.estimatedCostUsd,
      storage: 'browser',
    };
  },

  settle(
    lease: AiRequestPolicyLease,
    settings: AiSettings,
    response?: AiGenerateResponse,
    now = Date.now(),
  ): void {
    const ledger = readLedger(now);
    const reservation = ledger.reservations.find((item) => item.id === lease.id);
    if (!reservation) return;
    ledger.reservations = ledger.reservations.filter((item) => item.id !== lease.id);
    if (response && response.tokenInput !== undefined && response.tokenOutput !== undefined) {
      const input = finiteNonNegative(response.tokenInput);
      const output = finiteNonNegative(response.tokenOutput);
      ledger.tokenInput += input;
      ledger.tokenOutput += output;
      const usage = calculateAiUsageCost(createAiPricingSnapshot(settings), input, output);
      if (usage.status === 'complete') ledger.costUsd += usage.estimatedCost ?? 0;
      else ledger.unpricedRequestCount += 1;
    } else {
      ledger.usageMissingCount += 1;
      if (!response) ledger.failedRequestCount += 1;
      ledger.tokenInput += reservation.estimatedInputTokens;
      ledger.tokenOutput += reservation.estimatedOutputTokens;
      if (reservation.estimatedCostUsd === undefined) ledger.unpricedRequestCount += 1;
      else ledger.costUsd += reservation.estimatedCostUsd;
    }
    writeLedger(ledger);
  },

  snapshot(settings: AiSettings, now = Date.now()): AiRequestBudgetSnapshot {
    const ledger = readLedger(now);
    const reserved = totals(ledger);
    const tokenUsed = ledger.tokenInput + ledger.tokenOutput;
    const warningPercent = settings.budgetWarningPercent ?? 80;
    const tokenRatio = settings.dailyTokenBudget
      ? (tokenUsed + reserved.tokens) / settings.dailyTokenBudget
      : 0;
    const costRatio = settings.dailyCostBudgetUsd
      ? (ledger.costUsd + reserved.cost) / settings.dailyCostBudgetUsd
      : 0;
    return {
      day: ledger.day,
      requestsLastMinute: ledger.requestStartedAt.length,
      activeRequests: ledger.reservations.length,
      tokenUsed,
      reservedTokens: reserved.tokens,
      costUsedUsd: ledger.costUsd,
      reservedCostUsd: reserved.cost,
      usageMissingCount: ledger.usageMissingCount,
      unpricedRequestCount: ledger.unpricedRequestCount,
      failedRequestCount: ledger.failedRequestCount,
      expiredRequestCount: ledger.expiredRequestCount,
      tokenBudget: settings.dailyTokenBudget,
      costBudgetUsd: settings.dailyCostBudgetUsd,
      warningPercent,
      warning: Math.max(tokenRatio, costRatio) * 100 >= warningPercent,
    };
  },

  clearForTests(): void {
    memoryLedger = undefined;
    desktopOwnerId = undefined;
    observedDesktopPolicyRevision = undefined;
    desktopPolicyObservationCaptured = false;
    try {
      globalThis.localStorage?.removeItem(LEDGER_KEY);
    } catch {
      // Test cleanup remains best effort.
    }
  },
};

export const aiRequestLedgerStorageKey = LEDGER_KEY;
