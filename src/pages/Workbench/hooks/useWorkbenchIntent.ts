import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { WorkbenchIntentState } from '../../../components/layout/shellNavigation';

/**
 * Consumes one-shot intents handed over by the shell quick actions (Ctrl+N / Ctrl+K or the
 * sidebar buttons on other routes) and clears them from history so a refresh cannot replay them.
 */
export function useWorkbenchIntent(openTaskCreator: () => void): { searchFocusToken: number } {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const intent = (location.state as WorkbenchIntentState | null)?.workbenchIntent;

  useEffect(() => {
    if (!intent) return;
    if (intent === 'new-task') openTaskCreator();
    if (intent === 'search') setSearchFocusToken((token) => token + 1);
    navigate(location.pathname, { replace: true, state: null });
  }, [intent, location.pathname, navigate, openTaskCreator]);

  return { searchFocusToken };
}
