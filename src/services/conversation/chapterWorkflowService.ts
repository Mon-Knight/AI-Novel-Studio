import type { Chapter } from '../../types/chapter';
import type { ChapterSummary } from '../../types/chapterSummary';
import type { ConversationListCursor } from '../../types/conversation-directory';
import type {
  ConversationArtifactCard,
  TaskConversationBundle,
  TaskModelSnapshot,
} from '../../types/conversation';
import { chapterRepository } from '../database/chapterRepository';
import { chapterSummaryService } from '../context/chapterSummaryService';
import { taskConversationService } from './taskConversationService';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { isCurrentChapterSummaryAttempt } from './chapterSummaryAttempt';

export interface ChapterWorkflowRequest {
  novelId: string;
  chapterId: string;
  authorizationId?: string;
  /** Exact candidate selected for review/redo; never an authority to apply it. */
  summaryCardId?: string;
}

export interface ChapterWorkflowState {
  chapter: Chapter;
  summary: ChapterSummary | null;
  phase:
    | 'unadopted'
    | 'missing'
    | 'generating'
    | 'awaiting_apply'
    | 'rejected'
    | 'failed'
    | 'applied'
    | 'disabled'
    | 'expired';
  sourceConversationId?: string;
  conversationId?: string;
  conversationTitle?: string;
  cardId?: string;
  model?: TaskModelSnapshot;
  actualModel: boolean;
  archived: boolean;
}

export interface ChapterWorkflowHandoff extends ChapterWorkflowRequest {
  destination?: 'source' | 'summary';
  conversationId?: string;
  adoptedDraftId?: string;
  cardId?: string;
  draft?: string;
}

export function buildChapterSummaryRedoHandoff(input: {
  novelId: string;
  chapterId: string;
  adoptedDraftId?: string;
  conversationId?: string;
  cardId?: string;
  revisionNotes?: string;
}): { chapterWorkflow: ChapterWorkflowHandoff } {
  return {
    chapterWorkflow: {
      novelId: input.novelId,
      chapterId: input.chapterId,
      adoptedDraftId: input.adoptedDraftId,
      conversationId: input.conversationId,
      summaryCardId: input.cardId,
      draft: `重新总结本章。仅依据当前正式采用稿，保留推测、待查和计划的原有状态，不补写尚未发生的事件。\n需要修正：${input.revisionNotes?.trim() ?? ''}`,
    },
  };
}

