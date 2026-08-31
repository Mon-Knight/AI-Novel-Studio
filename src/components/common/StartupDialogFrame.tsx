import { useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';

type StartupDialogOverlayProps = HTMLAttributes<HTMLDivElement> & {
  [key: `data-${string}`]: string | undefined;
};

interface StartupDialogFrameProps {
  role: 'dialog' | 'alertdialog';
  labelledBy: string;
  maxWidth: number;
  onDismiss: () => void;
  overlayProps: StartupDialogOverlayProps;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function StartupDialogFrame({
  role,
  labelledBy,
  maxWidth,
  onDismiss,
  overlayProps,
  children,
}: StartupDialogFrameProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(
    typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null),
  );
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    const overlay = overlayRef.current;
    const dialog = dialogRef.current;
    if (!overlay || !dialog) return;
    const opener = openerRef.current;

    const backgroundNodes = Array.from(overlay.parentElement?.children ?? []).filter(
      (node): node is HTMLElement => node instanceof HTMLElement && node !== overlay,
    );
    const previousBackgroundState = backgroundNodes.map((node) => ({
      node,
      inert: Boolean(node.inert),
      ariaHidden: node.getAttribute('aria-hidden'),
    }));
    backgroundNodes.forEach((node) => {
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    });

    const initialFocusTimer = window.setTimeout(() => {
      dialog.querySelector<HTMLElement>('[data-startup-dialog-dismiss]')?.focus();
    }, 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismissRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(initialFocusTimer);
      previousBackgroundState.forEach(({ node, inert, ariaHidden }) => {
        node.inert = inert;
        if (ariaHidden === null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', ariaHidden);
      });
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div {...overlayProps} ref={overlayRef} className="startup-dialog-overlay">
      <section
        ref={dialogRef}
        className="startup-dialog"
        role={role}
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{ maxWidth }}
      >
        {children}
      </section>
    </div>
  );
}
