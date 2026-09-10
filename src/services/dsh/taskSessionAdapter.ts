import { isTauri } from '../database/db';
import {
  taskRuntimeAdapter,
  type TaskRuntimeEvent,
  type TaskRuntimeInput,
} from '../conversation/taskRuntimeAdapter';
import type { TaskModelSnapshot, TaskRun } from '../../types/conversation';
import {
  buildDshTaskStartContract,
  dshTaskRuntimeService,
  type DshTaskProjectionNotice,
} from './taskRuntimeService';
import { captureTaskModelSnapshot } from '../conversation/taskModelSnapshot';
import { taskConversationService } from '../conversation/taskConversationService';
import {
  assertTaskGoalExecutable,
  classifyTaskIntent,
  isConversationalGoal,
  selectCandidateTool,
} from '../conversation/taskGoalRouting';
import {
  isWritingSubAgentDshEnabled,
  planWritingSubAgentTurn,
  toDshTaskStartContract,
} from '../agents/writingSubAgentContract';
import { chapterRepository } from '../database/chapterRepository';
import { volumeRepository } from '../database/volumeRepository';
import { draftVersionService } from '../database/draftVersionService';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { findPreviousChapterForContinuity } from '../conversation/workbenchChapterWriter';
import { inspectChapterCandidateIntegrity } from '../generation/chapterCandidateIntegrity';
import { isDraftContentReady } from '../../types/draftContentState';

export const WORKBENCH_CONVERSATIONAL_REPLY =
  '我是创作工作台助手。你可以用自然语言让我读取作品上下文、检索记忆，或生成章节、大纲、角色、事件、设定候选，以及润色、质量检查和章节总结。候选不会直接写入正式正文，需要你确认后才会进入审阅或应用。问候和能力询问不会调用生成工具。';

/**
 * Stable ANS boundary for the pinned DSH headless carrier. Cordis/DSH objects
 * never cross this adapter; the workbench only sees task/session identifiers
 * and the event projection owned by ANS.
 */
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

const sessions = new Map<string, TaskSession>();