function latestSummaryCard(
  bundle: TaskConversationBundle,
  chapter: Chapter,
): ConversationArtifactCard | undefined {
  return [...bundle.artifacts]
    .filter((card) => {
      const evidence = card.artifactEvidence;
      return (
        card.artifactType === 'chapter_summary' &&
        evidence?.sourceNovelId === chapter.novelId &&
        evidence.sourceChapterId === chapter.id &&
        evidence.sourceDraftId === chapter.adoptedDraftId &&
        ['valid', 'valid_with_warnings'].includes(evidence.processingStatus)
      );
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.cardId.localeCompare(a.cardId))[0];
}

/** A route hint never grants adoption or summary authorization; all identity comes from persisted records. */
export function resolveChapterWorkflow(
  request: ChapterWorkflowRequest,
  chapter: Chapter,
  summary: ChapterSummary | null,
  bundles: readonly TaskConversationBundle[],
): ChapterWorkflowState {
  if (chapter.id !== request.chapterId || chapter.novelId !== request.novelId)
    throw new Error('章节不属于当前作品，请重新选择章节。');
  if (summary && (summary.novelId !== chapter.novelId || summary.chapterId !== chapter.id))
    throw new Error('章节总结作用域不一致，请重新读取。');
  const scoped = bundles.filter((bundle) => bundle.conversation.novelId === chapter.novelId);
  const source = scoped.find((bundle) =>
    bundle.authorizations?.some(
      (authorization) =>
        authorization.novelId === chapter.novelId &&
        authorization.chapterId === chapter.id &&
        (request.authorizationId
          ? authorization.authorizationId === request.authorizationId &&
            (authorization.status === 'issued' ||
              (authorization.status === 'consumed' &&
                authorization.consumedByDraftId === chapter.adoptedDraftId))
          : authorization.status === 'consumed' &&
            authorization.consumedByDraftId === chapter.adoptedDraftId),
    ),
  );
  if (request.authorizationId && !source)
    throw new Error('审阅来源任务无法核对，请重新从章节候选打开审阅。');
  const summaries = scoped
    .flatMap((bundle) => {
      const card = chapter.adoptedDraftId ? latestSummaryCard(bundle, chapter) : undefined;
      return card ? [{ bundle, card }] : [];
    })
    .sort((a, b) => b.card.createdAt.localeCompare(a.card.createdAt));
  const explicit = request.summaryCardId
    ? scoped.flatMap((bundle) =>
        bundle.artifacts
          .filter((card) => card.cardId === request.summaryCardId)
          .map((card) => ({ bundle, card })),
      )
    : undefined;
  if (
    explicit &&
    (explicit.length !== 1 ||
      explicit[0].card.conversationId !== explicit[0].bundle.conversation.conversationId ||
      explicit[0].card.artifactType !== 'chapter_summary' ||
      explicit[0].card.artifactEvidence?.sourceNovelId !== chapter.novelId ||
      explicit[0].card.artifactEvidence.sourceChapterId !== chapter.id ||
      explicit[0].card.artifactEvidence.sourceDraftId !== chapter.adoptedDraftId)
  )
    throw new Error('所选总结候选与当前采用稿不一致，请重新打开本章总结。');
  const latest = explicit?.[0] ?? summaries[0];
  const destination = latest?.bundle ?? source;
  const attempts = scoped
    .flatMap((bundle) =>
      bundle.runs
        .filter((run) => isCurrentChapterSummaryAttempt(bundle, run, chapter, scoped))
        .map((run) => ({ bundle, run })),
    )
    .sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt));
  const relevantAttempts = explicit
    ? attempts.filter(({ run }) => run.runId === latest?.card.runId)
    : attempts;
  const active = relevantAttempts.find(({ run }) =>
    ['queued', 'running', 'cancel_requested'].includes(run.status),
  );
  const candidateRun = latest?.bundle.runs.find((run) => run.runId === latest.card.runId);
  const failed = relevantAttempts.find(({ run }) => ['failed', 'cancelled'].includes(run.status));
  const failedRun = failed?.run;
  const currentSummary =
    summary && summary.adoptedDraftId === chapter.adoptedDraftId && !summary.isExpired;
  const settledSummary =
    currentSummary &&
    (!latest || latest.card.createdAt <= summary.updatedAt) &&
    (!failedRun || failedRun.createdAt <= summary.updatedAt);
  const decisions =
    latest?.bundle.decisions
      ?.filter((item) => item.cardId === latest.card.cardId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)) ?? [];
  const decision = latest?.card.latestDecision ?? decisions[decisions.length - 1];
  const phase: ChapterWorkflowState['phase'] = !chapter.adoptedDraftId
    ? 'unadopted'
    : active
      ? 'generating'
      : settledSummary
        ? summary.enabled
          ? 'applied'
          : 'disabled'
        : failedRun && (!latest || failedRun.createdAt > latest.card.createdAt)
          ? 'failed'
          : decision?.decision === 'reject' || decision?.decision === 'request_revision'
            ? 'rejected'
            : decision?.conflictCode
              ? 'failed'
              : latest
                ? ['valid', 'valid_with_warnings'].includes(
                    latest.card.artifactEvidence!.processingStatus,
                  )
                  ? 'awaiting_apply'
                  : 'failed'
                : summary
                  ? 'expired'
                  : 'missing';
  const target = active?.bundle ?? (phase === 'failed' && failed ? failed.bundle : destination);
  const modelRun = active?.run ?? (phase === 'failed' && failedRun ? failedRun : candidateRun);
  return {
    chapter,
    summary,
    phase,
    sourceConversationId: source?.conversation.conversationId,
    conversationId: target?.conversation.conversationId,
    conversationTitle: target?.conversation.title,
    cardId: latest && latest.bundle === target ? latest.card.cardId : undefined,
    model: modelRun?.modelSnapshot ?? target?.conversation.defaultModel,
    actualModel: Boolean(modelRun),
    archived: Boolean(
      target?.conversation.archivedAt || target?.conversation.status === 'archived',
    ),
  };
}

