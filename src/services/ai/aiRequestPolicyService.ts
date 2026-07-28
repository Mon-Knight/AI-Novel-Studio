import type { AiGenerateRequest, AiGenerateResponse, AiSettings } from '../../types/ai';
import { calculateAiUsageCost, createAiPricingSnapshot } from './aiCost';

const LEDGER_KEY = 'ai_novel_studio_ai_request_ledger_v1';
const MINUTE_MS = 60_000;
const RESERVATION_TTL_MS = 30 * 60_000;

interface RequestReservation {
  id: string;
  startedAt: number;
  expiresAt: number;
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
  reservations: RequestReservation[];
}

export interface AiRequestBudgetSnapshot {
  day: string;
  requestsLastMinute: number;
  activeRequests: number;
  tokenUsed: number;
  reservedTokens: number;
  costUsedUsd: number;
  reservedCostUsd: number;
  usageMissingCount: number;
  tokenBudget?: number;
  costBudgetUsd?: number;
  warningPercent: number;
  warning: boolean;
}

export interface AiRequestPolicyLease {
  id: string;
  estimatedTokens: number;
  estimatedCostUsd?: number;
}

export class AiRequestPolicyError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly code:
      | 'AI_RATE_LIMIT_EXCEEDED'
      | 'AI_CONCURRENCY_LIMIT_EXCEEDED'
      | 'AI_DAILY_TOKEN_BUDGET_EXCEEDED'
      | 'AI_DAILY_COST_BUDGET_EXCEEDED'
      | 'AI_BUDGET_PRICING_REQUIRED',
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
    reservations: [],
  };
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizeLedger(value: unknown, now: number): RequestLedger {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyLedger(now);
  const source = value as Partial<RequestLedger>;
  if (source.schemaVersion !== 1 || source.day !== dayKey(now)) return emptyLedger(now);
  const reservations = Array.isArray(source.reservations)
    ? source.reservations.filter((item): item is RequestReservation =>
        Boolean(
          item &&
          typeof item.id === 'string' &&
          typeof item.startedAt === 'number' &&
          typeof item.expiresAt === 'number' &&
          item.expiresAt > now,
        ),
      )
    : [];
  return {
    schemaVersion: 1,
    day: source.day,
    requestStartedAt: Array.isArray(source.requestStartedAt)
      ? source.requestStartedAt.filter((item) => typeof item === 'number' && item > now - MINUTE_MS)
      : [],
    tokenInput: finiteNonNegative(source.tokenInput),
    tokenOutput: finiteNonNegative(source.tokenOutput),
    costUsd: finiteNonNegative(source.costUsd),
    usageMissingCount: finiteNonNegative(source.usageMissingCount),
    reservations,
  };
}

function readLedger(now: number): RequestLedger {
  let parsed: unknown = memoryLedger;
  try {
    const stored = globalThis.localStorage?.getItem(LEDGER_KEY);
    if (stored) parsed = JSON.parse(stored);
  } catch {
    // The in-memory ledger continues to enforce limits for this process.
  }
  return normalizeLedger(parsed, now);
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
  let characters = 0;
  for (const message of request.messages) characters += Array.from(message.content).length;
  const estimatedInputTokens = Math.max(1, Math.ceil(characters / 2));
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

export const aiRequestPolicyService = {
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
    if (response) {
      const input = finiteNonNegative(response.tokenInput);
      const output = finiteNonNegative(response.tokenOutput);
      if (response.tokenInput === undefined || response.tokenOutput === undefined) {
        ledger.usageMissingCount += 1;
        ledger.tokenOutput += reservation.estimatedTokens;
        ledger.costUsd += reservation.estimatedCostUsd ?? 0;
      } else {
        ledger.tokenInput += input;
        ledger.tokenOutput += output;
        const usage = calculateAiUsageCost(createAiPricingSnapshot(settings), input, output);
        ledger.costUsd += usage.status === 'complete' ? (usage.estimatedCost ?? 0) : 0;
      }
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
      tokenBudget: settings.dailyTokenBudget,
      costBudgetUsd: settings.dailyCostBudgetUsd,
      warningPercent,
      warning: Math.max(tokenRatio, costRatio) * 100 >= warningPercent,
    };
  },

  clearForTests(): void {
    memoryLedger = undefined;
    try {
      globalThis.localStorage?.removeItem(LEDGER_KEY);
    } catch {
      // Test cleanup remains best effort.
    }
  },
};

export const aiRequestLedgerStorageKey = LEDGER_KEY;
