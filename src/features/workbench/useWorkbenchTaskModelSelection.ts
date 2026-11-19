import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskConversation, TaskModelSnapshot } from '../../types/conversation';
import type { CurrentPluginProjection } from '../../services/conversation/currentPluginService';
import { taskConversationService } from '../../services/conversation/taskConversationService';
import { captureTaskModelSnapshot } from '../../services/conversation/taskModelSnapshot';
import { listSelectableWorkbenchModels } from '../../services/conversation/workbenchSelectableModels';

interface TaskModelSelectionInput {
  conversationId: string;
  conversationRef: { current: string };
  selectedModel: TaskModelSnapshot;
  disabled: boolean;
  plugins: CurrentPluginProjection[];
  pluginsLoading: boolean;
  pluginsError: string;
  onPersisted: (conversation: TaskConversation) => void;
}

/** A task's next-turn choice changes only after persistence, never its previous Run snapshots. */
export function useWorkbenchTaskModelSelection(input: TaskModelSelectionInput) {
  const inputRef = useRef(input);
  inputRef.current = input;
  const scopeRef = useRef({ conversationId: input.conversationId, epoch: 0 });
  if (scopeRef.current.conversationId !== input.conversationId) {
    scopeRef.current = { conversationId: input.conversationId, epoch: scopeRef.current.epoch + 1 };
  }
  const pendingRef = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<{ epoch: number; message: string } | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const changeModel = useCallback(async (value: string) => {
    const current = inputRef.current;
    const conversationId = current.conversationId;
    if (
      !conversationId ||
      current.conversationRef.current !== conversationId ||
      current.disabled ||
      current.pluginsLoading ||
      pendingRef.current.has(conversationId)
    )
      return;
    const epoch = scopeRef.current.epoch;
    const selected = listSelectableWorkbenchModels(current.plugins).find(
      (option) => option.key === value,
    );
    if (!selected) return;
    pendingRef.current.add(conversationId);
    setPending(new Set(pendingRef.current));
    setError(null);
    try {
      const snapshot = captureTaskModelSnapshot(selected.providerId, selected.modelId);
      const updated = await taskConversationService.updateDefaultModel(conversationId, snapshot);
      if (mountedRef.current) inputRef.current.onPersisted(updated);
    } catch (cause) {
      if (
        mountedRef.current &&
        epoch === scopeRef.current.epoch &&
        inputRef.current.conversationRef.current === conversationId
      ) {
        setError({
          epoch,
          message: cause instanceof Error ? cause.message : '模型选择保存失败，请重试。',
        });
      }
    } finally {
      pendingRef.current.delete(conversationId);
      if (mountedRef.current) setPending(new Set(pendingRef.current));
    }
  }, []);

  const isChangingModel = useCallback(
    () => pendingRef.current.has(inputRef.current.conversationRef.current),
    [],
  );
  return {
    changeModel,
    isChangingModel,
    modelChangePending: pending.has(input.conversationId),
    modelSelectionDisabled: input.disabled,
    modelChangeError: error?.epoch === scopeRef.current.epoch ? error.message : '',
  };
}
