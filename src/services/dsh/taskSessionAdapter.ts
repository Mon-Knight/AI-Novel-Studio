import { isTauri } from '../database/db';
import {
  taskRuntimeAdapter,
  type TaskRuntimeEvent,
  type TaskRuntimeInput,
} from '../conversation/taskRuntimeAdapter';
import type { TaskModelSnapshot, TaskRun } from '../../types/conversation';
import {
  buildDshTaskStartContract,
  CREATIVE_DIALOGUE_ALLOWED_TOOLS,
  dshTaskRuntimeService,
  type DshTaskProjectionNotice,
  type DshTaskRuntimeInput,
} from './taskRuntimeService';
import { captureTaskModelSnapshot } from '../conversation/taskModelSnapshot';
import { taskConversationService } from '../conversation/taskConversationService';
import { verifyArtifactRevisionSource } from '../conversation/artifactRevisionSourceService';
import { observeTurnRunProjection } from '../conversation/turnRunProjection';
import {
  assertTaskGoalExecutable,
  isConversationalGoal,
  buildCreativeWorkflowContract,
  type CreativePlannedAction,
} from '../conversation/taskGoalRouting';
import {
  getChapterWordRangePercents,
  resolveChapterWordRange,
} from '../conversation/chapterWordRangePolicy';
import { isTaskWordTargetSetting, parseTaskWordTarget } from '../conversation/taskWordTarget';
import { restoreDshRetry } from './taskRetryRecovery';
import { planWritingSubAgentTurn, toDshTaskStartContract } from '../agents/writingSubAgentContract';

export const WORKBENCH_CONVERSATIONAL_REPLY =
  '我是创作工作台助手。你可以用自然语言让我读取作品上下文、检索记忆，或生成章节、大纲、角色、事件、设定候选，以及润色、质量检查和章节总结。候选不会直接写入正式正文，需要你确认后才会进入审阅或应用。可直接说“本任务目标字数设为3200字”设置后续每章目标，或说“生成下一章，目标3200字”仅覆盖本次。问候、能力询问与单独设置字数不会调用生成工具。';

/** Stable ANS boundary; the pinned carrier is not upgraded by lifecycle convergence. */
export const DSH_SOURCE_COMMIT = '47f943859bef60e4160492346772ded9b24f765a';
export const DSH_REFERENCE_COMMIT = '141eb6fef83422698aef7a981029e843e8161534';

export interface TaskSession {
  sessionId: string;
  conversationId: string;
  agentId: string;
  workerId: string;
  runtime: 'dsh-headless-persistent' | 'ans-provider-fallback';
  createdAt: string;
}

// Session identity projection only. Native code owns active state, phases and children.
const sessions = new Map<string, TaskSession>();

/** All desktop models enter the same model-led host. This is not a Provider router. */
export function isModelLedCreativeTurn(
  input: Pick<
    TaskRuntimeInput,
    'goal' | 'modelSnapshot' | 'revisionSource' | 'workflowAction' | 'retryExecution'
  >,
): boolean {
  return (
    isTauri() &&
    !input.revisionSource &&
    !input.workflowAction &&
    (!input.retryExecution || input.retryExecution.taskKind === 'creative_dialogue') &&
    !isTaskWordTargetSetting(input.goal)
  );
}

export function creativeWorkflowGoal(action: CreativePlannedAction): string {
  const directives: Record<CreativePlannedAction['action'], string> = {
    prepare_settings: '生成世界与规则设定候选',
    prepare_characters: '生成主角候选',
    generate_outline: action.chapterId ? '生成本章大纲候选' : '生成全书规划候选',
    generate_chapter: '生成本章正文',
    polish_chapter: '润色本章正文',
    summarize_chapter: '总结本章',
    check_quality: '检查本章质量',
    suggest_events: '生成本章事件候选',
  };
  if (
    !Object.prototype.hasOwnProperty.call(directives, action.action) ||
    !action.instruction?.trim()
  ) {
    throw new Error('创作工具请求缺少有效动作或说明。');
  }
  return `${directives[action.action]}\n${action.instruction}`;
}

export function isActiveDshTaskRuntimeStatus(status: string): boolean {
  return ['attesting', 'queued', 'running', 'cancel_requested'].includes(status);
}

export function captureLocalConversationalSnapshot(): TaskModelSnapshot {
  return {
    providerId: 'ans-local',
    modelId: 'workbench-help-v1',
    runtimeMode: 'mock',
    capabilities: ['conversation_turn'],
    options: {},
    runtime: {
      adapterProtocol: 'ans_local_conversation_v1',
      adapterProvider: 'ans-local',
      bundle: 'application',
      profile: 'workbench-local-help-v1',
    },
    capturedAt: new Date().toISOString(),
  };
}

