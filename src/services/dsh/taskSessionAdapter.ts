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
import {
  getChapterWordRangePercents,
  resolveChapterWordRange,
} from '../conversation/chapterWordRangePolicy';
import { parseTaskWordTarget } from '../conversation/taskWordTarget';
import { prepareTaskWritingPreferences } from '../conversation/taskWritingPreferences';
import {
  inspectChapterCandidateIntegrity,
  buildChapterCandidateIntegrityReview,
  formatChapterCandidateIntegrityReview,
  type ChapterCandidateIntegrityReview,
} from '../generation/chapterCandidateIntegrity';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { verifyArtifactRevisionSource } from '../conversation/artifactRevisionSourceService';
import { isDraftContentReady } from '../../types/draftContentState';

export const WORKBENCH_CONVERSATIONAL_REPLY =
  '我是创作工作台助手。你可以用自然语言让我读取作品上下文、检索记忆，或生成章节、大纲、角色、事件、设定候选，以及润色、质量检查和章节总结。候选不会直接写入正式正文，需要你确认后才会进入审阅或应用。可直接说“本任务目标字数设为3200字”设置后续每章目标，或说“生成下一章，目标3200字”仅覆盖本次。问候、能力询问与单独设置字数不会调用生成工具。';

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
  const chapterId = input.chapterId!;
  const chapter = await chapterRepository.getById(chapterId);
  if (!chapter || chapter.novelId !== input.novelId) {
    throw new Error('目标章节不存在或不属于当前作品。');
  }
  const preferences = await prepareTaskWritingPreferences(input);
  const revision = await verifyArtifactRevisionSource(input);
  const contract = planWritingSubAgentTurn({
    novelId: input.novelId,
    chapterId,
    goal: input.goal,
    mode:
      selectCandidateTool(input.goal, chapterId)?.name === 'polish_chapter' ? 'polish' : 'generate',
    modelSnapshot: input.modelSnapshot ?? captureTaskModelSnapshot(),
    targetWordCount: preferences.targetWordCount ?? (chapter?.targetWordCount || undefined),
    wordRangePercents: getChapterWordRangePercents(),
  });
  const result = await dshTaskRuntimeService.start(
    {
      ...input,
      ...toDshTaskStartContract(contract),
      revisionSource: revision?.source,
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
