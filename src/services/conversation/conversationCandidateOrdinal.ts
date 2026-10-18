import type { ConversationArtifactCard, TaskConversationBundle } from '../../types/conversation';

const MISSING_TURN_SEQUENCE = Number.MAX_SAFE_INTEGER;

/** Rank among every card in the conversation, matching the full public projection. */
export function conversationCandidateOrdinals(
  bundle: TaskConversationBundle,
): Map<string, number> {
  const conversationId = bundle.conversation.conversationId;
  const turns = new Map(bundle.turns.map((turn) => [turn.turnId, turn]));
  const runs = new Map(bundle.runs.map((run) => [run.runId, run]));
  const fallback = epochMillis(bundle.conversation.createdAt) ?? 0;
  const ranked = bundle.artifacts
    .filter((card) => card.conversationId === conversationId)
    .map((card) => {
      const run = card.runId ? runs.get(card.runId) : undefined;
      const owner = turns.get((run ? run.turnId : card.turnId) ?? '');
      const at =
        epochMillis(card.createdAt) ??
        (run ? epochMillis(run.createdAt) : undefined) ??
        fallback;
      return {
        cardId: card.cardId,
        at,
        turnSequence: owner?.sequence ?? MISSING_TURN_SEQUENCE,
      };
    })
    .sort(
      (left, right) =>
        left.at - right.at ||
        left.turnSequence - right.turnSequence ||
        (left.cardId < right.cardId ? -1 : left.cardId > right.cardId ? 1 : 0),
    );
  return new Map(ranked.map((card, index) => [card.cardId, index + 1]));
}

export function stampWindowCards(
  bundle: TaskConversationBundle,
  includedTurnIds: ReadonlySet<string>,
  includedRunIds: ReadonlySet<string>,
  includeUnanchored: boolean,
): ConversationArtifactCard[] {
  const ordinals = conversationCandidateOrdinals(bundle);
  return bundle.artifacts
    .filter((card) => {
      if (card.turnId && includedTurnIds.has(card.turnId)) return true;
      if (card.runId && includedRunIds.has(card.runId)) return true;
      return !card.turnId && !card.runId && includeUnanchored;
    })
    .map((card) => {
      const candidateOrdinal = ordinals.get(card.cardId);
      return candidateOrdinal == null ? card : { ...card, candidateOrdinal };
    });
}

function epochMillis(value: string | undefined): number | undefined {
  const time = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : undefined;
}
