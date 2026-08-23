import { productionToolRegistry } from '../agent-tools/productionToolRegistry';
import { isTauri } from '../database/db';
import { taskConversationService } from './taskConversationService';
import { captureTaskModelSnapshot } from './taskModelSnapshot';
import { WORKBENCH_TOOLS } from './currentPluginService';
import { classifyTaskIntent, selectCandidateTool } from './taskGoalRouting';
import { workbenchChapterWriter } from './workbenchChapterWriter';
import { chapterRequiredError, formatWorkbenchFailure } from './workbenchFailure';
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
const WRITER_TOOLS = new Set(['generate_chapter', 'polish_chapter']);

function summarizeArguments(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      if (/prompt|content|body|text|query|goal|candidateText/i.test(key)) {
        return [key, typeof value === 'string' ? { length: value.length } : '[redacted]'];
      }
      if (typeof value === 'string' && value.length > 240) return [key, value.slice(0, 240) + '…'];
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
    '创作目标：' + goal,
    '已读取 ' + String(Object.keys(context).length) + ' 类只读上下文。',
    '这是确定性 fallback 预览，不是正式 ResultArtifact，也不会写入章节正文。',
  ].join('\n\n');
}

function buildStructuredFallback(
  toolName: string,
  artifactType: string,
  goal: string,
  context: Record<string, unknown>,
): string {
  const preview = buildFallbackCandidate(goal, context);
  if (toolName === 'generate_characters' || artifactType === 'character_candidates') {
    return JSON.stringify({
      characters: [{ name: '预览角色', identity: preview }],
    });
  }
  if (toolName === 'suggest_events' || artifactType === 'event_candidates') {
    return JSON.stringify({
      events: [{ title: '预览事件', description: preview }],
    });
  }
  if (toolName === 'expand_settings' || artifactType === 'setting_candidates') {
    return JSON.stringify({
      settings: [{ name: '预览设定', description: preview }],
    });
  }
  if (toolName === 'generate_outline' || artifactType === 'outline') {
    return JSON.stringify({ title: '预览大纲', content: preview });
  }
  if (toolName === 'check_quality' || artifactType === 'quality_report') {
    return JSON.stringify({ summary: preview, issues: [] });
  }
  if (toolName === 'summarize_chapter' || artifactType === 'chapter_summary') {
    return JSON.stringify({ summary: preview });
  }
  return preview;
}

async function publishChapterCandidate(input: {
  conversationId: string;
  novelId: string;
  chapterId: string;
  runId: string;
  text: string;
  artifactId?: string;
  mode: 'generate' | 'polish';
}): Promise<void> {
  const title = input.mode === 'polish' ? '润色章节候选' : '章节正文候选';
  const summary = '已用正式写章管线生成，仅供确认审阅，不会直接写入正式正文。';
  if (input.artifactId && isTauri()) {
    await taskConversationService.createArtifactCard({
      conversationId: input.conversationId,
      runId: input.runId,
      artifactId: input.artifactId,
      artifactType: 'chapter_text',
      title,
      summary,
      content: '',
      status: 'candidate',
      createdAt: new Date().toISOString(),
    });
    return;
  }
  await taskConversationService.publishStructuredCandidate({
    conversationId: input.conversationId,
    novelId: input.novelId,
    artifactType: 'chapter_text',
    title,
    summary,
    structuredPayloadJson: {
      ok: true,
      toolVersion: 'v1',
      artifactType: 'chapter_text',
      candidateOnly: true,
      data: { novelId: input.novelId, chapterId: input.chapterId, text: input.text },
    },
  });
}

async function execute(
  input: TaskRuntimeInput,
  controller: AbortController,
  onEvent?: (event: TaskRuntimeEvent) => void,
): Promise<TaskRun> {
  const modelSnapshot = input.modelSnapshot ?? captureTaskModelSnapshot();
  const workerId = input.workerId ?? 'worker-' + input.conversationId + '-' + String(Date.now());
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
    allowedTools: WORKBENCH_TOOLS.map((name) => name + '@1'),
    dryRun: true,
    modelSnapshot,
    signal: controller.signal,
  };
  const evidence: Record<string, unknown> = {};
  let publishedChapter = false;

  try {
    if (classifyTaskIntent(input.goal) === 'chapter_write' && !input.chapterId) {
      throw chapterRequiredError();
    }

    const steps: Array<{ name: string; args: () => Record<string, unknown> }> = [
      { name: 'novel.read_context', args: () => ({ novelId: input.novelId }) },
    ];
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
    const candidateTool = selectCandidateTool(input.goal, input.chapterId);
    if (candidateTool) {
      steps.push({
        name: candidateTool.name,
        args: () => ({
          novelId: input.novelId,
          chapterId: input.chapterId,
          candidateText: buildStructuredFallback(
            candidateTool.name,
            candidateTool.artifactType,
            input.goal,
            evidence,
          ),
        }),
      });
    }

    for (const step of steps) {
      if (controller.signal.aborted) throw new DOMException('任务已取消', 'AbortError');
      let args = step.args();
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
        if (WRITER_TOOLS.has(step.name) && input.chapterId) {
          const written = await workbenchChapterWriter.generate({
            novelId: input.novelId,
            chapterId: input.chapterId,
            goal: input.goal,
            mode: step.name === 'polish_chapter' ? 'polish' : 'generate',
            signal: controller.signal,
          });
          args = {
            novelId: input.novelId,
            chapterId: input.chapterId,
            candidateText: written.text,
          };
          evidence.writer = written;
        }
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
        if (!result.ok) throw new Error(result.error || '工具 ' + step.name + ' 执行失败');
        if (WRITER_TOOLS.has(step.name) && input.chapterId && result.ok) {
          const written = evidence.writer as { text?: string; artifactId?: string } | undefined;
          const text =
            written?.text ||
            (result.data && typeof result.data === 'object' && 'text' in result.data
              ? String((result.data as { text?: string }).text ?? '')
              : '');
          if (text) {
            await publishChapterCandidate({
              conversationId: input.conversationId,
              novelId: input.novelId,
              chapterId: input.chapterId,
              runId: run.runId,
              text,
              artifactId: written?.artifactId,
              mode: step.name === 'polish_chapter' ? 'polish' : 'generate',
            });
            publishedChapter = true;
          }
        }
      } catch (error) {
        const cancelled =
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === 'AbortError');
        if (!finalized) {
          await taskConversationService.updateToolEvent(runningEvent, {
            status: cancelled ? 'cancelled' : 'failed',
            durationMs: Math.max(0, Math.round(performance.now() - started)),
            error: cancelled ? '任务已取消' : formatWorkbenchFailure(error),
            finishedAt: new Date().toISOString(),
          });
        }
        if (cancelled) throw new DOMException('任务已取消', 'AbortError');
        throw error;
      }
    }

    const generated = candidateTool
      ? (evidence[candidateTool.name] as { text?: string } | undefined)
      : undefined;
    await taskConversationService.appendTurn(
      input.conversationId,
      'assistant',
      publishedChapter
        ? '已用正式写章管线生成章节候选，尚未写入正式正文。请在产物卡片中确认进入审阅或要求修改。'
        : generated?.text
          ? '已完成候选预览；结构化结果仍需你确认后才会写入正式事实。'
          : candidateTool
            ? '已调用 ' + candidateTool.name + '。候选不会直接写入正式正文。'
            : '已完成可用上下文读取和记忆检索；当前任务没有绑定可生成候选的目标。',
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
        error: cancelled ? '任务已取消' : formatWorkbenchFailure(error),
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

  listRunningConversationIds(): string[] {
    return [...activeWorkers.keys()];
  },
};
