import type { ArtifactDecisionKind, ConversationArtifactCard } from '../../types/conversation';

export type StructuredArtifactDecisionInput = {
  artifact: ConversationArtifactCard;
  decision: ArtifactDecisionKind;
  applied: boolean;
};

type StructuredArtifactDecisionSettlement = {
  conversationId: string;
  artifactId: string;
  decision: ArtifactDecisionKind;
  applied: boolean;
  selectedChapterId?: string;
};

/** Refreshes the selected chapter scope before settling a structured artifact decision. */
export async function settleStructuredArtifactDecision(
  input: StructuredArtifactDecisionInput & {
    selectedNovelId: string;
    selectedConversationRef: { current: string };
    selectedNovelRef: { current: string };
    reloadChapters: (novelId: string) => Promise<{ chapterId?: string } | null>;
    selectChapter: (chapterId: string) => Promise<void>;
    settleAssetCandidateDecision: (input: StructuredArtifactDecisionSettlement) => Promise<void>;
  },
): Promise<void> {
  if (!input.artifact.artifactId) return;
  const isCurrentScope = () =>
    input.selectedConversationRef.current === input.artifact.conversationId &&
    input.selectedNovelRef.current === input.selectedNovelId;
  let selectedChapterId: string | undefined;
  if (input.applied && isCurrentScope()) {
    const refreshed = await input.reloadChapters(input.selectedNovelId);
    selectedChapterId = refreshed?.chapterId;
    if (selectedChapterId && isCurrentScope()) await input.selectChapter(selectedChapterId);
  }
  await input.settleAssetCandidateDecision({
    conversationId: input.artifact.conversationId,
    artifactId: input.artifact.artifactId,
    decision: input.decision,
    applied: input.applied,
    selectedChapterId,
  });
}
