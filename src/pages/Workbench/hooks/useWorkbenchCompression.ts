import { useState } from 'react';
import {
  novelContextCompressionProvider,
  type NovelContextCompressionCandidate,
} from '../../../services/context/novelContextCompressionProvider';
import { taskConversationService } from '../../../services/conversation/taskConversationService';

export function useWorkbenchCompression(input: {
  selectedNovelId: string;
  selectedConversationId: string;
  refreshBundle: (conversationId: string) => Promise<void>;
  setComposerError: (error: string) => void;
}) {
  const { selectedNovelId, selectedConversationId, refreshBundle, setComposerError } = input;
  const [compressionCandidate, setCompressionCandidate] =
    useState<NovelContextCompressionCandidate | null>(null);
  const [compressionBusy, setCompressionBusy] = useState(false);

  async function proposeContextCompression() {
    if (!selectedNovelId || !selectedConversationId) return;
    setCompressionBusy(true);
    setComposerError('');
    try {
      const candidate = await novelContextCompressionProvider.propose(selectedNovelId);
      if (!candidate.valid) {
        setCompressionCandidate(candidate);
        return;
      }
      await taskConversationService.publishStructuredCandidate({
        conversationId: selectedConversationId,
        novelId: selectedNovelId,
        artifactType: 'generic_json',
        derivationType: 'context_compression',
        title: '小说上下文压缩',
        summary: `覆盖率通过 · ${candidate.coverage.tokens.used}/${candidate.coverage.tokens.budget} tokens`,
        structuredPayloadJson: candidate,
      });
      setCompressionCandidate(null);
      await refreshBundle(selectedConversationId);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : '压缩小说上下文失败');
    } finally {
      setCompressionBusy(false);
    }
  }

  return {
    compressionCandidate,
    setCompressionCandidate,
    compressionBusy,
    proposeContextCompression,
  };
}
