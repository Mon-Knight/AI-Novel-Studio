import {
  getCanonicalToolManifest,
  listCanonicalToolsForAgent,
} from '../canonical/canonicalToolProjection';
import { executeCanonicalTool } from '../canonical/canonicalToolRuntime';
import type { CanonicalModelToolDescriptor } from '../canonical/canonicalToolTypes';
import type {
  MainAgentError,
  MainAgentExecutor,
  MainAgentExecutorAction,
  MainAgentRequest,
  MainAgentResult,
  MainAgentToolCallRecord,
  MainAgentTurnRequest,
} from './mainAgentTypes';

export function sanitizeErrorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error occurred during Main Agent execution';

  return raw
    .replace(/Bearer\s+[A-Za-z0-9_.~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/(sk-[A-Za-z0-9_-]{8,})/gi, 'sk-[REDACTED]')
    .replace(/(api[-_]?key|secret|token|password)=([^\s&]+)/gi, '$1=[REDACTED]');
}

export function extractSearchQuery(userGoal: string): string {
  const cleaned = userGoal
    .replace(/(请|帮我|搜索|检索|记忆|查找|查询|关于|回忆|相关|一下|内容)/g, '')
    .replace(/^的+|的+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned.length > 0 ? cleaned : userGoal).slice(0, 500);
}

export function selectInitialToolCalls(
  userGoal: string,
  novelId: string,
  chapterId: string | undefined,
  availableToolIdentities: Set<string>,
): Array<{ name: string; version: string; argumentsJson: unknown }> {
  const calls: Array<{ name: string; version: string; argumentsJson: unknown }> = [];
  const normalized = userGoal.toLowerCase();

  const isConversationalOnly = /^(你好|您好|hi|hello|在吗|早上好|晚上好|中午好)$/i.test(
    userGoal.trim(),
  );

  if (isConversationalOnly) {
    return [];
  }

  const mentionsStructure = /(structure|outline|chapter|分卷|章节|大纲|目录|结构)/i.test(
    normalized,
  );
  const mentionsContext = /(context|summary|summaries|story|前文|剧情|梗概|总结|上下文|进展)/i.test(
    normalized,
  );
  const mentionsMemory = /(memory|search|recall|remember|记忆|检索|搜索|回忆|查找|伏笔|旧事)/i.test(
    normalized,
  );
  const mentionsNovelExplicit =
    /(novel|setting|overview|作品|设定|背景|世界观|全局|基础|信息)/i.test(normalized);

  const wantsNovel =
    mentionsNovelExplicit ||
    (!mentionsStructure && !mentionsContext && !mentionsMemory) ||
    (/(读取|查看|分析|创作建议)/i.test(normalized) && mentionsNovelExplicit);

  const wantsStructure = Boolean(chapterId) && mentionsStructure;
  const wantsContext = Boolean(chapterId) && mentionsContext;
  const wantsMemory = mentionsMemory;

  if (wantsNovel && availableToolIdentities.has('novel.read@1')) {
    calls.push({
      name: 'novel.read',
      version: '1',
      argumentsJson: { novelId },
    });
  }

  if (wantsStructure && chapterId && availableToolIdentities.has('structure.read@1')) {
    calls.push({
      name: 'structure.read',
      version: '1',
      argumentsJson: { novelId, chapterId },
    });
  }

  if (wantsContext && chapterId && availableToolIdentities.has('context.read@1')) {
    calls.push({
      name: 'context.read',
      version: '1',
      argumentsJson: { novelId, chapterId },
    });
  }

  if (wantsMemory && availableToolIdentities.has('memory.search@1')) {
    calls.push({
      name: 'memory.search',
      version: '1',
      argumentsJson: {
        novelId,
        query: extractSearchQuery(userGoal),
      },
    });
  }

  // Fallback: if query wants something creative but no tool explicitly matched
  if (calls.length === 0 && availableToolIdentities.has('novel.read@1')) {
    calls.push({
      name: 'novel.read',
      version: '1',
      argumentsJson: { novelId },
    });
  }

  return calls;
}