const pendingReads = new Map<string, Promise<ChapterWorkflowState>>();

export function loadChapterWorkflow(
  request: ChapterWorkflowRequest,
): Promise<ChapterWorkflowState> {
  const key = JSON.stringify([
    request.novelId,
    request.chapterId,
    request.authorizationId,
    request.summaryCardId,
  ]);
  const existing = pendingReads.get(key);
  if (existing) return existing;
  const pending = readChapterWorkflow(request).finally(() => {
    if (pendingReads.get(key) === pending) pendingReads.delete(key);
  });
  pendingReads.set(key, pending);
  return pending;
}

async function readChapterWorkflow(request: ChapterWorkflowRequest): Promise<ChapterWorkflowState> {
  const [chapter, summary] = await Promise.all([
    chapterRepository.getById(request.chapterId),
    chapterSummaryService.getByChapterId(request.chapterId),
  ]);
  if (!chapter || chapter.novelId !== request.novelId)
    throw new Error('当前章节不存在或作品作用域已改变。');
  const bundles: TaskConversationBundle[] = [];
  let cursor: ConversationListCursor | undefined;
  const seen = new Set<string>();
  const seenCursors = new Set<string>();
  do {
    const page = await taskConversationService.listPage({
      novelId: request.novelId,
      archive: 'all',
      limit: 100,
      cursor,
    });
    for (const item of page.items) {
      if (seen.has(item.conversationId)) throw new Error('任务分页重复，请重新读取章节流程。');
      seen.add(item.conversationId);
      const bundle = await taskConversationService.get(item.conversationId, {
        hydrateArtifacts: false,
      });
      if (!bundle || bundle.conversation.novelId !== request.novelId) continue;
      const artifacts = await Promise.all(
        bundle.artifacts.map(async (card) => {
          if (card.artifactType !== 'chapter_summary' || !taskConversationService.isPersistent())
            return card;
          if (!card.artifactId) throw new Error('总结候选来源缺失，请重新读取章节流程。');
          // Only hydrate summary evidence. Routing never loads unrelated prose candidates.
          const { artifact, issues } = await aiTaskRuntimeService.getArtifact(card.artifactId);
          if (
            artifact.artifactId !== card.artifactId ||
            artifact.artifactType !== 'chapter_summary'
          )
            throw new Error('总结候选来源不一致，请重新读取章节流程。');
          return {
            ...card,
            artifactEvidence: {
              sourceNovelId: artifact.sourceNovelId,
              sourceChapterId: artifact.sourceChapterId ?? undefined,
              sourceDraftId: artifact.sourceDraftId ?? undefined,
              processingStatus: artifact.processingStatus,
              validationIssues: issues,
            },
          };
        }),
      );
      bundles.push({ ...bundle, artifacts });
    }
    cursor = page.nextCursor;
    if (cursor) {
      const cursorKey = JSON.stringify(cursor);
      if (seenCursors.has(cursorKey)) throw new Error('任务分页未能推进，请重新读取章节流程。');
      seenCursors.add(cursorKey);
    }
  } while (cursor);
  return resolveChapterWorkflow(request, chapter, summary, bundles);
}

export function chapterWorkflowDraft(state: ChapterWorkflowState): string {
  return `重新总结本章（第${state.chapter.chapterNumber}章《${state.chapter.title}》）。仅依据当前正式采用稿，保留推测、待查和计划的原有状态，不补写尚未发生的事件。${state.phase === 'rejected' ? '\n需要修正：' : ''}`;
}
