import type { Chapter } from '../../types/chapter';
import type { ChapterSummary } from '../../types/chapterSummary';
import type {
  ArtifactDecision,
  ConversationArtifactCard,
  ReviewAuthorization,
  TaskConversationBundle,
  TaskRun,
} from '../../types/conversation';

export type ChapterSummaryOrchestrationPhase =
  | 'none'
  | 'ensure_turn'
  | 'ready_to_start'
  | 'awaiting_credentials'
  | 'generating'
  | 'awaiting_apply'
  | 'revision_requested'
  | 'rejected'
  | 'conflict'
  | 'failed'
  | 'resolving_next'
  | 'next_ready'
  | 'story_complete';

export interface ChapterSummaryOrchestrationState {
  phase: ChapterSummaryOrchestrationPhase;
  authorizationId?: string;
  chapterId?: string;
  adoptedDraftId?: string;
  turnId?: string;
  runId?: string;
  cardId?: string;
  nextChapterId?: string;
}

export interface ChapterSummaryNextTarget {
  status: 'advanced' | 'complete';
  chapterId?: string;
}

export interface ResolveChapterSummaryOrchestrationInput {
  bundle: TaskConversationBundle;
  chapters: readonly Chapter[];
  summaries: readonly ChapterSummary[];
  credentialAvailable?: boolean;
  nextTarget?: ChapterSummaryNextTarget;
}

const ACTIVE_RUN_STATUSES = new Set(['queued', 'running', 'cancel_requested']);
const VALID_ARTIFACT_STATUSES = new Set(['valid', 'valid_with_warnings']);

export function chapterSummaryTurnId(authorizationId: string): string {
  return `summary-generation-${authorizationId}`;
}

function timeValue(value?: string): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasMatchingSummary(
  authorization: ReviewAuthorization,
  summaries: readonly ChapterSummary[],
): boolean {
  return summaries.some(
    (summary) =>
      summary.novelId === authorization.novelId &&
      summary.chapterId === authorization.chapterId &&
      summary.adoptedDraftId === authorization.consumedByDraftId &&
      summary.enabled &&
      !summary.isExpired,
  );
}

function pendingOrLatestConsumedAuthorization(
  bundle: TaskConversationBundle,
  chapters: readonly Chapter[],
  summaries: readonly ChapterSummary[],
): ReviewAuthorization | undefined {
  const chapterOrder = new Map(chapters.map((chapter, index) => [chapter.id, index]));
  const matching = [...(bundle.authorizations ?? [])].filter((authorization) => {
    if (authorization.status !== 'consumed' || !authorization.consumedByDraftId) return false;
    const chapter = chapters.find((item) => item.id === authorization.chapterId);
    return (
      chapter?.novelId === authorization.novelId &&
      chapter.adoptedDraftId === authorization.consumedByDraftId
    );
  });
  const pending = matching
    .filter((authorization) => !hasMatchingSummary(authorization, summaries))
    .sort(
      (left, right) =>
        (chapterOrder.get(left.chapterId) ?? Number.MAX_SAFE_INTEGER) -
          (chapterOrder.get(right.chapterId) ?? Number.MAX_SAFE_INTEGER) ||
        timeValue(right.consumedAt ?? right.issuedAt) -
          timeValue(left.consumedAt ?? left.issuedAt) ||
        right.authorizationId.localeCompare(left.authorizationId),
    );
  if (pending[0]) return pending[0];
  return matching.sort(
    (left, right) =>
      timeValue(right.consumedAt ?? right.issuedAt) - timeValue(left.consumedAt ?? left.issuedAt) ||
      right.authorizationId.localeCompare(left.authorizationId),
  )[0];
}

function latestRun(runs: readonly TaskRun[]): TaskRun | undefined {
  return [...runs].sort(
    (left, right) =>
      timeValue(left.createdAt) - timeValue(right.createdAt) ||
      left.runId.localeCompare(right.runId),
  )[runs.length - 1];
}

function latestDecision(
  bundle: TaskConversationBundle,
  card: ConversationArtifactCard,
): ArtifactDecision | undefined {
  if (card.latestDecision) return card.latestDecision;
  const decisions = [...(bundle.decisions ?? [])]
    .filter(
      (decision) =>
        decision.cardId === card.cardId ||
        (Boolean(card.artifactId) && decision.artifactId === card.artifactId),
    )
    .sort(
      (left, right) =>
        timeValue(left.createdAt) - timeValue(right.createdAt) ||
        left.decisionId.localeCompare(right.decisionId),
    );
  return decisions[decisions.length - 1];
}

