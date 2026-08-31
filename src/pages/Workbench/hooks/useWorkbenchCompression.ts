import {
  novelContextCompressionProvider,
  type NovelContextCompressionCandidate,
} from '../../../services/context/novelContextCompressionProvider';
import { taskConversationService } from '../../../services/conversation/taskConversationService';
import type { ConversationScopedOperation } from './useConversationScopedState';
import { useConversationScopedState } from './useConversationScopedState';

interface CompressionState {
  candidate: NovelContextCompressionCandidate | null;
  busy: boolean;
}

const EMPTY_COMPRESSION_STATE: CompressionState = {
  candidate: null,
  busy: false,
};

export function useWorkbenchCompression(input: {
  selectedNovelId: string;
  selectedConversationId: string;
  refreshBundle: (conversationId: string) => Promise<void>;
  beginComposerErrorOperation: (conversationId: string) => ConversationScopedOperation;
  commitComposerErrorOperation: (operation: ConversationScopedOperation, error: string) => boolean;
}) {
  const {
    selectedNovelId,
    selectedConversationId,
    refreshBundle,
    beginComposerErrorOperation,
    commitComposerErrorOperation,
  } = input;
  const {
    value: compressionState,
    setValue: setCompressionState,
    beginOperation,
    isOperationCurrent,
    commitOperation,
  } = useConversationScopedState(selectedConversationId, EMPTY_COMPRESSION_STATE);

  const setCompressionCandidate = (candidate: NovelContextCompressionCandidate | null) => {
    setCompressionState((current) => ({ ...current, candidate }));
  };

  async function proposeContextCompression() {
    if (!selectedNovelId || !selectedConversationId) return;
    const conversationId = selectedConversationId;
    const novelId = selectedNovelId;
    const previousCandidate = compressionState.candidate;
    const compressionOperation = beginOperation(conversationId);
    const errorOperation = beginComposerErrorOperation(conversationId);
    commitOperation(compressionOperation, (current) => ({ ...current, busy: true }));
    commitComposerErrorOperation(errorOperation, '');
    try {
      const candidate = await novelContextCompressionProvider.propose(novelId);
      if (!isOperationCurrent(compressionOperation)) return;
      if (!candidate.valid) {
        commitOperation(compressionOperation, (current) => ({ ...current, candidate }));
        return;
      }
      await taskConversationService.publishStructuredCandidate({
        conversationId,
        novelId,
        artifactType: 'generic_json',
        derivationType: 'context_compression',
        title: '小说上下文压缩',
        summary: `覆盖率通过 · ${candidate.coverage.tokens.used}/${candidate.coverage.tokens.budget} tokens`,
        structuredPayloadJson: candidate,
      });
      if (!isOperationCurrent(compressionOperation)) return;
      commitOperation(compressionOperation, (current) => ({ ...current, candidate: null }));
      await refreshBundle(conversationId);
    } catch (error) {
      if (isOperationCurrent(compressionOperation)) {
        commitOperation(compressionOperation, (current) => ({
          ...current,
          candidate: current.candidate ?? previousCandidate,
        }));
        commitComposerErrorOperation(
          errorOperation,
          error instanceof Error ? error.message : '压缩小说上下文失败',
        );
      }
    } finally {
      commitOperation(compressionOperation, (current) => ({ ...current, busy: false }));
    }
  }

  return {
    compressionCandidate: compressionState.candidate,
    setCompressionCandidate,
    compressionBusy: compressionState.busy,
    proposeContextCompression,
  };
}
