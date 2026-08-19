import { appLogger } from '../observability/appLogger';
/**
 * AI Novel Studio - AI task record service.
 */
import { dbCall, isTauri, lsGet, lsRemove, lsSet, generateId, nowISO } from '../database/db';
import type { AiPricingSnapshot, AiTaskRecord, AiTaskStatus, AiTaskType } from '../../types/ai';
import { calculateAiUsageCost, createAiPricingSnapshot, normalizeAiTokenCount } from './aiCost';
import { getAiSettings } from './aiSettingsStore';

const AI_TASKS_KEY = 'ai_novel_studio_ai_tasks';
const LEGACY_AI_TASKS_KEY = 'ai_novel_studio_ai_task_records';

interface ActiveAiTaskExecution {
  cancel: () => void;
  cancelling: boolean;
}

const activeAiTaskExecutions = new Map<string, Set<ActiveAiTaskExecution>>();

interface DeleteAiTaskRecordsResult {
  deletedCount: number;
  requestedCount?: number;
  beforeCount?: number;
  afterCount?: number;
  beforeMatchCount?: number;
  afterMatchCount?: number;
  affectedRows?: number;
  dbPath?: string;
  deletedChildRows?: Record<string, number>;
}

interface AiTaskRecordsDebugState {
  dbPath: string;
  tableExists: boolean;
  totalCount: number;
  matchedCount?: number | null;
  sampleIds: string[];
}

type AiTaskRecordRow = Partial<AiTaskRecord> & {
  novel_id?: string | null;
  chapter_id?: string | null;
  task_type?: AiTaskType;
  runtime_mode?: 'mock' | 'api' | null;
  model_name?: string | null;
  prompt_template_id?: string | null;
  input_summary?: string | null;
  prompt_snapshot?: string | null;
  result_text?: string | null;
  result_json?: string | null;
  error_message?: string | null;
  token_input?: number | null;
  token_output?: number | null;
  token_total?: number | null;
  duration_ms?: number | null;
  input_price_per_million_tokens?: number | null;
  output_price_per_million_tokens?: number | null;
  cost_estimate?: number | null;
  cost_currency?: 'USD' | null;
  cost_status?: AiTaskRecord['costStatus'] | null;
  pricing_source?: AiTaskRecord['pricingSource'] | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
};