export function synthesizeCreativeResponse(
  userGoal: string,
  _novelId: string,
  chapterId: string | undefined,
  toolCalls: MainAgentToolCallRecord[],
): string {
  const isConversationalOnly = /^(你好|您好|hi|hello|在吗|早上好|晚上好|中午好)$/i.test(
    userGoal.trim(),
  );

  if (isConversationalOnly && toolCalls.length === 0) {
    return '您好！我是小说创作助手，可以为您读取作品设定、章节大纲、剧情上下文以及检索小说记忆，请问有什么可以帮您？';
  }

  const lines: string[] = [];
  lines.push('### 创作分析与建议');
  lines.push(`\n**目标需求**：${userGoal}`);

  for (const call of toolCalls) {
    if (call.name === 'novel.read' && call.status === 'completed') {
      const data = (call.result as { data?: Record<string, unknown> })?.data;
      lines.push('\n#### 1. 作品与基础设定概况');
      if (data) {
        if (data.title) lines.push(`- **作品名称**：${String(data.title)}`);
        if (data.targetAudience) lines.push(`- **目标读者**：${String(data.targetAudience)}`);
        if (data.description) lines.push(`- **作品简介**：${String(data.description)}`);
        if (Array.isArray(data.settingsSummary) && data.settingsSummary.length > 0) {
          lines.push(`- **核心设定**：${data.settingsSummary.slice(0, 3).map(String).join('；')}`);
        }
      } else {
        lines.push('- 已成功读取作品基础设定。');
      }
    }

    if (call.name === 'structure.read' && call.status === 'completed') {
      const data = (call.result as { data?: Record<string, unknown> })?.data;
      lines.push('\n#### 2. 章节结构与大纲位置');
      if (data) {
        if (data.chapterTitle) lines.push(`- **当前章节**：${String(data.chapterTitle)}`);
        if (data.volumeTitle) lines.push(`- **所属分卷**：${String(data.volumeTitle)}`);
        if (data.outlineSummary) lines.push(`- **大纲要求**：${String(data.outlineSummary)}`);
      } else {
        lines.push('- 已成功定位章节在大纲与卷章树中的位置。');
      }
    }

    if (call.name === 'context.read' && call.status === 'completed') {
      const data = (call.result as { data?: Record<string, unknown> })?.data;
      lines.push('\n#### 3. 剧情上下文与前文脉络');
      if (data) {
        if (data.summary) lines.push(`- **前文梗概**：${String(data.summary)}`);
        if (data.recentEvents) lines.push(`- **近期事件**：${String(data.recentEvents)}`);
      } else {
        lines.push('- 已成功读取前文及剧情上下文。');
      }
    }

    if (call.name === 'memory.search' && call.status === 'completed') {
      const data = (call.result as { data?: Record<string, unknown> })?.data;
      lines.push('\n#### 4. 记忆检索与伏笔关联');
      if (data && Array.isArray(data.items) && data.items.length > 0) {
        lines.push(`- **检索结果**：找到 ${data.items.length} 条相关记忆沉淀。`);
      } else {
        lines.push('- 已检索小说记忆库，暂无冲突历史。');
      }
    }
  }

  const failedCalls = toolCalls.filter((c) => c.status === 'failed');
  if (failedCalls.length > 0) {
    lines.push('\n#### 注意事项');
    for (const f of failedCalls) {
      const err = (f.result as { error?: { message?: string } })?.error?.message ?? '读取未完成';
      lines.push(`- \`${f.name}\`：${err}`);
    }
  }

  if (!chapterId && /(chapter|章节|结构|上下文)/i.test(userGoal)) {
    lines.push('\n*注：本次请求未指定目标 chapterId，已跳过特定章节大纲与正文上下文检索。*');
  }

  lines.push('\n#### 下一步创作建议');
  lines.push('1. **承接上下文**：根据前述设定与剧情走向，本章应保持人物动机与前文叙事基调一致。');
  lines.push('2. **推进核心冲突**：遵循大纲节奏安排，在关键情节点展现人物选择与情节起伏。');
  lines.push('3. **伏笔呼应**：注意前后细节的呼应，确保叙事闭环与世界观一致性。');

  return lines.join('\n');
}

export function formatPrompt(
  request: MainAgentRequest,
  toolCalls: MainAgentToolCallRecord[],
): string {
  const parts: string[] = [`User Goal: ${request.userGoal}`, `Novel ID: ${request.novelId}`];
  if (request.chapterId) {
    parts.push(`Chapter ID: ${request.chapterId}`);
  }
  if (toolCalls.length > 0) {
    parts.push('\nExecuted Tool Calls:');
    for (const call of toolCalls) {
      if (call.status === 'completed') {
        parts.push(
          `[Tool Result: ${call.name}@${call.version}] SUCCESS\n${JSON.stringify(call.result)}`,
        );
      } else {
        const errorRecord = (call.result as { error?: { code?: string; message?: string } })?.error;
        const code = errorRecord?.code ?? 'UNKNOWN_ERROR';
        const msg = errorRecord?.message ?? 'Execution failed';
        parts.push(`[Tool Result: ${call.name}@${call.version}] FAILED\nError [${code}]: ${msg}`);
      }
    }
  }
  return parts.join('\n');
}

