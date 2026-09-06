import { useLayoutEffect, useRef } from 'react';
import type { ArtifactCandidateReviewDraft } from '../../../types/artifactReview';
import type { ConversationArtifactCard } from '../../../types/conversation';
import { formatArtifactReviewNotes } from '../artifactRevisionPrompt';
import { useArtifactReviewStore } from '../../../store/artifactReviewStore';

const EMPTY_DRAFTS: Record<string, ArtifactCandidateReviewDraft> = {};

/** Keeps suggestions separate from the immutable candidate, including during content reloads. */
export function useArtifactCandidateReview(artifact: ConversationArtifactCard) {
  // A card is only a projection; task + immutable artifact identity owns the
  // session notes so a refreshed card id cannot silently discard them.
  const scope = JSON.stringify([artifact.conversationId, artifact.artifactId]);
  const entry = useArtifactReviewStore((state) => state.entries.get(scope));
  const drafts =
    entry?.artifactId === artifact.artifactId && entry?.content === artifact.content
      ? (entry?.drafts ?? EMPTY_DRAFTS)
      : EMPTY_DRAFTS;
  const reconcile = useArtifactReviewStore((state) => state.reconcile);
  const update = useArtifactReviewStore((state) => state.updateDraft);
  const invalidate = useArtifactReviewStore((state) => state.invalidate);
  const previousIdentity = useRef<
    { conversationId: string; scope: string; key: string } | undefined
  >(undefined);

  useLayoutEffect(() => {
    const key = JSON.stringify([artifact.artifactId, artifact.content]);
    const previous = previousIdentity.current;
    if (previous && previous.conversationId === artifact.conversationId && previous.key !== key) {
      // A changed immutable identity must not revive notes if the old projection returns.
      invalidate(previous.scope);
    }
    reconcile(scope, artifact.artifactId, artifact.content);
    previousIdentity.current = { conversationId: artifact.conversationId, scope, key };
  }, [
    scope,
    artifact.conversationId,
    artifact.artifactId,
    artifact.content,
    invalidate,
    reconcile,
  ]);

  function updateDraft(candidateId: string, draft: ArtifactCandidateReviewDraft) {
    update(scope, artifact.artifactId, artifact.content, candidateId, draft);
  }

  const revisionCount = Object.values(drafts).filter(
    (draft) => draft.suggestedTitle.trim() || draft.suggestedSummary.trim() || draft.notes.trim(),
  ).length;
  return { drafts, updateDraft, revisionNotes: formatArtifactReviewNotes(drafts), revisionCount };
}
