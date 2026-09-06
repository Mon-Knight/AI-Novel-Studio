import { useEffect, useLayoutEffect } from 'react';
import { markWorkbenchOnce } from '../workbenchHelpers';

export function useWorkbenchVisibility(contentReady: boolean): void {
  useLayoutEffect(() => {
    markWorkbenchOnce('creative-workbench-visible');
  }, []);
  useEffect(() => {
    if (contentReady) markWorkbenchOnce('workbench-content-ready');
  }, [contentReady]);
}
