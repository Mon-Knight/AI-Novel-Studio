/**
 * AI Novel Studio - AI task record service.
 */
import { dbCall, lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { AiTaskRecord, AiTaskType } from '../../types/ai';

const AI_TASKS_KEY = 'ai_novel_studio_ai_tasks';

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
  started_at?: string | null;
  finished_at?: string | null;
  created_at?: string;
};

function getLocalTasks(): AiTaskRecord[] {
  return normalizeTasks(lsGet<unknown>(AI_TASKS_KEY));
}

function saveLocalTasks(tasks: AiTaskRecord[]): void {
  lsSet(AI_TASKS_KEY, tasks);
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

function summarizeText(text: string | undefined, limit = 500): string | undefined {
  if (!text) return undefined;
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

export const aiTaskService = {
  async create(
    taskType: AiTaskType,
    input: {
      novelId?: string;
      chapterId?: string;
      modelName?: string;
      inputSummary?: string;
      runtimeMode?: 'mock' | 'api';
      provider?: string;
    },
  ): Promise<AiTaskRecord> {
    const now = nowISO();
    const record: AiTaskRecord = {
      id: generateId(),
      novelId: input.novelId,
      chapterId: input.chapterId,
      taskType,
      status: 'running',
      runtimeMode: input.runtimeMode,
      provider: input.provider,
      modelName: input.modelName,
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
          inputSummary: record.inputSummary,
          startedAt: record.startedAt,
          createdAt: record.createdAt,
        },
      },
      () => {
        const tasks = getLocalTasks();
        tasks.unshift(record);
        saveLocalTasks(tasks);
        return record;
      },
    ).catch(() => {
      const tasks = getLocalTasks();
      tasks.unshift(record);
      saveLocalTasks(tasks);
      return record;
    });

    const normalized = normalizeTask(created) ?? record;
    upsertLocalTask(normalized);
    return normalized;
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
    const finishedAt = nowISO();
    const computedDuration = durationMs(existing, finishedAt);

    await dbCall<void>(
      'mark_ai_task_succeeded',
      {
        id,
        input: {
          resultText: summarizeText(result.resultText),
          promptSnapshot: summarizeText(result.promptSnapshot),
          resultJson: summarizeText(result.resultJson),
          tokenInput: result.tokenInput,
          tokenOutput: result.tokenOutput,
          tokenTotal: result.tokenTotal ?? (
            result.tokenInput != null && result.tokenOutput != null
              ? result.tokenInput + result.tokenOutput
              : undefined
          ),
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
          tokenInput: result.tokenInput,
          tokenOutput: result.tokenOutput,
          tokenTotal: result.tokenTotal,
          durationMs: computedDuration,
          finishedAt,
        };
        saveLocalTasks(tasks);
      },
    ).catch(() => {
      const idx = tasks.findIndex((t) => t.id === id);
      if (idx === -1) return;
      tasks[idx] = {
        ...tasks[idx],
        status: 'succeeded',
        resultText: summarizeText(result.resultText),
        promptSnapshot: summarizeText(result.promptSnapshot),
        resultJson: summarizeText(result.resultJson),
        tokenInput: result.tokenInput,
        tokenOutput: result.tokenOutput,
        tokenTotal: result.tokenTotal,
        durationMs: computedDuration,
        finishedAt,
      };
      saveLocalTasks(tasks);
    });

    const latest = getLocalTasks();
    const idx = latest.findIndex((t) => t.id === id);
    if (idx !== -1) {
      latest[idx] = {
        ...latest[idx],
        status: 'succeeded',
        resultText: summarizeText(result.resultText),
        promptSnapshot: summarizeText(result.promptSnapshot),
        resultJson: summarizeText(result.resultJson),
        tokenInput: result.tokenInput,
        tokenOutput: result.tokenOutput,
        tokenTotal: result.tokenTotal,
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
    const finishedAt = nowISO();
    const computedDuration = durationMs(existing, finishedAt);

    await dbCall<void>(
      'mark_ai_task_failed',
      { id, errorMessage: summarizeText(errorMessage, 500), finishedAt, durationMs: computedDuration },
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
    ).catch(() => {
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
    });

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

  async getByChapterId(chapterId: string): Promise<AiTaskRecord[]> {
    const tasks = await dbCall<unknown[]>(
      'get_ai_task_records_by_chapter_id',
      { chapterId },
      () => getLocalTasks().filter((t) => t.chapterId === chapterId),
    ).catch(() => getLocalTasks().filter((t) => t.chapterId === chapterId));
    return normalizeTasks(tasks);
  },

  async getByNovelId(novelId: string): Promise<AiTaskRecord[]> {
    const tasks = await dbCall<unknown[]>(
      'get_ai_task_records_by_novel_id',
      { novelId },
      () => getLocalTasks().filter((t) => t.novelId === novelId),
    ).catch(() => getLocalTasks().filter((t) => t.novelId === novelId));
    return normalizeTasks(tasks);
  },

  async getAll(page = 1, size = 20): Promise<{ items: AiTaskRecord[]; total: number }> {
    const [items, total] = await Promise.all([
      dbCall<unknown[]>('get_ai_task_records', { page, size }, () => {
        const tasks = getLocalTasks();
        const start = (page - 1) * size;
        return tasks.slice(start, start + size);
      }).catch(() => {
        const tasks = getLocalTasks();
        const start = (page - 1) * size;
        return tasks.slice(start, start + size);
      }),
      dbCall<number>('count_ai_task_records', {}, () => getLocalTasks().length).catch(() => getLocalTasks().length),
    ]);

    return {
      items: normalizeTasks(items),
      total,
    };
  },
};
