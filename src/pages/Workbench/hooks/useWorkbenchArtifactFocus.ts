import { useCallback, useEffect, useRef, useState } from 'react';

interface ArtifactFocusRequest {
  conversationId: string;
  cardId: string;
  requestId: string;
}

/** Explicit artifact navigation can hydrate history without disturbing another task's reading state. */
export function useWorkbenchArtifactFocus(conversationId: string, closeSidePanel: () => void) {
  const sequence = useRef(0);
  const [request, setRequest] = useState<ArtifactFocusRequest>();
  useEffect(() => setRequest(undefined), [conversationId]);
  const onLocateArtifact = useCallback(
    (cardId: string) => {
      if (!conversationId || !cardId) return;
      setRequest({ conversationId, cardId, requestId: `${conversationId}:${++sequence.current}` });
      if (typeof window !== 'undefined' && window.innerWidth <= 1180) closeSidePanel();
    },
    [conversationId, closeSidePanel],
  );
  return {
    artifactFocusRequest: request?.conversationId === conversationId ? request : undefined,
    onLocateArtifact,
  };
}
