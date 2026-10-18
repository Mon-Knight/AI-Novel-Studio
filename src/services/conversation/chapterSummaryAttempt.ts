import type { Chapter } from '../../types/chapter';
import type { TaskConversationBundle, TaskRun } from '../../types/conversation';

function currentSource(value: unknown, chapter: Chapter): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return (
    source.version === 1 &&
    source.novelId === chapter.novelId &&
    source.chapterId === chapter.id &&
    source.adoptedDraftId === chapter.adoptedDraftId &&
    typeof source.contentHash === 'string' &&
    /^[a-f\d]{64}$/iu.test(source.contentHash)
  );
}

/** A historical attempt needs persisted adoption evidence, never a chapter-name guess. */
function legacySource(
  bundle: TaskConversationBundle,
  run: TaskRun,
  chapter: Chapter,
  bundles: readonly TaskConversationBundle[],
): boolean {
  if (
    bundle.artifacts.some(
      (card) =>
        card.runId === run.runId &&
        card.conversationId === bundle.conversation.conversationId &&
        card.artifactType === 'chapter_summary' &&
        card.artifactEvidence?.sourceNovelId === chapter.novelId &&
        card.artifactEvidence.sourceChapterId === chapter.id &&
        card.artifactEvidence.sourceDraftId === chapter.adoptedDraftId,
    )
  )
    return true;
  const runTime = Date.parse(run.createdAt);
  if (!Number.isFinite(runTime)) return false;
  return bundles.some(
    (item) =>
      item.conversation.novelId === chapter.novelId &&
      item.authorizations?.some((authorization) => {
        const adoptedAt = Date.parse(authorization.consumedAt ?? '');
        return (
          authorization.novelId === chapter.novelId &&
          authorization.chapterId === chapter.id &&
          authorization.status === 'consumed' &&
          authorization.consumedByDraftId === chapter.adoptedDraftId &&
          Number.isFinite(adoptedAt) &&
          runTime >= adoptedAt
        );
      }),
  );
}

/** Recognize failures before the candidate tool runs, using the host's frozen stage. */
export function isCurrentChapterSummaryAttempt(
  bundle: TaskConversationBundle,
  run: TaskRun,
  chapter: Chapter,
  bundles: readonly TaskConversationBundle[],
): boolean {
  if (
    !chapter.adoptedDraftId ||
    bundle.conversation.novelId !== chapter.novelId ||
    run.conversationId !== bundle.conversation.conversationId ||
    run.chapterId !== chapter.id ||
    !bundle.turns.some(
      (turn) =>
        turn.turnId === run.turnId &&
        turn.conversationId === run.conversationId &&
        turn.role === 'user',
    )
  )
    return false;
  const contracts = bundle.toolEvents.filter(
    (event) => event.runId === run.runId && event.toolName === 'dsh.execution_contract',
  );
  const automatic = bundle.authorizations?.some(
    (authorization) =>
      authorization.novelId === chapter.novelId &&
      authorization.chapterId === chapter.id &&
      authorization.status === 'consumed' &&
      authorization.consumedByDraftId === chapter.adoptedDraftId &&
      run.turnId === `summary-generation-${authorization.authorizationId}`,
  );
  if (contracts.length) {
    if (contracts.length !== 1) return false;
    const contract = contracts[0];
    if (
      contract.status !== 'succeeded' ||
      contract.argumentsSummary.source !== 'ans-host' ||
      contract.argumentsSummary.taskKind !== 'chapter_summary'
    )
      return false;
    if (contract.argumentsSummary.summarySource !== undefined)
      return currentSource(contract.argumentsSummary.summarySource, chapter);
    // Earlier hosts recorded the stage but not the draft. Require independent evidence.
    return Boolean(automatic) || legacySource(bundle, run, chapter, bundles);
  }
  if (automatic) return true;
  return (
    bundle.toolEvents.some(
      (event) => event.runId === run.runId && event.toolName === 'summarize_chapter',
    ) && legacySource(bundle, run, chapter, bundles)
  );
}
