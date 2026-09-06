import {
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { useModalAccessibility } from './useModalAccessibility';

type FrameAttributes = HTMLAttributes<HTMLDivElement> & {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

export interface ModalFrameProps {
  title: ReactNode;
  titleId?: string;
  children: ReactNode;
  footer?: ReactNode;
  onDismiss?: () => void;
  busy?: boolean;
  dismissOnBackdrop?: boolean;
  maxWidth?: number;
  initialFocusSelector?: string;
  overlayProps?: FrameAttributes;
  dialogProps?: FrameAttributes;
  className?: string;
  bodyClassName?: string;
  showCloseButton?: boolean;
  closeLabel?: string;
  closeButtonProps?: ButtonHTMLAttributes<HTMLButtonElement> & {
    [key: `data-${string}`]: string | undefined;
  };
  role?: 'dialog' | 'alertdialog';
}

export function ModalFrame({
  title,
  titleId,
  children,
  footer,
  onDismiss,
  busy = false,
  dismissOnBackdrop = true,
  maxWidth = 560,
  initialFocusSelector,
  overlayProps,
  dialogProps,
  className = '',
  bodyClassName = '',
  showCloseButton = true,
  closeLabel = '关闭',
  closeButtonProps,
  role = 'dialog',
}: ModalFrameProps) {
  const generatedId = useId();
  const headingId = titleId ?? `modal-title-${generatedId}`;
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalAccessibility({ overlayRef, dialogRef, onDismiss, busy, initialFocusSelector });

  return (
    <div
      {...overlayProps}
      ref={overlayRef}
      className={`modal-overlay ${overlayProps?.className ?? ''}`.trim()}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        if (!busy && dismissOnBackdrop) onDismiss?.();
      }}
    >
      <div
        {...dialogProps}
        ref={dialogRef}
        className={`modal-dialog modal-frame ${className} ${dialogProps?.className ?? ''}`.trim()}
        style={{ maxWidth, ...dialogProps?.style }}
        role={role}
        aria-modal="true"
        aria-labelledby={headingId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-frame-header">
          <h2 className="modal-title" id={headingId}>
            {title}
          </h2>
          {showCloseButton && onDismiss && (
            <button
              {...closeButtonProps}
              type="button"
              className="modal-frame-close"
              data-modal-close="true"
              aria-label={closeLabel}
              title={closeLabel}
              disabled={busy}
              onClick={onDismiss}
            >
              <X aria-hidden="true" size={18} strokeWidth={1.8} />
            </button>
          )}
        </header>
        <div className={`modal-frame-body ${bodyClassName}`.trim()}>{children}</div>
        {footer && <footer className="modal-frame-footer">{footer}</footer>}
      </div>
    </div>
  );
}
