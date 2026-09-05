import { useEffect, useRef, useState } from 'react';
import { hasUsableDshTaskCredentialAsync } from '../../../services/dsh/taskRuntimeService';
import { hydrateTaskModelSnapshotRuntime } from '../../../services/conversation/taskModelSnapshot';
import type { TaskModelSnapshot } from '../../../types/conversation';

export type WorkbenchModelCredentialStatus = 'checking' | 'available' | 'unavailable';

/**
 * Resolves the process-scoped credential for a frozen model identity.
 *
 * The refresh signal lets a retry of the Runtime directory re-check a key that
 * may have been entered in Settings without persisting it to application data.
 */
export function useWorkbenchModelCredential(
  model: TaskModelSnapshot,
  refreshSignal = false,
): {
  status: WorkbenchModelCredentialStatus;
  credentialAvailable: boolean | undefined;
} {
  // The UI must inspect the same effective identity that the send/runtime
  // path uses.  Older persisted snapshots may predate `baseUrl`; hydration
  // only restores it when provider + model exactly match the active settings,
  // and otherwise leaves the snapshot fail-closed.
  const modelRef = useRef(model);
  modelRef.current = model;
  // Credential identity is limited to these fields.  Tracking a primitive
  // key avoids restarting the async check when a parent recreates an
  // equivalent snapshot object during an unrelated render.
  const credentialIdentityKey = [
    model.runtimeMode,
    model.providerId.trim(),
    model.modelId.trim(),
    model.baseUrl?.trim() ?? '',
  ].join('\u0000');
  const [status, setStatus] = useState<WorkbenchModelCredentialStatus>(() =>
    model.runtimeMode === 'api' ? 'checking' : 'available',
  );

  useEffect(() => {
    let disposed = false;
    // Read the latest full snapshot while the effect is intentionally keyed
    // only by its credential identity (plus the explicit refresh signal).
    const credentialModel = hydrateTaskModelSnapshotRuntime(modelRef.current);
    if (credentialModel.runtimeMode !== 'api') {
      setStatus('available');
      return () => {
        disposed = true;
      };
    }

    setStatus('checking');
    void hasUsableDshTaskCredentialAsync(credentialModel)
      .then((available) => {
        if (!disposed) setStatus(available ? 'available' : 'unavailable');
      })
      .catch(() => {
        if (!disposed) setStatus('unavailable');
      });

    return () => {
      disposed = true;
    };
  }, [credentialIdentityKey, refreshSignal]);

  return {
    status,
    credentialAvailable: status === 'checking' ? undefined : status === 'available',
  };
}
