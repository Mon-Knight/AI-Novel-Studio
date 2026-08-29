import { useEffect, useSyncExternalStore } from 'react';
import { startupCoordinator } from '../../../services/startup/startupCoordinator';

const subscribe = (listener: () => void) => startupCoordinator.subscribe(listener);
const getSnapshot = () => startupCoordinator.getSnapshot();

export function useWorkbenchStartupReadiness() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    void startupCoordinator.waitForContextMigration().catch(() => undefined);
  }, []);

  const status = snapshot.contextMigration.status;
  return {
    contextStatus: status,
    contextPending: status === 'idle' || status === 'running',
    contextFailed: status === 'failed',
  };
}