/** Restricted browser development response; desktop local commands remain native executions. */
async function completeBrowserConversationalTurn(
  input: TaskRuntimeInput,
  onEvent?: (event: TaskRuntimeEvent) => void,
): Promise<TaskRun> {
  const target = parseTaskWordTarget(input.goal);
  const wordRange = target && resolveChapterWordRange(target.target, getChapterWordRangePercents());
  const reply =
    target?.settingOnly && wordRange
      ? `已将本任务每章目标字数设为 ${target.target} 字（当前候选硬区间 ${wordRange.hardMinimum}～${wordRange.hardMaximum} 字）。仅对本任务后续写章生效，未修改章节卡片、未调用模型、未生成或采用正文。接下来可发送“生成下一章”；仅本次覆盖可发送“生成下一章，目标3200字”。`
      : WORKBENCH_CONVERSATIONAL_REPLY;
  const run = await taskConversationService.createRun(
    input.conversationId,
    input.turnId,
    captureLocalConversationalSnapshot(),
    `worker-ans-local-${input.conversationId}`,
    input.chapterId,
  );
  let currentRun = await taskConversationService.updateRun(run.runId, 'running', {
    startedAt: new Date().toISOString(),
  });
  onEvent?.({ run: currentRun });
  await taskConversationService.appendTurn(input.conversationId, 'assistant', reply);
  currentRun = await taskConversationService.updateRun(run.runId, 'completed', {
    finishedAt: new Date().toISOString(),
  });
  onEvent?.({ run: currentRun });
  return currentRun;
}

function sessionFor(input: TaskRuntimeInput): TaskSession {
  const existing = sessions.get(input.conversationId);
  if (existing) return existing;
  const session: TaskSession = {
    sessionId: `session-${input.conversationId}`,
    conversationId: input.conversationId,
    agentId: `agent-${input.conversationId}`,
    workerId: `worker-${input.conversationId}`,
    runtime: isTauri() ? 'dsh-headless-persistent' : 'ans-provider-fallback',
    createdAt: new Date().toISOString(),
  };
  sessions.set(input.conversationId, session);
  return session;
}

/**
 * One desktop request, including master planning, child writing and candidate admission.
 * Renderer callbacks, Provider mode and applied plans cannot select another lifecycle.
 * Native code revalidates the persisted user turn, model, scope and phase at dispatch.
 */
export function buildDesktopTaskRuntimeInput(input: TaskRuntimeInput): DshTaskRuntimeInput {
  const novelId = input.novelId;
  const wordRangePercents = getChapterWordRangePercents();
  const parsedTarget = parseTaskWordTarget(input.goal);
  const wordRange = parsedTarget && resolveChapterWordRange(parsedTarget.target, wordRangePercents);
  const modelSnapshot = input.modelSnapshot ?? captureTaskModelSnapshot();
  const writing =
    input.workflowAction === 'generate_chapter' ||
    input.workflowAction === 'polish_chapter' ||
    input.revisionSource?.artifactType === 'chapter_text';
  const writingContract =
    writing && input.chapterId && novelId
      ? toDshTaskStartContract(
          planWritingSubAgentTurn({
            novelId,
            chapterId: input.chapterId,
            goal: input.goal,
            mode:
              input.workflowAction === 'generate_chapter' && !input.revisionSource
                ? 'generate'
                : 'polish',
            modelSnapshot,
            targetWordCount: parsedTarget?.target,
            wordRangePercents,
            ...(input.revisionSource ? { revisionSource: input.revisionSource } : {}),
          }),
        )
      : undefined;
  const explicitContract =
    input.retryExecution ??
    writingContract ??
    (input.workflowAction
      ? buildCreativeWorkflowContract(input.workflowAction, input.chapterId)
      : input.revisionSource
        ? buildDshTaskStartContract(input.goal, input.chapterId, input.revisionSource)
        : undefined);
  return {
    conversationId: input.conversationId,
    ...(novelId ? { novelId } : {}),
    turnId: input.turnId,
    chapterId: input.chapterId,
    goal: input.goal,
    modelSnapshot,
    cancellationSignal: input.cancellationSignal,
    ...(input.retrySourceRunId ? { retrySourceRunId: input.retrySourceRunId } : {}),
    ...(input.revisionSource ? { revisionSource: input.revisionSource } : {}),
    ...(explicitContract ?? {
      taskKind: 'creative_dialogue' as const,
      requiredReadTools: [],
      allowedTools: CREATIVE_DIALOGUE_ALLOWED_TOOLS,
    }),
    unifiedRuntime: {
      version: 1,
      ...(input.domainEntry ? { entry: input.domainEntry } : {}),
      writingPreferences: {
        ...(parsedTarget ? { targetWordCount: parsedTarget.target } : {}),
        wordRangePercents,
      },
      ...(parsedTarget?.settingOnly && wordRange
        ? {
            localCommand: {
              kind: 'task_word_target' as const,
              targetWordCount: parsedTarget.target,
              wordRange: {
                target: wordRange.target,
                minimum: wordRange.hardMinimum,
                maximum: wordRange.hardMaximum,
              },
            },
          }
        : {}),
    },
  };
}

