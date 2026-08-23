import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ArtifactDecisionKind, ConversationArtifactCard } from '../../../types/conversation';
import { artifactDecisionService } from '../../../services/conversation/artifactDecisionService';

export function useWorkbenchArtifacts(input: {
  selectedNovelId: string;
  chapterId: string | undefined;
  refreshBundle: (conversationId: string) => Promise<void>;
  loadConversations: (novelId?: string) => Promise<void>;
  selectedNovelRef: React.MutableRefObject<string>;
  setComposerError: (error: string) => void;
  setDraft?: (draft: string) => void;
}) {
  const {
    selectedNovelId,
    chapterId,
    refreshBundle,
    loadConversations,
    selectedNovelRef,
    setComposerError,
    setDraft,
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
      const payload = {
        conversationId: artifact.conversationId,
        cardId: artifact.cardId,
        artifactId: artifact.artifactId,
        decision,
        targetType: (artifact.artifactType === 'chapter_text' ? 'chapter' : 'asset') as
          'chapter' | 'asset',
        targetId: chapterId || selectedNovelId,
        novelId: selectedNovelId,
        chapterId,
      };
      const result =
        decision === 'request_apply'
          ? await artifactDecisionService.applyStructured(payload)
          : await artifactDecisionService.record(payload);
      await refreshBundle(artifact.conversationId);
      if (selectedNovelRef.current === selectedNovelId) {
        await loadConversations(selectedNovelId);
      }
      if (decision === 'request_revision') {
        setDraft?.('请根据以下要求修改上一版章节候选：\n');
      }
      if (result.authorization && chapterId) {
        navigate(
          `/novels/${selectedNovelId}/workspace?chapterId=${encodeURIComponent(chapterId)}&authorizationId=${encodeURIComponent(result.authorization.authorizationId)}&artifactId=${encodeURIComponent(artifact.artifactId)}`,
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
