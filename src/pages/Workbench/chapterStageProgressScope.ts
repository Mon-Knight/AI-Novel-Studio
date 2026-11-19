import type { ConversationTurn, TaskConversationBundle, TaskRun } from '../../types/conversation';

export interface ChapterStageProgressScope {
  readonly novelId: string;
  readonly chapterId: string;
  readonly conversationId: string;
  /** Set only when one user turn owns every run for this chapter. */
  readonly workflowId?: string;
}

/**
 * Do not guess among several user turns. Omitting workflowId keeps the read
 * chapter-scoped; candidate completion still requires an exact workflow match.
 */
export function resolveChapterStageProgressScope(input: {
  novelId: string;
  chapterId: string;
  conversationId: string;
  turns: readonly Pick<ConversationTurn, 'turnId' | 'role'>[];
  runs: readonly Pick<TaskRun, 'turnId' | 'chapterId'>[];
}): ChapterStageProgressScope | null {
  const novelId = input.novelId.trim();
  const chapterId = input.chapterId.trim();
  const conversationId = input.conversationId.trim();
  if (!novelId || !chapterId || !conversationId) return null;
  const userTurns = new Set(
    input.turns
      .filter((turn) => turn.role === 'user' && turn.turnId.trim())
      .map((turn) => turn.turnId),
  );
  const owners = new Set(
    input.runs
      .filter((run) => run.chapterId === chapterId && userTurns.has(run.turnId))
      .map((run) => run.turnId),
  );
  return {
    novelId,
    chapterId,
    conversationId,
    ...(owners.size === 1 ? { workflowId: [...owners][0] } : {}),
  };
}

export function chapterStageProgressScopeFromBundle(
  novelId: string,
  chapterId: string | undefined,
  bundle: Pick<TaskConversationBundle, 'conversation' | 'turns' | 'runs'> | null | undefined,
): ChapterStageProgressScope | null {
  if (!chapterId || !bundle) return null;
  return resolveChapterStageProgressScope({
    novelId,
    chapterId,
    conversationId: bundle.conversation.conversationId,
    turns: bundle.turns,
    runs: bundle.runs,
  });
}