export const taskSessionAdapter = {
  describeRuntime() {
    return {
      sourceCommit: DSH_SOURCE_COMMIT,
      referenceCommit: DSH_REFERENCE_COMMIT,
      protocol: 'ans_task_session_v2',
      bundle: 'scripts/dsh/build-runtime-payload.mjs',
      isolation: 'one-persistent-worker-per-task',
      status: isTauri() ? ('loaded' as const) : ('unavailable' as const),
    };
  },

  getSession(input: TaskRuntimeInput): TaskSession {
    return sessionFor(input);
  },

  async startTurn(
    input: TaskRuntimeInput,
    onEvent?: (event: TaskRuntimeEvent) => void,
  ): Promise<TaskRun> {
    input.cancellationSignal?.throwIfAborted();
    if (isTauri()) {
      if (input.retrySourceRunId) input = await restoreDshRetry(input);
      if (input.revisionSource) {
        if (!input.novelId) throw new Error('DSH_NOVEL_SCOPE_REQUIRED: 章节修订必须绑定明确作品。');
        await verifyArtifactRevisionSource({ ...input, novelId: input.novelId });
        assertTaskGoalExecutable(input.goal, input.revisionSource);
      }
      input.cancellationSignal?.throwIfAborted();
      const result = await dshTaskRuntimeService.start(
        buildDesktopTaskRuntimeInput(input),
        (notice) =>
          observeTurnRunProjection(input.conversationId, input.turnId, notice.runId, onEvent),
      );
      if (result.plannedAction || result.pendingChapterCandidate) {
        throw new Error(
          'DSH_UNIFIED_RUNTIME_INCOMPLETE: 原生任务尚未完成阶段交接或候选准入，渲染进程不会另起工作流。',
        );
      }
      if (result.run.conversationId !== input.conversationId) {
        throw new Error('DSH_TASK_SCOPE_MISMATCH: 原生运行回执不属于当前任务。');
      }
      onEvent?.({ run: result.run });
      return result.run;
    }
    // Browser compatibility is deliberately not desktop-equivalent verification.
    if (input.revisionSource) {
      if (!input.novelId)
        throw new Error('DSH_NOVEL_SCOPE_REQUIRED: 浏览器章节修订必须绑定明确作品。');
      await verifyArtifactRevisionSource({ ...input, novelId: input.novelId });
    }
    assertTaskGoalExecutable(input.goal, input.revisionSource);
    if (isConversationalGoal(input.goal)) return completeBrowserConversationalTurn(input, onEvent);
    return taskRuntimeAdapter.start({ ...input, workerId: sessionFor(input).workerId }, onEvent);
  },

  async cancel(conversationId: string): Promise<boolean> {
    if (isTauri()) {
      const status = await dshTaskRuntimeService.cancel(conversationId);
      // Acceptance can halt a parked task's future stages while keeping its
      // completed Run and committed receipts unchanged. Idle alone is not proof.
      return (
        status.status === 'cancel_requested' ||
        (status.status === 'idle' && status.error?.startsWith('DSH_TASK_CANCELLED:') === true)
      );
    }
    return taskRuntimeAdapter.cancel(conversationId);
  },

  subscribeToRuntimeProjections(
    onProjection: (notice: DshTaskProjectionNotice) => void,
  ): Promise<() => void> {
    return isTauri()
      ? dshTaskRuntimeService.subscribe(onProjection)
      : Promise.resolve(() => undefined);
  },

  async isRunningAuthoritatively(conversationId: string): Promise<boolean> {
    if (!isTauri()) return taskRuntimeAdapter.isRunning(conversationId);
    if (dshTaskRuntimeService.isRunning(conversationId)) return true;
    const status = await dshTaskRuntimeService.getStatus(conversationId);
    return Boolean(status && isActiveDshTaskRuntimeStatus(status.status));
  },

  isRunning(conversationId: string): boolean {
    return isTauri()
      ? dshTaskRuntimeService.isRunning(conversationId)
      : taskRuntimeAdapter.isRunning(conversationId);
  },

  async listRunningConversationIds(): Promise<string[]> {
    if (!isTauri()) return taskRuntimeAdapter.listRunningConversationIds();
    const ids = new Set(dshTaskRuntimeService.listInFlightConversationIds());
    for (const status of await dshTaskRuntimeService.listStatuses()) {
      if (isActiveDshTaskRuntimeStatus(status.status)) ids.add(status.conversationId);
    }
    return [...ids];
  },

  clear(conversationId: string): void {
    sessions.delete(conversationId);
  },
};