function getLocalTasks(): AiTaskRecord[] {
  const byId = new Map<string, AiTaskRecord>();
  for (const task of normalizeTasks(lsGet<unknown>(LEGACY_AI_TASKS_KEY))) {
    byId.set(task.id, task);
  }
  for (const task of normalizeTasks(lsGet<unknown>(AI_TASKS_KEY))) {
    byId.set(task.id, task);
  }
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function saveLocalTasks(tasks: AiTaskRecord[]): void {
  lsSet(AI_TASKS_KEY, tasks);
  lsRemove(LEGACY_AI_TASKS_KEY);
}

function clearLocalTaskCache(): void {
  lsRemove(AI_TASKS_KEY);
  lsRemove(LEGACY_AI_TASKS_KEY);
}

function removeLocalTasksByIds(ids: string[]): void {
  const idSet = new Set(ids);
  saveLocalTasks(getLocalTasks().filter((task) => !idSet.has(task.id)));
}

function upsertLocalTask(record: AiTaskRecord): void {
  const tasks = getLocalTasks();
  const idx = tasks.findIndex((t) => t.id === record.id);
  if (idx >= 0) tasks[idx] = record;
  else tasks.unshift(record);
  saveLocalTasks(tasks);
}

function normalizeTask(raw: unknown): AiTaskRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as AiTaskRecordRow;
  const id = typeof item.id === 'string' ? item.id : '';
  const taskType = (item.taskType ?? item.task_type) as AiTaskType | undefined;
  if (!id || !taskType) return null;
  const createdAt = item.createdAt ?? item.created_at ?? nowISO();

  return {
    id,
    novelId: item.novelId ?? item.novel_id ?? undefined,
    chapterId: item.chapterId ?? item.chapter_id ?? undefined,
    taskType,
    status: item.status ?? 'pending',
    runtimeMode: item.runtimeMode ?? item.runtime_mode ?? undefined,
    provider: item.provider ?? undefined,
    modelName: item.modelName ?? item.model_name ?? undefined,
    promptTemplateId: item.promptTemplateId ?? item.prompt_template_id ?? undefined,
    inputSummary: item.inputSummary ?? item.input_summary ?? undefined,
    promptSnapshot: item.promptSnapshot ?? item.prompt_snapshot ?? undefined,
    resultText: item.resultText ?? item.result_text ?? undefined,
    resultJson: item.resultJson ?? item.result_json ?? undefined,
    errorMessage: item.errorMessage ?? item.error_message ?? undefined,
    tokenInput: item.tokenInput ?? item.token_input ?? undefined,
    tokenOutput: item.tokenOutput ?? item.token_output ?? undefined,
    tokenTotal: item.tokenTotal ?? item.token_total ?? undefined,
    durationMs: item.durationMs ?? item.duration_ms ?? undefined,
    inputPricePerMillionTokens:
      item.inputPricePerMillionTokens ?? item.input_price_per_million_tokens ?? undefined,
    outputPricePerMillionTokens:
      item.outputPricePerMillionTokens ?? item.output_price_per_million_tokens ?? undefined,
    costEstimate: item.costEstimate ?? item.cost_estimate ?? undefined,
    costCurrency: item.costCurrency ?? item.cost_currency ?? undefined,
    costStatus: item.costStatus ?? item.cost_status ?? undefined,
    pricingSource: item.pricingSource ?? item.pricing_source ?? undefined,
    startedAt: item.startedAt ?? item.started_at ?? undefined,
    finishedAt: item.finishedAt ?? item.finished_at ?? undefined,
    createdAt,
  };
}

