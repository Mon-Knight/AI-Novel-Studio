import { productionToolRegistry } from '../agent-tools/productionToolRegistry';
import { taskConversationService } from './taskConversationService';
import { captureTaskModelSnapshot } from './taskModelSnapshot';
import type { TaskModelSnapshot, TaskRun, ToolCallEvent } from '../../types/conversation';
import type { ToolInvocationContext, ToolResult } from '../../types/toolRegistry';

export interface TaskRuntimeInput {
  conversationId: string;
  novelId: string;
  turnId: string;
  goal: string;
  chapterId?: string;
  modelSnapshot?: TaskModelSnapshot;
  /** Stable per-task worker identity supplied by the DSH session adapter. */
  workerId?: string;
}

export interface TaskRuntimeEvent {
  run: TaskRun;
  toolEvent?: ToolCallEvent;
}

interface ActiveWorker {
  controller: AbortController;
  promise: Promise<TaskRun>;
}

const activeWorkers = new Map<string, ActiveWorker>();

function summarizeArguments(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      if (/prompt|content|body|text|query|goal/i.test(key)) {
        return [key, typeof value === 'string' ? { length: value.length } : '[redacted]'];
      }
      if (typeof value === 'string' && value.length > 240) return [key, `${value.slice(0, 240)}…`];
      return [key, value];
    }),
  );
}

function summarizeResult(result: ToolResult): unknown {
  if (!result || typeof result !== 'object') return result;
  const data = result.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    if (typeof record.text === 'string') {
      return { ...record, text: { length: record.text.length } };
    }
  }
  return result;
}

function buildFallbackCandidate(goal: string, context: Record<string, unknown>): string {
  return [
    '【浏览器开发预览｜非 DSH 产物】',
    `创作目标：${goal}`,
    `已读取 ${Object.keys(context).length} 类只读上下文。`,
    '这是确定性 fallback 预览，不是正式 ResultArtifact，也不会写入章节正文。',
  ].join('\n\n');
}

async function execute(
  input: TaskRuntimeInput,
  controller: AbortController,
  onEvent?: (event: TaskRuntimeEvent) => void,
): Promise<TaskRun> {
  const modelSnapshot = input.modelSnapshot ?? captureTaskModelSnapshot();
  const workerId = input.workerId ?? `worker-${input.conversationId}-${Date.now()}`;
  const run = await taskConversationService.createRun(
    input.conversationId,
    input.turnId,
    modelSnapshot,
    workerId,
  );
  const startedAt = new Date().toISOString();
  let currentRun = await taskConversationService.updateRun(run.runId, 'running', { startedAt });
  onEvent?.({ run: currentRun });
  const context: ToolInvocationContext = {
    invocationId: run.runId,
    novelId: input.novelId,
    chapterId: input.chapterId,
    grantedPermissions: ['novel.read', 'chapter.read'],
    allowedTools: [
      'novel.read_context@1',
      'chapter.read_outline@1',
      'search_memory@1',
      'generate_chapter@1',
    ],
    dryRun: true,
    modelSnapshot,
    signal: controller.signal,
  };
  const evidence: Record<string, unknown> = {};
  const steps: Array<{
    name: string;
    args: () => Record<string, unknown>;
  }> = [{ name: 'novel.read_context', args: () => ({ novelId: input.novelId }) }];
  if (input.chapterId) {
    steps.push({
      name: 'chapter.read_outline',
      args: () => ({ novelId: input.novelId, chapterId: input.chapterId }),
    });
  }
  steps.push({
    name: 'search_memory',
    args: () => ({ novelId: input.novelId, query: input.goal }),
  });
  if (input.chapterId) {
    steps.push({
      name: 'generate_chapter',
      args: () => ({
        novelId: input.novelId,
        chapterId: input.chapterId,
        candidateText: buildFallbackCandidate(input.goal, evidence),
      }),
    });
  }

  try {
    for (const step of steps) {
      if (controller.signal.aborted) throw new DOMException('任务已取消', 'AbortError');
      const args = step.args();
      const event = await taskConversationService.appendToolEvent({
        runId: run.runId,
        toolName: step.name,
        argumentsSummary: summarizeArguments(args),
        status: 'queued',
        createdAt: new Date().toISOString(),
      });
      onEvent?.({ run: currentRun, toolEvent: event });
      const started = performance.now();
      const runningEvent = await taskConversationService.updateToolEvent(event, {
        status: 'running',
      });
      onEvent?.({ run: currentRun, toolEvent: runningEvent });
      let finalized = false;
      try {
        const result = await productionToolRegistry.invoke(step.name, '1', args, context);
        const completed = await taskConversationService.updateToolEvent(runningEvent, {
          status: result.ok ? 'succeeded' : 'failed',
          durationMs: Math.max(0, Math.round(performance.now() - started)),
          error: result.ok ? undefined : result.error,
          result: summarizeResult(result),
          finishedAt: new Date().toISOString(),
        });
        finalized = true;
        onEvent?.({ run: currentRun, toolEvent: completed });
        evidence[step.name] = result.ok ? result.data : { error: result.error };
        if (!result.ok) throw new Error(result.error || `工具 ${step.name} 执行失败`);
      } catch (error) {
        const cancelled =
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError');
        if (!finalized) {
          await taskConversationService.updateToolEvent(runningEvent, {
            status: cancelled ? 'cancelled' : 'failed',
            durationMs: Math.max(0, Math.round(performance.now() - started)),
            error: cancelled
              ? '任务已取消'
              : error instanceof Error
                ? error.message
                : String(error),
            finishedAt: new Date().toISOString(),
          });
        }
        if (cancelled) throw new DOMException('任务已取消', 'AbortError');
        throw error;
      }
    }

    const generated = evidence.generate_chapter as { text?: string } | undefined;
    await taskConversationService.appendTurn(
      input.conversationId,
      'assistant',
      generated?.text
        ? `浏览器开发 fallback 已完成确定性预览；它不会冒充 DSH 或 ResultArtifact。\n\n${generated.text}`
        : '已完成可用上下文读取和记忆检索；当前任务没有绑定章节，因此暂未生成章节候选。',
    );
    currentRun = await taskConversationService.updateRun(run.runId, 'completed', {
      finishedAt: new Date().toISOString(),
    });
    onEvent?.({ run: currentRun });
    return currentRun;
  } catch (error) {
    const cancelled =
      controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError');
    currentRun = await taskConversationService.updateRun(
      run.runId,
      cancelled ? 'cancelled' : 'failed',
      {
        error: cancelled ? '任务已取消' : error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      },
    );
    onEvent?.({ run: currentRun });
    return currentRun;
  }
}

export const taskRuntimeAdapter = {
  start(input: TaskRuntimeInput, onEvent?: (event: TaskRuntimeEvent) => void): Promise<TaskRun> {
    const existing = activeWorkers.get(input.conversationId);
    if (existing) {
      return Promise.reject(new Error('当前任务已有活动运行'));
    }
    const controller = new AbortController();
    const promise = execute(input, controller, onEvent).finally(() => {
      activeWorkers.delete(input.conversationId);
    });
    activeWorkers.set(input.conversationId, { controller, promise });
    return promise;
  },

  cancel(conversationId: string): boolean {
    const worker = activeWorkers.get(conversationId);
    if (!worker) return false;
    worker.controller.abort();
    return true;
  },

  isRunning(conversationId: string): boolean {
    return activeWorkers.has(conversationId);
  },
};
