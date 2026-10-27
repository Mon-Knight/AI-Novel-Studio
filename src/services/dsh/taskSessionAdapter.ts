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
} from './taskRuntimeService';
import { captureTaskModelSnapshot } from '../conversation/taskModelSnapshot';
import { taskConversationService } from '../conversation/taskConversationService';
import { verifyArtifactRevisionSource } from '../conversation/artifactRevisionSourceService';
import { observeTurnRunProjection } from '../conversation/turnRunProjection';
import {
  assertTaskGoalExecutable,
  classifyTaskIntent,
  isConversationalGoal,
  buildCreativeWorkflowContract,
  type CreativePlannedAction,
} from '../conversation/taskGoalRouting';
import { runHostGatedChapterTurn } from '../agents/writingSubAgentChapterGate';
import { selectChapterWriteHost } from './chapterWriteRoute';
import { chapterRepository } from '../database/chapterRepository';
import { volumeRepository } from '../database/volumeRepository';
import { draftVersionService } from '../database/draftVersionService';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { findPreviousChapterForContinuity } from '../conversation/workbenchChapterWriter';
import {
  getChapterWordRangePercents,
  resolveChapterWordRange,
} from '../conversation/chapterWordRangePolicy';
import { isTaskWordTargetSetting, parseTaskWordTarget } from '../conversation/taskWordTarget';
import {
  inspectChapterCandidateIntegrity,
  buildChapterCandidateIntegrityReview,
  formatChapterCandidateIntegrityReview,
  type ChapterCandidateIntegrityReview,
} from '../generation/chapterCandidateIntegrity';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { isDraftContentReady } from '../../types/draftContentState';
import { restoreDshRetry } from './taskRetryRecovery';

export const WORKBENCH_CONVERSATIONAL_REPLY =
  '我是创作工作台助手。你可以用自然语言让我读取作品上下文、检索记忆，或生成章节、大纲、角色、事件、设定候选，以及润色、质量检查和章节总结。候选不会直接写入正式正文，需要你确认后才会进入审阅或应用。可直接说“本任务目标字数设为3200字”设置后续每章目标，或说“生成下一章，目标3200字”仅覆盖本次。问候、能力询问与单独设置字数不会调用生成工具。';

/** Stable ANS boundary: only task/session identities and public events cross this adapter. */
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
const dialogueChains = new Map<string, { cancelled: boolean; controller: AbortController }>();

/** Explicit settings and exact revision sources retain their existing local/authorized lanes. */
export function isModelLedCreativeTurn(
  input: Pick<
    TaskRuntimeInput,
    'goal' | 'modelSnapshot' | 'revisionSource' | 'workflowAction' | 'retryExecution'
  >,
): boolean {
  return (
    isTauri() &&
    (input.modelSnapshot ?? captureTaskModelSnapshot()).runtimeMode === 'api' &&
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
  if (!directives[action.action] || !action.instruction?.trim()) {
    throw new Error('创作工具请求缺少有效动作或说明。');
  }
  return `${directives[action.action]}\n${action.instruction}`;
}

/** Internal renderer callbacks and workflow selectors never cross the native boundary. */
function runtimeInput(input: TaskRuntimeInput) {
  const { preparePlannedAction, workflowAction, retryExecution, ...request } = input;
  void preparePlannedAction;
  void workflowAction;
  void retryExecution;
  return request;
}

async function startCreativeDialogue(
  input: TaskRuntimeInput,
  onEvent?: (event: TaskRuntimeEvent) => void,
): Promise<TaskRun> {
  if (dialogueChains.has(input.conversationId)) {
    throw new Error('当前对话仍在执行，不能重复发送。');
  }
  const chain = { cancelled: false, controller: new AbortController() };
  dialogueChains.set(input.conversationId, chain);
  try {
    const result = await dshTaskRuntimeService.start(
      {
        ...runtimeInput(input),
        cancellationSignal: chain.controller.signal,
        modelSnapshot: input.modelSnapshot ?? captureTaskModelSnapshot(),
        taskKind: 'creative_dialogue',
        requiredReadTools: [],
        allowedTools: CREATIVE_DIALOGUE_ALLOWED_TOOLS,
      },
      (notice) =>
        observeTurnRunProjection(input.conversationId, input.turnId, notice.runId, onEvent),
    );
    onEvent?.({ run: result.run });
    if (chain.cancelled || result.run.status !== 'completed' || !result.plannedAction)
      return result.run;
    const action = result.plannedAction;
    // Validate the enum before invoking any renderer preparation callback.
    buildCreativeWorkflowContract(action.action, action.chapterId);
    const target = input.preparePlannedAction
      ? await input.preparePlannedAction(action)
      : {
          chapterId:
            action.chapterId ??
            ([
              'generate_chapter',
              'polish_chapter',
              'summarize_chapter',
              'check_quality',
              'suggest_events',
            ].includes(action.action)
              ? input.chapterId
              : undefined),
        };
    if (chain.cancelled || !target) return result.run;
    if (
      [
        'generate_chapter',
        'polish_chapter',
        'summarize_chapter',
        'check_quality',
        'suggest_events',
      ].includes(action.action) &&
      !target.chapterId
    ) {
      throw new Error('创作工具需要一个已确认的目标章节，请先确定章节。');
    }
    return await taskSessionAdapter.startTurn(
      {
        ...input,
        chapterId: target.chapterId,
        goal: creativeWorkflowGoal(action),
        workflowAction: action.action,
        retrySourceRunId: undefined,
        retryExecution: undefined,
        cancellationSignal: chain.controller.signal,
        preparePlannedAction: undefined,
      },
      onEvent,
    );
  } finally {
    if (dialogueChains.get(input.conversationId) === chain)
      dialogueChains.delete(input.conversationId);
  }
}

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
  const target = parseTaskWordTarget(input.goal);
  const wordRange = target && resolveChapterWordRange(target.target, getChapterWordRangePercents());
  const reply =
    target?.settingOnly && wordRange
      ? `已将本任务每章目标字数设为 ${target.target} 字（当前候选硬区间 ${wordRange.hardMinimum}～${wordRange.hardMaximum} 字）。仅对本任务后续写章生效，未修改章节卡片、未调用模型、未生成或采用正文。接下来可发送“生成下一章”；仅本次覆盖可发送“生成下一章，目标3200字”。`
      : WORKBENCH_CONVERSATIONAL_REPLY;
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
  return runHostGatedChapterTurn(input, onEvent, reviewWritingSubAgentCandidate);
}