/** Host-side heuristic executor used by this scaffold. Not R4 VERIFIED DSH evidence. */
export function createDefaultDeterministicExecutor(
  request: MainAgentRequest,
  toolCallsHistory: MainAgentToolCallRecord[],
): MainAgentExecutor {
  let initialTurnExecuted = false;

  return async (_prompt: string, exposedTools: CanonicalModelToolDescriptor[]) => {
    if (!initialTurnExecuted && toolCallsHistory.length === 0) {
      initialTurnExecuted = true;
      const availableIdentities = new Set(exposedTools.map((tool) => `${tool.id}@${tool.version}`));
      const calls = selectInitialToolCalls(
        request.userGoal,
        request.novelId,
        request.chapterId,
        availableIdentities,
      );
      if (calls.length > 0) {
        return { toolCalls: calls };
      }
    }

    return {
      text: synthesizeCreativeResponse(
        request.userGoal,
        request.novelId,
        request.chapterId,
        toolCallsHistory,
      ),
    };
  };
}

export async function executeMainAgent(request: MainAgentRequest): Promise<MainAgentResult> {
  const conversationId = request?.conversationId?.trim() || `conv-${Date.now()}`;
  const novelId = request?.novelId?.trim() || '';
  const chapterId = request?.chapterId?.trim() || undefined;
  const userGoal = request?.userGoal?.trim() || '';

  if (!novelId) {
    return {
      ok: false,
      conversationId,
      novelId,
      chapterId,
      userGoal,
      toolCalls: [],
      finalMessage: '',
      error: 'INVALID_ARGUMENT: novelId is required and must be a non-empty string',
      errorCode: 'INVALID_ARGUMENT',
    };
  }

  if (!userGoal) {
    return {
      ok: false,
      conversationId,
      novelId,
      chapterId,
      userGoal,
      toolCalls: [],
      finalMessage: '',
      error: 'INVALID_ARGUMENT: userGoal is required and must be a non-empty string',
      errorCode: 'INVALID_ARGUMENT',
    };
  }

  if (request.signal?.aborted) {
    return {
      ok: false,
      conversationId,
      novelId,
      chapterId,
      userGoal,
      toolCalls: [],
      finalMessage: '',
      error: 'UPSTREAM_FAILURE: Main Agent execution was aborted',
      errorCode: 'UPSTREAM_FAILURE',
    };
  }

  if (request.targetSnapshot) {
    if (
      typeof request.targetSnapshot.novelId === 'string' &&
      request.targetSnapshot.novelId !== novelId
    ) {
      return {
        ok: false,
        conversationId,
        novelId,
        chapterId,
        userGoal,
        toolCalls: [],
        finalMessage: '',
        error: `Scope mismatch: targetSnapshot novelId (${request.targetSnapshot.novelId}) does not match request novelId (${novelId})`,
      };
    }
    if (
      chapterId &&
      typeof request.targetSnapshot.chapterId === 'string' &&
      request.targetSnapshot.chapterId !== chapterId
    ) {
      return {
        ok: false,
        conversationId,
        novelId,
        chapterId,
        userGoal,
        toolCalls: [],
        finalMessage: '',
        error: `Scope mismatch: targetSnapshot chapterId (${request.targetSnapshot.chapterId}) does not match request chapterId (${chapterId})`,
      };
    }
  }

  let manifest;
  let exposedTools: CanonicalModelToolDescriptor[];
  try {
    const [loadedManifest, loadedTools] = await Promise.all([
      getCanonicalToolManifest(),
      listCanonicalToolsForAgent(),
    ]);
    manifest = loadedManifest;
    exposedTools = loadedTools;
  } catch (error) {
    return {
      ok: false,
      conversationId,
      novelId,
      chapterId,
      userGoal,
      toolCalls: [],
      finalMessage: '',
      error: sanitizeErrorMessage(error),
    };
  }

  const maxSteps =
    typeof request.maxSteps === 'number' && request.maxSteps > 0
      ? Math.min(request.maxSteps, 50)
      : 5;

  const toolCallsHistory: MainAgentToolCallRecord[] = [];
  const executor =
    request.executor ?? createDefaultDeterministicExecutor(request, toolCallsHistory);

  let step = 0;
  let lastActionText: string | undefined;

  while (step < maxSteps) {
    if (request.signal?.aborted) {
      return {
        ok: false,
        conversationId,
        novelId,
        chapterId,
        userGoal,
        toolCalls: toolCallsHistory,
        finalMessage: lastActionText ?? '',
        error: 'Main Agent execution was aborted',
      };
    }

    const currentPrompt = formatPrompt(request, toolCallsHistory);

    let action: MainAgentExecutorAction;
    try {
      action = await executor(currentPrompt, exposedTools);
    } catch (error) {
      return {
        ok: false,
        conversationId,
        novelId,
        chapterId,
        userGoal,
        toolCalls: toolCallsHistory,
        finalMessage: lastActionText ?? '',
        error: sanitizeErrorMessage(error),
      };
    }

    if (action.text) {
      lastActionText = action.text;
    }

    const callsToExecute = action.toolCalls ?? [];

    if (callsToExecute.length === 0) {
      return {
        ok: true,
        conversationId,
        novelId,
        chapterId,
        userGoal,
        toolCalls: toolCallsHistory,
        finalMessage: action.text ?? lastActionText ?? '',
      };
    }

    for (let callIndex = 0; callIndex < callsToExecute.length; callIndex += 1) {
      if (request.signal?.aborted) {
        return {
          ok: false,
          conversationId,
          novelId,
          chapterId,
          userGoal,
          toolCalls: toolCallsHistory,
          finalMessage: lastActionText ?? '',
          error: 'UPSTREAM_FAILURE: Main Agent execution was aborted',
          errorCode: 'UPSTREAM_FAILURE',
        };
      }

      const call = callsToExecute[callIndex];
      const invocationId = `main-agent-${conversationId}-${Date.now()}-${step}-${callIndex}`;
      const startTime = Date.now();
      const toolIdentity = `${call.name}@${call.version ?? '1'}`;

      let domainResult;
      if (!manifest.modelVisibleToolIdentities.includes(toolIdentity)) {
        domainResult = {
          ok: false,
          error: {
            code: 'PERMISSION_DENIED',
            message: `Canonical Tool ${toolIdentity} 尚未向 Main Agent 放行。`,
            retryable: false,
          },
          source: 'runtime' as const,
          storageMode: 'runtime' as const,
          warnings: [],
        };
      } else {
        try {
          domainResult = await executeCanonicalTool(
            {
              name: call.name,
              version: call.version ?? '1',
              argumentsJson: call.argumentsJson,
              expectedProjectionHash: manifest.projectionHash,
            },
            {
              invocationId,
              allowedTools: manifest.modelVisibleToolIdentities,
              novelId,
              chapterId,
              grantedPermissions: ['novel.read', 'chapter.read'],
              signal: request.signal,
            },
          );
        } catch (error) {
          domainResult = {
            ok: false,
            error: {
              code: 'UPSTREAM_FAILURE',
              message: sanitizeErrorMessage(error),
              retryable: false,
            },
            source: 'runtime' as const,
            storageMode: 'runtime' as const,
            warnings: [],
          };
        }
      }

      const durationMs = Math.max(1, Date.now() - startTime);
      const toolCallError = !domainResult.ok
        ? (domainResult as { error?: MainAgentError }).error
        : undefined;

      toolCallsHistory.push({
        name: call.name,
        version: call.version ?? '1',
        tool: toolIdentity,
        invocationId,
        argumentsJson: call.argumentsJson,
        result: domainResult,
        error: toolCallError,
        status: domainResult.ok ? 'completed' : 'failed',
        durationMs,
      });
    }

    step += 1;
  }

  return {
    ok: true,
    conversationId,
    novelId,
    chapterId,
    userGoal,
    toolCalls: toolCallsHistory,
    finalMessage:
      lastActionText ??
      synthesizeCreativeResponse(request.userGoal, novelId, chapterId, toolCallsHistory),
  };
}

/**
 * Host-side Main Agent scaffold.
 *
 * Production desktop read-intent turns go through DSH
 * (`taskSessionAdapter.startTurn` → `dsh_start_task_turn`) with the Canonical-only
 * tool allowlist. This heuristic executor is not R4 VERIFIED evidence of a live
 * DSH Agent session.
 */
export async function executeMainAgentTurn(
  request: MainAgentTurnRequest,
): Promise<MainAgentResult> {
  return executeMainAgent({
    conversationId: request?.conversationId ?? `conv-${Date.now()}`,
    novelId: request?.novelId,
    chapterId: request?.chapterId,
    userGoal: request?.userGoal,
    targetSnapshot: request?.targetSnapshot,
    modelSnapshot: request?.modelSnapshot,
    signal: request?.signal,
    maxSteps: request?.maxSteps,
    executor: request?.executor,
  });
}

export const mainAgentRuntimeService = {
  execute: executeMainAgent,
  executeMainAgentTurn,
};
