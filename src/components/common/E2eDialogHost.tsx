import { useCallback, useEffect, useRef, useState } from 'react';
import {
  registerE2eDialogHost,
  type E2eDialogRequest,
} from '../../utils/nativeDialog';

const enabled = import.meta.env.VITE_AI_NOVEL_STUDIO_E2E === '1';

function E2eDialogHost() {
  const [queue, setQueue] = useState<E2eDialogRequest[]>([]);
  const settledIds = useRef(new Set<number>());

  useEffect(() => {
    if (!enabled) return undefined;
    return registerE2eDialogHost((request) => {
      setQueue((current) => [...current, request]);
    });
  }, []);

  const current = queue[0];
  const settle = useCallback((confirmed: boolean) => {
    if (!current || settledIds.current.has(current.id)) return;
    settledIds.current.add(current.id);
    current.resolve(confirmed);
    setQueue((items) => items.filter((item) => item.id !== current.id));
  }, [current]);

  if (!enabled || !current) return null;

  return (
    <div
      className="modal-overlay"
      role={current.tone === 'error' ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-labelledby={`e2e-dialog-title-${current.id}`}
      data-e2e-dialog-host="true"
      data-testid={current.testId}
      data-dialog-id={current.testId}
      data-dialog-tone={current.tone}
    >
      <div className="modal-dialog" style={{ maxWidth: 480 }}>
        <div id={`e2e-dialog-title-${current.id}`} className="modal-title">
          {current.title}
        </div>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, color: 'var(--color-text-secondary)' }}>
          {current.message}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          {current.kind === 'confirm' && (
            <button
              type="button"
              className="btn btn-secondary"
              data-testid="dialog-cancel"
              onClick={() => settle(false)}
            >
              {current.cancelLabel}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            data-testid="dialog-confirm"
            onClick={() => settle(true)}
            style={current.tone === 'danger' || current.tone === 'error'
              ? { background: 'var(--color-error)', borderColor: 'var(--color-error)' }
              : undefined}
          >
            {current.okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default E2eDialogHost;
