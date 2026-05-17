/**
 * AI Novel Studio - AI 任务记录服务
 */
import { lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { AiTaskRecord, AiTaskType, AiTaskStatus } from '../../types/ai';

const AI_TASKS_KEY = 'ai_novel_studio_ai_tasks';

function getLocalTasks(): AiTaskRecord[] {
  return lsGet<AiTaskRecord[]>(AI_TASKS_KEY) ?? [];
}

function saveLocalTasks(tasks: AiTaskRecord[]): void {
  lsSet(AI_TASKS_KEY, tasks);
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
    const tasks = getLocalTasks();
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
      inputSummary: input.inputSummary,
      startedAt: now,
      createdAt: now,
    };
    tasks.unshift(record);
    saveLocalTasks(tasks);
    return record;
  },

  async markSucceeded(
    id: string,
    result: { resultText?: string; promptSnapshot?: string; tokenInput?: number; tokenOutput?: number },
  ): Promise<void> {
    const tasks = getLocalTasks();
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return;
    tasks[idx] = {
      ...tasks[idx],
      status: 'succeeded',
      resultText: result.resultText?.slice(0, 500),
      promptSnapshot: result.promptSnapshot,
      tokenInput: result.tokenInput,
      tokenOutput: result.tokenOutput,
      finishedAt: nowISO(),
    };
    saveLocalTasks(tasks);
  },

  async markFailed(id: string, errorMessage: string): Promise<void> {
    const tasks = getLocalTasks();
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return;
    tasks[idx] = {
      ...tasks[idx],
      status: 'failed',
      errorMessage,
      finishedAt: nowISO(),
    };
    saveLocalTasks(tasks);
  },

  async getByChapterId(chapterId: string): Promise<AiTaskRecord[]> {
    return getLocalTasks().filter((t) => t.chapterId === chapterId);
  },

  async getByNovelId(novelId: string): Promise<AiTaskRecord[]> {
    return getLocalTasks().filter((t) => t.novelId === novelId);
  },

  async getAll(page = 1, size = 20): Promise<{ items: AiTaskRecord[]; total: number }> {
    const tasks = getLocalTasks();
    const start = (page - 1) * size;
    return {
      items: tasks.slice(start, start + size),
      total: tasks.length,
    };
  },
};