interface PreviousChapterReviewContext {
  status: ChapterCandidateIntegrityReview['checks']['previousChapterBoundary'];
  text?: string;
  reason?: string;
}

/** Missing text, failed reads and a first chapter are distinct review states. */
async function loadPreviousAdoptedChapterText(
  novelId: string,
  chapterId: string,
): Promise<PreviousChapterReviewContext> {
  try {
    const [chapters, volumes] = await Promise.all([
      chapterRepository.getByNovelId(novelId),
      volumeRepository.getByNovelId(novelId),
    ]);
    if (!chapters.some((chapter) => chapter.id === chapterId && chapter.novelId === novelId)) {
      return { status: 'not_checked', reason: '章节顺序或作品作用域不可验证。' };
    }
    const previous = findPreviousChapterForContinuity(chapters, volumes, chapterId);
    if (!previous) return { status: 'not_applicable' };
    const draft = await draftVersionService.getAdoptedByChapterId(previous.id);
    if (!draft || !draft.isAdopted || draft.chapterId !== previous.id) {
      return { status: 'not_checked', reason: '紧邻前章缺少已采用正文。' };
    }
    // Previews or failed hydration must never be used for boundary checks.
    if (draft.contentState && !isDraftContentReady(draft.contentState)) {
      return { status: 'not_checked', reason: '前章正文未完整读取或完整性校验未完成。' };
    }
    const content = isDraftContentReady(draft.contentState)
      ? draft.contentState.content
      : draft.content;
    if (!content.trim()) return { status: 'not_checked', reason: '前章采用稿为空。' };
    if (
      isDraftContentReady(draft.contentState) &&
      (await computeContentSha256(content)) !== draft.contentState.contentHash.toLowerCase()
    ) {
      return { status: 'not_checked', reason: '前章采用稿哈希不一致。' };
    }
    return { status: 'checked', text: content };
  } catch {
    return { status: 'not_checked', reason: '前章正文复核读取失败。' };
  }
}

