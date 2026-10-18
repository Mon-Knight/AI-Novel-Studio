import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { WorkbenchIntentState } from '../../../components/layout/shellNavigation';

interface IntentProjectScope {
  selectedNovelId: string;
  novelIds: string[];
  loading: boolean;
  selectProject: (novelId: string) => void;
}

/**
 * Consumes one-shot intents handed over by the shell quick actions (Ctrl+N / Ctrl+K or the
 * sidebar buttons on other routes) and clears them from history so a refresh cannot replay them.
 */
export function useWorkbenchIntent(
  openTaskCreator: () => void,
  onSearchRequested?: () => void,
  projectScope?: IntentProjectScope,
): { searchFocusToken: number } {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const consumedIntent = useRef<{ key: string; intent: string }>();
  const intentState = location.state as WorkbenchIntentState | null;
  const intent = intentState?.workbenchIntent;
  const requestedNovelId = intentState?.workbenchNovelId;

  useEffect(() => {
    if (!intent) return;
    if (consumedIntent.current?.key === location.key && consumedIntent.current.intent === intent)
      return;
    if (intent === 'new-task' && requestedNovelId) {
      if (!projectScope || projectScope.loading) return;
      if (!projectScope.novelIds.includes(requestedNovelId)) {
        navigate(`/novels/${encodeURIComponent(requestedNovelId)}`, { replace: true, state: null });
        return;
      }
      if (projectScope.selectedNovelId !== requestedNovelId) {
        projectScope.selectProject(requestedNovelId);
        return;
      }
    }
    // Router navigation can wait in a transition while an intent callback updates state
    // immediately. Claim this history entry before those updates can rerun the effect.
    consumedIntent.current = { key: location.key, intent };
    if (intent === 'new-task') openTaskCreator();
    if (intent === 'search') {
      onSearchRequested?.();
      setSearchFocusToken((token) => token + 1);
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [
    intent,
    location.key,
    location.pathname,
    navigate,
    onSearchRequested,
    openTaskCreator,
    projectScope,
    requestedNovelId,
  ]);

  return { searchFocusToken };
}