function validSummaryCard(
  bundle: TaskConversationBundle,
  run: TaskRun,
  authorization: ReviewAuthorization,
  turnId: string,
): ConversationArtifactCard | undefined {
  const cards = [...bundle.artifacts]
    .filter((card) => {
      const evidence = card.artifactEvidence;
      return (
        card.artifactType === 'chapter_summary' &&
        (card.runId === run.runId || (!card.runId && card.turnId === turnId)) &&
        evidence?.sourceNovelId === authorization.novelId &&
        evidence.sourceChapterId === authorization.chapterId &&
        evidence.sourceDraftId === authorization.consumedByDraftId &&
        VALID_ARTIFACT_STATUSES.has(evidence.processingStatus)
      );
    })
    .sort(
      (left, right) =>
        timeValue(left.createdAt) - timeValue(right.createdAt) ||
        left.cardId.localeCompare(right.cardId),
    );
  return cards[cards.length - 1];
}

export function resolveChapterSummaryOrchestration(
  input: ResolveChapterSummaryOrchestrationInput,
): ChapterSummaryOrchestrationState {
  const authorization = pendingOrLatestConsumedAuthorization(
    input.bundle,
    input.chapters,
    input.summaries,
  );
  if (!authorization?.consumedByDraftId) return { phase: 'none' };

  const base = {
    authorizationId: authorization.authorizationId,
    chapterId: authorization.chapterId,
    adoptedDraftId: authorization.consumedByDraftId,
    turnId: chapterSummaryTurnId(authorization.authorizationId),
  };
  const matchingSummary = hasMatchingSummary(authorization, input.summaries);
  if (matchingSummary) {
    if (input.nextTarget?.status === 'complete') {
      return { phase: 'story_complete', ...base };
    }
    if (input.nextTarget?.status === 'advanced' && input.nextTarget.chapterId) {
      return {
        phase: 'next_ready',
        ...base,
        nextChapterId: input.nextTarget.chapterId,
      };
    }
    return { phase: 'resolving_next', ...base };
  }

  const turn = input.bundle.turns.find((item) => item.turnId === base.turnId);
  if (!turn) return { phase: 'ensure_turn', ...base };
  const runs = input.bundle.runs.filter((run) => run.turnId === turn.turnId);
  const run = latestRun(runs);
  if (!run) {
    return {
      phase: input.credentialAvailable === false ? 'awaiting_credentials' : 'ready_to_start',
      ...base,
    };
  }
  const withRun = { ...base, runId: run.runId };
  if (ACTIVE_RUN_STATUSES.has(run.status)) return { phase: 'generating', ...withRun };

  const card = validSummaryCard(input.bundle, run, authorization, turn.turnId);
  if (!card) return { phase: 'failed', ...withRun };
  const withCard = { ...withRun, cardId: card.cardId };
  const decision = latestDecision(input.bundle, card);
  if (!decision) return { phase: 'awaiting_apply', ...withCard };
  if (decision.decision === 'request_revision') {
    return { phase: 'revision_requested', ...withCard };
  }
  if (decision.decision === 'reject') return { phase: 'rejected', ...withCard };
  if (decision.decision === 'request_apply') {
    if (decision.conflictCode) return { phase: 'conflict', ...withCard };
    if (decision.applyTransactionId) return { phase: 'failed', ...withCard };
  }
  return { phase: 'awaiting_apply', ...withCard };
}

export function chapterSummaryOrchestrationLabel(state: ChapterSummaryOrchestrationState): string {
  switch (state.phase) {
    case 'ensure_turn':
    case 'ready_to_start':
      return '正在准备章节总结';
    case 'awaiting_credentials':
      return '等待当前任务固定模型的会话凭据';
    case 'generating':
      return '正在生成章节总结候选';
    case 'awaiting_apply':
      return '总结候选已就绪，应用后才会进入正式上下文';
    case 'revision_requested':
      return '已请求修订总结候选，请显式重试或补充要求';
    case 'rejected':
      return '总结候选已拒绝，不会自动重试';
    case 'conflict':
      return '总结应用发生基线冲突，请重新生成候选';
    case 'failed':
      return state.runId ? '章节总结未完成，请使用回合中的重试操作' : '章节总结启动失败，请重试';
    case 'resolving_next':
      return '章节总结已应用，正在确定下一计划章节';
    case 'next_ready':
      return '章节总结已应用，下一计划章节已就绪';
    case 'story_complete':
      return '章节总结已应用，故事已到达当前规划终点';
    default:
      return '';
  }
}