/** Advisory finite text checks never change or adopt the persisted candidate. */
async function reviewWritingSubAgentCandidate(
  input: TaskRuntimeInput,
  chapterId: string,
  artifactId: string | undefined,
): Promise<void> {
  if (!artifactId) return;
  const scope = { novelId: input.novelId, chapterId, artifactId };
  let review: ChapterCandidateIntegrityReview;
  try {
    const bundle = await aiTaskRuntimeService.getArtifact(artifactId);
    const artifact = bundle.artifact;
    if (
      artifact.artifactId !== artifactId ||
      artifact.artifactType !== 'chapter_text' ||
      artifact.sourceNovelId !== input.novelId ||
      artifact.sourceChapterId !== chapterId
    ) {
      throw new Error('candidate scope mismatch');
    }
    const candidateText = bundle.displayContent ?? bundle.rawContent;
    const expectedHash =
      typeof bundle.displayContent === 'string'
        ? artifact.displayContentHash
        : artifact.contentHash;
    const candidateHash = await computeContentSha256(candidateText);
    if (!candidateText.trim() || !expectedHash || candidateHash !== expectedHash.toLowerCase()) {
      throw new Error('candidate content unavailable or hash mismatch');
    }
    const previous = await loadPreviousAdoptedChapterText(input.novelId, chapterId);
    review = buildChapterCandidateIntegrityReview({
      scope: { ...scope, candidateHash },
      issues: inspectChapterCandidateIntegrity({
        candidateText,
        previousChapterText: previous.text,
      }),
      previousChapterBoundary: previous.status,
      // Host context-coverage admission and these text heuristics are separate evidence.
      // Do not infer full rule coverage from successful tools or a structurally valid artifact.
      unavailableReasons: previous.reason ? [previous.reason] : [],
    });
  } catch {
    review = buildChapterCandidateIntegrityReview({
      scope,
      unavailableReasons: ['候选读取、作用域或哈希复核未完成；不是语义检查通过。'],
    });
  }
  await taskConversationService.appendTurn(
    input.conversationId,
    'assistant',
    formatChapterCandidateIntegrityReview(review),
  );
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
    if (isTauri() && input.retrySourceRunId) input = await restoreDshRetry(input);
    if (isModelLedCreativeTurn(input)) return startCreativeDialogue(input, onEvent);
    const { goal, chapterId, revisionSource } = input;
    if (revisionSource) await verifyArtifactRevisionSource(input);
    if (!input.workflowAction) assertTaskGoalExecutable(goal, revisionSource);
    if (!input.workflowAction && isConversationalGoal(input.goal)) {
      return completeConversationalTurn(input, onEvent);
    }
    const session = sessionFor(input);
    const intent = input.workflowAction
      ? ['generate_chapter', 'polish_chapter'].includes(input.workflowAction)
        ? 'chapter_write'
        : 'structured_write'
      : classifyTaskIntent(goal, revisionSource);
    if (intent === 'chapter_write') {
      const host = await selectChapterWriteHost({
        novelId: input.novelId,
        chapterId: input.chapterId,
        retrySourceRunId: input.retrySourceRunId,
        revisionSource: input.revisionSource,
        workflowAction: input.workflowAction,
        modelSnapshot: input.modelSnapshot ?? captureTaskModelSnapshot(),
      });
      if (host === 'dsh') return startWritingSubAgentTurn(input, onEvent);
      return taskRuntimeAdapter.start({ ...input, workerId: session.workerId }, onEvent);
    }
    if (!isTauri()) {
      return taskRuntimeAdapter.start({ ...input, workerId: session.workerId }, onEvent);
    }
    if (isTauri()) {
      const contract =
        input.retryExecution ??
        (input.workflowAction
          ? buildCreativeWorkflowContract(input.workflowAction, input.chapterId)
          : buildDshTaskStartContract(goal, chapterId, revisionSource));
      return dshTaskRuntimeService
        .start(
          {
            ...runtimeInput(input),
            ...contract,
            modelSnapshot: input.modelSnapshot ?? captureTaskModelSnapshot(),
          },
          (notice) =>
            observeTurnRunProjection(input.conversationId, input.turnId, notice.runId, onEvent),
        )
        .then((result) => {
          onEvent?.({ run: result.run });
          return result.run;
        });
    }
    return taskRuntimeAdapter.start({ ...input, workerId: session.workerId }, onEvent);
  },

  async cancel(conversationId: string): Promise<boolean> {
    const chain = dialogueChains.get(conversationId);
    if (chain) {
      chain.cancelled = true;
      chain.controller.abort();
    }
    if (taskRuntimeAdapter.isRunning(conversationId)) {
      return taskRuntimeAdapter.cancel(conversationId);
    }
    if (isTauri()) {
      // A WebView reload clears the renderer-local active Set while the Rust
      // worker remains alive. Always ask the process-authoritative runtime.
      const status = await dshTaskRuntimeService.cancel(conversationId);
      return status.status === 'cancel_requested' || Boolean(chain);
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
    if (dialogueChains.has(conversationId)) return true;
    if (taskRuntimeAdapter.isRunning(conversationId)) return true;
    if (!isTauri()) return false;
    const status = await dshTaskRuntimeService.getStatus(conversationId);
    return Boolean(status && isActiveDshTaskRuntimeStatus(status.status));
  },

  isRunning(conversationId: string): boolean {
    return (
      dialogueChains.has(conversationId) ||
      taskRuntimeAdapter.isRunning(conversationId) ||
      (isTauri() && dshTaskRuntimeService.isRunning(conversationId))
    );
  },

  async listRunningConversationIds(): Promise<string[]> {
    const ids = new Set(taskRuntimeAdapter.listRunningConversationIds());
    dialogueChains.forEach((_chain, id) => ids.add(id));
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
