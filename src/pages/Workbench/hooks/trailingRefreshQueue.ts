export type RefreshOperation = (key: string) => Promise<void>;

interface RefreshState {
  pending: boolean;
  promise: Promise<void>;
}

/**
 * Keeps one refresh in flight per key and collapses a burst into one trailing read.
 */
export function createTrailingRefreshQueue(refresh: RefreshOperation): RefreshOperation {
  const states = new Map<string, RefreshState>();

  return (key: string) => {
    const current = states.get(key);
    if (current) {
      current.pending = true;
      return current.promise;
    }

    const state: RefreshState = {
      pending: false,
      promise: Promise.resolve(),
    };
    states.set(key, state);
    state.promise = Promise.resolve().then(async () => {
      try {
        do {
          state.pending = false;
          await refresh(key);
        } while (state.pending);
      } finally {
        if (states.get(key) === state) states.delete(key);
      }
    });
    return state.promise;
  };
}

export function shouldRefreshRuntimeBundleAfterPoll(
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>,
  selectedConversationId: string,
): boolean {
  if (
    !selectedConversationId ||
    (!previous.has(selectedConversationId) && !next.has(selectedConversationId))
  ) {
    return false;
  }
  if (previous.size !== next.size) return true;
  for (const id of previous) {
    if (!next.has(id)) return true;
  }
  return false;
}