export function isActiveDshTaskRuntimeStatus(status: string): boolean {
  return (
    status === 'attesting' ||
    status === 'queued' ||
    status === 'running' ||
    status === 'cancel_requested'
  );
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

async function completeConversationalTurn(
  input: TaskRuntimeInput,
  onEvent?: (event: TaskRuntimeEvent) => void,
): Promise<TaskRun> {
  const modelSnapshot = captureLocalConversationalSnapshot();
  const run = await taskConversationService.createRun(
    input.conversationId,
    input.turnId,
    modelSnapshot,
    `worker-ans-local-${input.conversationId}`,
    input.chapterId,
  );
  const startedAt = new Date().toISOString();
  let currentRun = await taskConversationService.updateRun(run.runId, 'running', { startedAt });
  onEvent?.({ run: currentRun });
  await taskConversationService.appendTurn(
    input.conversationId,
    'assistant',
    WORKBENCH_CONVERSATIONAL_REPLY,
  );
  currentRun = await taskConversationService.updateRun(run.runId, 'completed', {
    finishedAt: new Date().toISOString(),
  });
  onEvent?.({ run: currentRun });
  return currentRun;
}

function sessionFor(input: TaskRuntimeInput): TaskSession {
  const existing = sessions.get(input.conversationId);
  if (existing) return existing;
  const createdAt = new Date().toISOString();
  const session: TaskSession = {
    sessionId: `session-${input.conversationId}`,
    conversationId: input.conversationId,
    agentId: `agent-${input.conversationId}`,
    workerId: `worker-${input.conversationId}`,
    runtime: isTauri() ? 'dsh-headless-persistent' : 'ans-provider-fallback',
    createdAt,
  };
  sessions.set(input.conversationId, session);
  return session;
}

/**
 * Candidate-only Writing SubAgent turn through DSH. The contract is planned and re-validated
 * here, then the Rust runtime re-validates it again (`validate_turn_contract`) and rejects
 * out-of-range chapter candidates before they become artifacts.
 */
async function startWritingSubAgentTurn(
  input: TaskRuntimeInput,
  onEvent?: (event: TaskRuntimeEvent) => void,
): Promise<TaskRun> {
  const chapterId = input.chapterId!;
  const chapter = await chapterRepository.getById(chapterId).catch(() => null);
  const contract = planWritingSubAgentTurn({
    novelId: input.novelId,
    chapterId,
    goal: input.goal,
    mode:
      selectCandidateTool(input.goal, chapterId)?.name === 'polish_chapter' ? 'polish' : 'generate',
    modelSnapshot: input.modelSnapshot ?? captureTaskModelSnapshot(),
    targetWordCount: chapter?.targetWordCount || undefined,
  });
  const result = await dshTaskRuntimeService.start(
    {
      ...input,
      ...toDshTaskStartContract(contract),
      modelSnapshot: contract.modelSnapshot,
    },
    (notice) => {
      void taskConversationService
        .get(input.conversationId, { hydrateArtifacts: false })
        .then((bundle) => {
          const run = bundle?.runs.find((item) => item.runId === notice.runId);
          if (run) onEvent?.({ run });
        });
    },
  );
  onEvent?.({ run: result.run });
  await reviewWritingSubAgentCandidate(input, chapterId, result.artifactId);
  return result.run;
}

/** Full adopted text of the immediately preceding chapter, or undefined when unavailable. */
async function loadPreviousAdoptedChapterText(
  novelId: string,
  chapterId: string,
): Promise<string | undefined> {
  try {
    const [chapters, volumes] = await Promise.all([
      chapterRepository.getByNovelId(novelId),
      volumeRepository.getByNovelId(novelId),
    ]);
    const previous = findPreviousChapterForContinuity(chapters, volumes, chapterId);
    if (!previous) return undefined;
    const draft = await draftVersionService.getAdoptedByChapterId(previous.id);
    if (!draft) return undefined;
    // Only a verified full body is good enough for boundary checks; previews would misfire.
    if (isDraftContentReady(draft.contentState)) return draft.contentState.content;
    if (draft.contentState) return undefined;
    return draft.content.trim() ? draft.content : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Gate E-2: the DSH host only checks scope and word range; the same integrity inspection the
 * deterministic writer applies (opening rollback, boundary repetition, meta leakage, …) runs
 * here on the persisted candidate. Findings are surfaced as an assistant turn so the user can
 * request a revision; the candidate itself is never altered or removed.
 */
async function reviewWritingSubAgentCandidate(
  input: TaskRuntimeInput,
  chapterId: string,
  artifactId: string | undefined,
): Promise<void> {
  if (!artifactId) return;
  try {
    const bundle = await aiTaskRuntimeService.getArtifact(artifactId);
    if (bundle.artifact.artifactType !== 'chapter_text') return;
    const candidateText = bundle.displayContent || bundle.rawContent;
    if (!candidateText.trim()) return;
    const issues = inspectChapterCandidateIntegrity({
      candidateText,
      previousChapterText: await loadPreviousAdoptedChapterText(input.novelId, chapterId),
    });
    const errors = issues.filter((issue) => issue.severity === 'error');
    if (errors.length === 0) return;
    await taskConversationService.appendTurn(
      input.conversationId,
      'assistant',
      `候选完整性检查发现 ${errors.length} 项需要处理的问题：${errors
        .map((issue) => `${issue.summary}（${issue.code}）`)
        .join('；')}。候选已保留供审阅，建议点击「要求修改」让模型重写。`,
    );
  } catch {
    // Integrity review is advisory; a failure here must not turn a persisted candidate into an error.
  }
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

  startTurn(
    input: TaskRuntimeInput,
    onEvent?: (event: TaskRuntimeEvent) => void,
  ): Promise<TaskRun> {
    try {
      assertTaskGoalExecutable(input.goal);
    } catch (error) {
      return Promise.reject(error);
    }
    if (isConversationalGoal(input.goal)) {
      return completeConversationalTurn(input, onEvent);
    }
    const session = sessionFor(input);
    const intent = classifyTaskIntent(input.goal);
    if (intent === 'chapter_write') {
      // Writing SubAgent (v3.7.0, Gate E-4 accepted): desktop + real API model + bound chapter
      // runs the candidate-only DSH turn; mock / local models, browser mode, unbound goals and an
      // explicit opt-out keep the deterministic ANS writer.
      if (
        isTauri() &&
        input.chapterId &&
        isWritingSubAgentDshEnabled({
          isTauri: true,
          modelRuntimeMode: (input.modelSnapshot ?? captureTaskModelSnapshot()).runtimeMode,
        })
      ) {
        return startWritingSubAgentTurn(input, onEvent);
      }
      return taskRuntimeAdapter.start({ ...input, workerId: session.workerId }, onEvent);
    }
    if (!isTauri()) {
      return taskRuntimeAdapter.start({ ...input, workerId: session.workerId }, onEvent);
    }
    if (isTauri()) {
      const contract = buildDshTaskStartContract(input.goal, input.chapterId);
      return dshTaskRuntimeService
        .start(
          {
            ...input,
            ...contract,
            modelSnapshot: input.modelSnapshot ?? captureTaskModelSnapshot(),
          },
          (notice) => {
            void taskConversationService
              .get(input.conversationId, { hydrateArtifacts: false })
              .then((bundle) => {
                const run = bundle?.runs.find((item) => item.runId === notice.runId);
                if (run) onEvent?.({ run });
              });
          },
        )
        .then((result) => {
          onEvent?.({ run: result.run });
          return result.run;
        });
    }
    return taskRuntimeAdapter.start({ ...input, workerId: session.workerId }, onEvent);
  },

  async cancel(conversationId: string): Promise<boolean> {
    if (taskRuntimeAdapter.isRunning(conversationId)) {
      return taskRuntimeAdapter.cancel(conversationId);
    }
    if (isTauri()) {
      // A WebView reload clears the renderer-local active Set while the Rust
      // worker remains alive. Always ask the process-authoritative runtime.
      const status = await dshTaskRuntimeService.cancel(conversationId);
      return status.status === 'cancel_requested';
    }
    return false;
  },

  subscribeToRuntimeProjections(
    onProjection: (notice: DshTaskProjectionNotice) => void,
  ): Promise<() => void> {
    if (!isTauri()) return Promise.resolve(() => undefined);
    return dshTaskRuntimeService.subscribe(onProjection);
  },

  async isRunningAuthoritatively(conversationId: string): Promise<boolean> {
    if (taskRuntimeAdapter.isRunning(conversationId)) return true;
    if (!isTauri()) return false;
    const status = await dshTaskRuntimeService.getStatus(conversationId);
    return Boolean(status && isActiveDshTaskRuntimeStatus(status.status));
  },

  isRunning(conversationId: string): boolean {
    return (
      taskRuntimeAdapter.isRunning(conversationId) ||
      (isTauri() && dshTaskRuntimeService.isRunning(conversationId))
    );
  },

  async listRunningConversationIds(): Promise<string[]> {
    const ids = new Set(taskRuntimeAdapter.listRunningConversationIds());
    if (isTauri()) {
      const statuses = await dshTaskRuntimeService.listStatuses();
      statuses
        .filter((item) => isActiveDshTaskRuntimeStatus(item.status))
        .forEach((item) => ids.add(item.conversationId));
    }
    return [...ids];
  },

  clear(conversationId: string): void {
    sessions.delete(conversationId);
  },
};
