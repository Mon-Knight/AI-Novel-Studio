import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { useWorkbenchDraftStore } from '../../../store/workbenchDraftStore';

export function useWorkbenchRevisionDraft(selectedConversationId: string) {
  const draft = useWorkbenchDraftStore((state) => state.drafts[selectedConversationId]?.text ?? '');
  const revisionSource = useWorkbenchDraftStore(
    (state) => state.drafts[selectedConversationId]?.revisionSource ?? null,
  );
  const updateDraft = useWorkbenchDraftStore((state) => state.updateDraft);
  const setDraft = useCallback<Dispatch<SetStateAction<string>>>(
    (next) => updateDraft(selectedConversationId, next),
    [selectedConversationId, updateDraft],
  );
  const clearRevisionSource = useCallback(() => {
    useWorkbenchDraftStore.getState().clearRevisionSource(selectedConversationId);
  }, [selectedConversationId]);
  return { draft, revisionSource, updateDraft, setDraft, clearRevisionSource };
}
