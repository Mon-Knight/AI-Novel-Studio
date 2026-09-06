import { useRef, type HTMLAttributes, type ReactNode } from 'react';
import { useModalAccessibility } from './useModalAccessibility';

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
  useModalAccessibility({
    overlayRef,
    dialogRef,
    onDismiss,
    initialFocusSelector: '[data-startup-dialog-dismiss]',
  });

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
