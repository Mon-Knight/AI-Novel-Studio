import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';

export interface ConversationScopedOperation {
  conversationId: string;
  epoch: number;
}

function resolveState<T>(current: T, next: SetStateAction<T>): T {
  return typeof next === 'function' ? (next as (value: T) => T)(current) : next;
}

/** Keeps transient Workbench state in the conversation that created it. */
export function useConversationScopedState<T>(conversationId: string, initialValue: T) {
  const [values, setValues] = useState<Map<string, T>>(() => new Map());
  const epochsRef = useRef(new Map<string, number>());

  const nextEpoch = useCallback((scopeId: string) => {
    const epoch = (epochsRef.current.get(scopeId) ?? 0) + 1;
    epochsRef.current.set(scopeId, epoch);
    return epoch;
  }, []);

  const updateValue = useCallback(
    (scopeId: string, next: SetStateAction<T>) => {
      if (!scopeId) return;
      nextEpoch(scopeId);
      setValues((current) => {
        const previous = current.get(scopeId) ?? initialValue;
        const resolved = resolveState(previous, next);
        if (Object.is(previous, resolved) && current.has(scopeId)) return current;
        const updated = new Map(current);
        updated.set(scopeId, resolved);
        return updated;
      });
    },
    [initialValue, nextEpoch],
  );

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => updateValue(conversationId, next),
    [conversationId, updateValue],
  );

  const beginOperation = useCallback(
    (scopeId: string): ConversationScopedOperation => ({
      conversationId: scopeId,
      epoch: scopeId ? nextEpoch(scopeId) : 0,
    }),
    [nextEpoch],
  );

  const isOperationCurrent = useCallback((operation: ConversationScopedOperation) => {
    return (
      Boolean(operation.conversationId) &&
      epochsRef.current.get(operation.conversationId) === operation.epoch
    );
  }, []);

  const commitOperation = useCallback(
    (operation: ConversationScopedOperation, next: SetStateAction<T>): boolean => {
      if (!isOperationCurrent(operation)) return false;
      setValues((current) => {
        if (!isOperationCurrent(operation)) return current;
        const previous = current.get(operation.conversationId) ?? initialValue;
        const resolved = resolveState(previous, next);
        if (Object.is(previous, resolved) && current.has(operation.conversationId)) return current;
        const updated = new Map(current);
        updated.set(operation.conversationId, resolved);
        return updated;
      });
      return true;
    },
    [initialValue, isOperationCurrent],
  );

  return {
    value: conversationId ? (values.get(conversationId) ?? initialValue) : initialValue,
    setValue,
    updateValue,
    beginOperation,
    isOperationCurrent,
    commitOperation,
  };
}
