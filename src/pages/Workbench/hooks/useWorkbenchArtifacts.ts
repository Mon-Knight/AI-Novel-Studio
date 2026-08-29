import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ArtifactDecisionKind, ConversationArtifactCard } from '../../../types/conversation';
import { artifactDecisionService } from '../../../services/conversation/artifactDecisionService';
import { buildArtifactRevisionDraft } from '../artifactRevisionPrompt';
import { resolveArtifactDecisionTarget } from '../workbenchHelpers';

export function useWorkbenchArtifacts(input: {
  selectedNovelId: string;
  chapterId: string | undefined;
  refreshBundle: (conversationId: string) => Promise<void>;
  loadConversations: (novelId?: string) => Promise<void>;
  selectedNovelRef: React.MutableRefObject<string>;
  setComposerError: (error: string) => void;
  setDraft?: (draft: string) => void;
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

  async function decideArtifact(
    artifact: ConversationArtifactCard,
    decision: ArtifactDecisionKind,
  ) {
    if (!selectedNovelId || !artifact.artifactId) return;
    setDecisionBusyCardId(artifact.cardId);
    setComposerError('');
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
      if (decision === 'request_revision') {
        setDraft?.(buildArtifactRevisionDraft(artifact.artifactType));
      }
      if (result.authorization && target.chapterId) {
        navigate(
          `/novels/${selectedNovelId}/workspace?chapterId=${encodeURIComponent(target.chapterId)}&authorizationId=${encodeURIComponent(result.authorization.authorizationId)}&artifactId=${encodeURIComponent(artifact.artifactId)}`,
        );
      }
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : '产物决定失败');
    } finally {
      setDecisionBusyCardId('');
    }
  }

  return {
    decisionBusyCardId,
    decideArtifact,
  };
}