function normalizeTasks(raw: unknown): AiTaskRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeTask)
    .filter((item): item is AiTaskRecord => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function durationMs(record: AiTaskRecord | undefined, finishedAt: string): number | undefined {
  if (!record?.startedAt) return undefined;
  const started = Date.parse(record.startedAt);
  const finished = Date.parse(finishedAt);
  if (!Number.isFinite(started) || !Number.isFinite(finished)) return undefined;
  return Math.max(0, finished - started);
}

function isTerminalTask(record: AiTaskRecord | undefined): boolean {
  return (
    record?.status === 'succeeded' || record?.status === 'failed' || record?.status === 'cancelled'
  );
}

function assertProjectionIdentity(existing: AiTaskRecord, requested: AiTaskRecord): void {
  if (
    existing.taskType !== requested.taskType ||
    existing.novelId !== requested.novelId ||
    existing.chapterId !== requested.chapterId ||
    existing.runtimeMode !== requested.runtimeMode ||
    existing.provider !== requested.provider ||
    existing.modelName !== requested.modelName
  ) {
    throw new Error('AI 任务投影 ID 与既有任务身份冲突。');
  }
}

function summarizeText(text: string | undefined, limit = 500): string | undefined {
  if (!text) return undefined;
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export const aiTaskService = {
  registerActiveExecution(id: string, cancel: () => void): () => void {
    if (!id) return () => {};
    const execution: ActiveAiTaskExecution = { cancel, cancelling: false };
    const owners = activeAiTaskExecutions.get(id) ?? new Set<ActiveAiTaskExecution>();
    owners.add(execution);
    activeAiTaskExecutions.set(id, owners);
    return () => {
      const currentOwners = activeAiTaskExecutions.get(id);
      if (!currentOwners) return;
      currentOwners.delete(execution);
      if (currentOwners.size === 0) activeAiTaskExecutions.delete(id);
    };
  },

  cancelActiveExecution(id: string): 'requested' | 'already_requested' | 'not_active' {
    const owners = activeAiTaskExecutions.get(id);
    if (!owners || owners.size === 0) return 'not_active';
    const activeOwners = [...owners].filter((execution) => !execution.cancelling);
    if (activeOwners.length === 0) return 'already_requested';
    for (const execution of activeOwners) {
      execution.cancelling = true;
      try {
        execution.cancel();
      } catch (error) {
        appLogger.captureError('AI_TASK_CANCEL_OWNER_FAILED', error, { taskId: id });
      }
    }
    return 'requested';
  },

  getActiveExecutionState(id: string): 'active' | 'cancelling' | 'inactive' {
    const owners = activeAiTaskExecutions.get(id);
    if (!owners || owners.size === 0) return 'inactive';
    return [...owners].some((execution) => !execution.cancelling) ? 'active' : 'cancelling';
  },

  async create(
    taskType: AiTaskType,
    input: {
      id?: string;
      novelId?: string;
      chapterId?: string;
      modelName?: string;
      inputSummary?: string;
      runtimeMode?: 'mock' | 'api';
      provider?: string;
      pricing?: AiPricingSnapshot;
    },
  ): Promise<AiTaskRecord> {
    const now = nowISO();
    const pricing = input.pricing ?? createAiPricingSnapshot(getAiSettings());
    const requestedId = input.id?.trim();
    if (input.id !== undefined && !requestedId) {
      throw new Error('AI 任务投影 ID 不能为空。');
    }
    const record: AiTaskRecord = {
      id: requestedId ?? generateId(),
      novelId: input.novelId,
      chapterId: input.chapterId,
      taskType,
      status: 'running',
      runtimeMode: input.runtimeMode,
      provider: input.provider,
      modelName: input.modelName,
      inputPricePerMillionTokens: pricing.inputPricePerMillionTokens,
      outputPricePerMillionTokens: pricing.outputPricePerMillionTokens,
      costCurrency: pricing.currency,
      pricingSource: pricing.source,
      inputSummary: summarizeText(input.inputSummary, 300),
      startedAt: now,
      createdAt: now,
    };

    const created = await dbCall<unknown>(
      'create_ai_task_record',
      {
        input: {
          id: record.id,
          novelId: record.novelId,
          chapterId: record.chapterId,
          taskType: record.taskType,
          status: record.status,
          runtimeMode: record.runtimeMode,
          provider: record.provider,
          modelName: record.modelName,
          inputPricePerMillionTokens: record.inputPricePerMillionTokens,
          outputPricePerMillionTokens: record.outputPricePerMillionTokens,
          costCurrency: record.costCurrency,
          pricingSource: record.pricingSource,
          inputSummary: record.inputSummary,
          startedAt: record.startedAt,
          createdAt: record.createdAt,
        },
      },
      () => {
        const tasks = getLocalTasks();
        const existing = tasks.find((task) => task.id === record.id);
        if (existing) {
          assertProjectionIdentity(existing, record);
          return existing;
        }
        tasks.unshift(record);
        saveLocalTasks(tasks);
        return record;
      },
    );

    const normalized = normalizeTask(created) ?? record;
    if (!isTauri()) {
      upsertLocalTask(normalized);
    }
    return normalized;
  },

  async markRunningForRetry(id: string): Promise<void> {
    if (!id) return;
    const startedAt = nowISO();
    await dbCall<void>('mark_ai_task_running_for_retry', { id, startedAt }, () => {
      const tasks = getLocalTasks();
      const index = tasks.findIndex((task) => task.id === id);
      if (index === -1 || tasks[index].status !== 'failed') return;
      tasks[index] = {
        ...tasks[index],
        status: 'running',
        errorMessage: undefined,
        durationMs: undefined,
        finishedAt: undefined,
        startedAt,
      };
      saveLocalTasks(tasks);
    });
  },

  async markSucceeded(
    id: string,
    result: {
      resultText?: string;
      promptSnapshot?: string;
      resultJson?: string;
      tokenInput?: number;
      tokenOutput?: number;
      tokenTotal?: number;
    },
  ): Promise<void> {
    if (!id) return;
    const tasks = getLocalTasks();
    const existing = tasks.find((t) => t.id === id);
    if (isTerminalTask(existing)) return;
    const finishedAt = nowISO();
    const computedDuration = durationMs(existing, finishedAt);
    const tokenInput = normalizeAiTokenCount(result.tokenInput);
    const tokenOutput = normalizeAiTokenCount(result.tokenOutput);
    const explicitTokenTotal = normalizeAiTokenCount(result.tokenTotal);
    const tokenTotal =
      explicitTokenTotal ??
      (tokenInput !== undefined && tokenOutput !== undefined
        ? normalizeAiTokenCount(tokenInput + tokenOutput)
        : undefined);
    const usageCost = calculateAiUsageCost(
      {
        currency: existing?.costCurrency ?? 'USD',
        source: existing?.pricingSource ?? 'unconfigured',
        inputPricePerMillionTokens: existing?.inputPricePerMillionTokens,
        outputPricePerMillionTokens: existing?.outputPricePerMillionTokens,
      },
      tokenInput,
      tokenOutput,
    );

    await dbCall<void>(
      'mark_ai_task_succeeded',
      {
        id,
        input: {
          resultText: summarizeText(result.resultText),
          promptSnapshot: summarizeText(result.promptSnapshot),
          resultJson: summarizeText(result.resultJson),
          tokenInput,
          tokenOutput,
          tokenTotal,
          durationMs: computedDuration,
          finishedAt,
        },
      },
      () => {
        const idx = tasks.findIndex((t) => t.id === id);
        if (idx === -1) return;
        tasks[idx] = {
          ...tasks[idx],
          status: 'succeeded',
          resultText: summarizeText(result.resultText),
          promptSnapshot: summarizeText(result.promptSnapshot),
          resultJson: summarizeText(result.resultJson),
          tokenInput,
          tokenOutput,
          tokenTotal,
          costEstimate: usageCost.estimatedCost,
          costCurrency: usageCost.currency,
          costStatus: usageCost.status,
          pricingSource: usageCost.source,
          durationMs: computedDuration,
          finishedAt,
        };
        saveLocalTasks(tasks);
      },
    );

    if (isTauri()) return;
    const latest = getLocalTasks();
    const idx = latest.findIndex((t) => t.id === id);
    if (idx !== -1) {
      latest[idx] = {
        ...latest[idx],
        status: 'succeeded',
        resultText: summarizeText(result.resultText),
        promptSnapshot: summarizeText(result.promptSnapshot),
        resultJson: summarizeText(result.resultJson),
        tokenInput,
        tokenOutput,
        tokenTotal,
        costEstimate: usageCost.estimatedCost,
        costCurrency: usageCost.currency,
        costStatus: usageCost.status,
        pricingSource: usageCost.source,
        durationMs: computedDuration,
        finishedAt,
      };
      saveLocalTasks(latest);
    }
  },

  async markFailed(id: string, errorMessage: string): Promise<void> {
    if (!id) return;
    const tasks = getLocalTasks();
    const existing = tasks.find((t) => t.id === id);
    if (isTerminalTask(existing)) return;
    const finishedAt = nowISO();
    const computedDuration = durationMs(existing, finishedAt);

    await dbCall<void>(
      'mark_ai_task_failed',
      {
        id,
        errorMessage: summarizeText(errorMessage, 500),
        finishedAt,
        durationMs: computedDuration,
      },
      () => {
        const idx = tasks.findIndex((t) => t.id === id);
        if (idx === -1) return;
        tasks[idx] = {
          ...tasks[idx],
          status: 'failed',
          errorMessage: summarizeText(errorMessage, 500),
          durationMs: computedDuration,
          finishedAt,
        };
        saveLocalTasks(tasks);
      },
    );

    if (isTauri()) return;
    const latest = getLocalTasks();
    const idx = latest.findIndex((t) => t.id === id);
    if (idx !== -1) {
      latest[idx] = {
        ...latest[idx],
        status: 'failed',
        errorMessage: summarizeText(errorMessage, 500),
        durationMs: computedDuration,
        finishedAt,
      };
      saveLocalTasks(latest);
    }
  },

  async markCancelled(id: string): Promise<void> {
    if (!id) return;
    const tasks = getLocalTasks();
    const existing = tasks.find((t) => t.id === id);
    if (isTerminalTask(existing)) return;
    const finishedAt = nowISO();
    const computedDuration = durationMs(existing, finishedAt);

    await dbCall<void>(
      'mark_ai_task_cancelled',
      { id, finishedAt, durationMs: computedDuration },
      () => {
        const idx = tasks.findIndex((t) => t.id === id);
        if (idx === -1) return;
        tasks[idx] = {
          ...tasks[idx],
          status: 'cancelled',
          errorMessage: undefined,
          durationMs: computedDuration,
          finishedAt,
        };
        saveLocalTasks(tasks);
      },
    );

    if (isTauri()) return;
    const latest = getLocalTasks();
    const idx = latest.findIndex((t) => t.id === id);
    if (idx !== -1 && !isTerminalTask(latest[idx])) {
      latest[idx] = {
        ...latest[idx],
        status: 'cancelled',
        errorMessage: undefined,
        durationMs: computedDuration,
        finishedAt,
      };
      saveLocalTasks(latest);
    }
  },

  async getByChapterId(chapterId: string): Promise<AiTaskRecord[]> {
    const tasks = await dbCall<unknown[]>('get_ai_task_records_by_chapter_id', { chapterId }, () =>
      getLocalTasks().filter((t) => t.chapterId === chapterId),
    );
    return normalizeTasks(tasks);
  },

  async getByNovelId(novelId: string): Promise<AiTaskRecord[]> {
    const tasks = await dbCall<unknown[]>('get_ai_task_records_by_novel_id', { novelId }, () =>
      getLocalTasks().filter((t) => t.novelId === novelId),
    );
    return normalizeTasks(tasks);
  },

  async getAll(
    page = 1,
    size = 20,
    filters: { taskType?: AiTaskType; status?: AiTaskStatus } = {},
  ): Promise<{ items: AiTaskRecord[]; total: number }> {
    const tauri = isTauri();
    if (tauri) {
      clearLocalTaskCache();
    }
    appLogger.debug('[AI_TASK_SERVICE] getAll invoke', {
      command: 'get_ai_task_records',
      page,
      size,
      ...filters,
      isTauri: tauri,
    });

    const [rawItems, total] = await Promise.all([
      dbCall<unknown[]>('get_ai_task_records', { page, size, ...filters }, () => {
        appLogger.debug('[AI_TASK_SERVICE] getAll fallback', {
          page,
          size,
          ...filters,
          isTauri: false,
        });
        const tasks = getLocalTasks()
          .filter((task) => !filters.taskType || task.taskType === filters.taskType)
          .filter((task) => !filters.status || task.status === filters.status);
        const start = (page - 1) * size;
        return tasks.slice(start, start + size);
      }),
      dbCall<number>(
        'count_ai_task_records',
        filters,
        () =>
          getLocalTasks()
            .filter((task) => !filters.taskType || task.taskType === filters.taskType)
            .filter((task) => !filters.status || task.status === filters.status).length,
      ),
    ]);
    const items = normalizeTasks(rawItems);
    appLogger.debug('[AI_TASK_SERVICE] getAll result', {
      isTauri: tauri,
      itemCount: items.length,
      total,
    });

    return {
      items,
      total,
    };
  },

  // v1.0.27 删除/清空方法

  /** 删除单条任务记录 */
  async deleteOne(id: string): Promise<DeleteAiTaskRecordsResult> {
    if (!id) return { deletedCount: 0 };

    const tauri = isTauri();
    if (!tauri) {
      const task = getLocalTasks().find((item) => item.id === id);
      if (task && !isTerminalTask(task)) {
        throw new Error('运行中或等待中的 AI 任务不能删除。');
      }
    }
    appLogger.debug('[AI_TASK_SERVICE] deleteOne invoke', {
      command: 'delete_ai_task_record',
      id,
      isTauri: tauri,
    });
    const result = await dbCall<DeleteAiTaskRecordsResult>('delete_ai_task_record', { id }, () => {
      appLogger.debug('[AI_TASK_SERVICE] deleteOne fallback', { id, isTauri: false });
      const before = getLocalTasks();
      const tasks = before.filter((t) => t.id !== id);
      saveLocalTasks(tasks);
      return { deletedCount: before.length - tasks.length };
    });
    appLogger.debug('[AI_TASK_SERVICE] deleteOne result', result);

    removeLocalTasksByIds([id]);

    const check = getLocalTasks().find((t) => t.id === id);
    if (check) throw new Error('AI 任务记录删除后仍可读取');
    if (result.deletedCount === 0) {
      throw new Error('未删除任何记录，请检查记录ID或数据库连接');
    }

    return result;
  },

  /** 批量删除 */
  async deleteMany(ids: string[]): Promise<DeleteAiTaskRecordsResult> {
    const uniqueIds = Array.from(new Set(ids.filter((id) => id.trim().length > 0)));
    if (uniqueIds.length === 0) return { deletedCount: 0 };

    const tauri = isTauri();
    if (!tauri) {
      const idSet = new Set(uniqueIds);
      if (getLocalTasks().some((task) => idSet.has(task.id) && !isTerminalTask(task))) {
        throw new Error('批量删除包含运行中或等待中的 AI 任务。');
      }
    }
    appLogger.debug('[AI_TASK_SERVICE] deleteMany invoke', {
      command: 'delete_ai_task_records_by_ids',
      ids: uniqueIds,
      isTauri: tauri,
    });
    const result = await dbCall<DeleteAiTaskRecordsResult>(
      'delete_ai_task_records_by_ids',
      { input: { ids: uniqueIds } },
      () => {
        appLogger.debug('[AI_TASK_SERVICE] deleteMany fallback', {
          ids: uniqueIds,
          isTauri: false,
        });
        const idSet = new Set(uniqueIds);
        const before = getLocalTasks();
        const tasks = before.filter((t) => !idSet.has(t.id));
        saveLocalTasks(tasks);
        return { deletedCount: before.length - tasks.length };
      },
    );
    appLogger.debug('[AI_TASK_SERVICE] deleteMany result', result);

    const idSet = new Set(uniqueIds);
    removeLocalTasksByIds(uniqueIds);

    const remainingIds = getLocalTasks()
      .filter((t) => idSet.has(t.id))
      .map((t) => t.id);
    if (remainingIds.length > 0) {
      throw new Error(`AI 任务记录删除后仍可读取：${remainingIds.join(', ')}`);
    }
    if (result.deletedCount === 0) {
      throw new Error('未删除任何记录，请检查记录ID或数据库连接');
    }

    return result;
  },

  /** 清空全部记录 */
  async clearAll(): Promise<DeleteAiTaskRecordsResult> {
    const tauri = isTauri();
    if (!tauri && getLocalTasks().some((task) => !isTerminalTask(task))) {
      throw new Error('存在运行中或等待中的 AI 任务，请先停止并确认终态。');
    }
    appLogger.debug('[AI_TASK_SERVICE] clearAll invoke', {
      command: 'clear_ai_task_records',
      isTauri: tauri,
    });
    const result = await dbCall<DeleteAiTaskRecordsResult>('clear_ai_task_records', {}, () => {
      appLogger.debug('[AI_TASK_SERVICE] clearAll fallback', { isTauri: false });
      const deletedCount = getLocalTasks().length;
      saveLocalTasks([]);
      return { deletedCount };
    });
    appLogger.debug('[AI_TASK_SERVICE] clearAll result', result);

    clearLocalTaskCache();
    const check = getLocalTasks();
    if (check.length > 0) throw new Error('AI 任务记录清空后仍有残留');
    return result;
  },

  async debugState(ids?: string[]): Promise<AiTaskRecordsDebugState | null> {
    if (!isTauri()) return null;
    return dbCall<AiTaskRecordsDebugState>('get_ai_task_records_debug_state', ids ? { ids } : {});
  },
};
