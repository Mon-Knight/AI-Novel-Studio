import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ArtifactDecisionKind, ConversationArtifactCard } from '../../../types/conversation';
import { artifactDecisionService } from '../../../services/conversation/artifactDecisionService';
import { appendArtifactRevisionDraft, buildArtifactRevisionDraft } from '../artifactRevisionPrompt';
import { resolveArtifactDecisionTarget } from '../workbenchHelpers';

export function useWorkbenchArtifacts(input: {
  selectedNovelId: string;
  chapterId: string | undefined;
  refreshBundle: (conversationId: string) => Promise<void>;
  loadConversations: (novelId?: string) => Promise<void>;
  selectedNovelRef: React.MutableRefObject<string>;
  setComposerError: (error: string) => void;
  setDraft?: React.Dispatch<React.SetStateAction<string>>;
  onStructuredArtifactDecision?: (input: {
    artifact: ConversationArtifactCard;
    decision: ArtifactDecisionKind;
    applied: boolean;
  }) => Promise<void> | void;
}) {
  const {
    selectedNovelId,
    chapterId,
    refreshBundle,
    loadConversations,
    selectedNovelRef,
    setComposerError,
    setDraft,
    onStructuredArtifactDecision,
  } = input;
  const navigate = useNavigate();
  const [decisionBusyCardId, setDecisionBusyCardId] = useState('');
  const decisionInFlightRef = useRef(false);

  async function decideArtifact(
    artifact: ConversationArtifactCard,
    decision: ArtifactDecisionKind,
    revisionNotes?: string,
  ) {
    if (!selectedNovelId || !artifact.artifactId || decisionInFlightRef.current) return;
    // Lock before React rerenders so another card cannot unlock a pending review.
    decisionInFlightRef.current = true;
    setDecisionBusyCardId(artifact.cardId);
    setComposerError('');
    let revisionRecorded = false;
    try {
      const target = resolveArtifactDecisionTarget({
        artifactType: artifact.artifactType,
        sourceChapterId: artifact.artifactEvidence?.sourceChapterId,
        currentChapterId: chapterId,
        novelId: selectedNovelId,
      });
      const payload = {
        conversationId: artifact.conversationId,
        cardId: artifact.cardId,
        artifactId: artifact.artifactId,
        decision,
        targetType: target.targetType,
        targetId: target.targetId,
        novelId: selectedNovelId,
        chapterId: target.chapterId,
        baseRevision: artifact.artifactEvidence?.baseContentHash,
      };
      const result =
        decision === 'request_apply'
          ? await artifactDecisionService.applyStructured(payload)
          : await artifactDecisionService.record(payload);
      if (decision === 'request_revision') {
        revisionRecorded = true;
        const revisionDraft = buildArtifactRevisionDraft(artifact.artifactType, revisionNotes);
        // The captured setter belongs to the originating conversation. A functional
        // update keeps text entered while the decision was pending, even after a switch.
        setDraft?.((existingDraft) => appendArtifactRevisionDraft(existingDraft, revisionDraft));
      }
      await refreshBundle(artifact.conversationId);
      if (selectedNovelRef.current === selectedNovelId) {
        await loadConversations(selectedNovelId);
      }
      const applied = Boolean(
        decision === 'request_apply' &&
        result.decision.applyTransactionId &&
        !result.decision.conflictCode,
      );
      if (decision !== 'confirm') {
        try {
          await onStructuredArtifactDecision?.({ artifact, decision, applied });
        } catch {
          setComposerError(
            applied
              ? '产物已应用，但核心资产状态刷新失败；请点击“重新检查”。'
              : '产物决定已记录，但创作准备状态刷新失败；请点击“重新检查”。',
          );
        }
      }
      if (result.authorization && target.chapterId) {
        navigate(
          `/novels/${selectedNovelId}/workspace?chapterId=${encodeURIComponent(target.chapterId)}&authorizationId=${encodeURIComponent(result.authorization.authorizationId)}&artifactId=${encodeURIComponent(artifact.artifactId)}`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '产物决定失败';
      setComposerError(
        revisionRecorded
          ? `修订请求已记录，但产物状态刷新失败；输入区内容已保留。${message}`
          : message,
      );
    } finally {
      decisionInFlightRef.current = false;
      setDecisionBusyCardId('');
    }
  }

  return {
    decisionBusyCardId,
    decideArtifact,
  };
}
