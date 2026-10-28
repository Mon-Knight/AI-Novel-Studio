import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type FocusEvent as ReactFocusEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';

interface TooltipTriggerProps {
  'aria-describedby'?: string;
  onMouseEnter?: (event: ReactMouseEvent<HTMLElement>) => void;
  onMouseLeave?: (event: ReactMouseEvent<HTMLElement>) => void;
  onFocus?: (event: ReactFocusEvent<HTMLElement>) => void;
  onBlur?: (event: ReactFocusEvent<HTMLElement>) => void;
}

interface TooltipProps {
  content: ReactNode;
  children: ReactElement<TooltipTriggerProps>;
  delayMs?: number;
  boundarySelector?: string;
}

interface TooltipPosition {
  left: number;
  top: number;
}

const MAX_TOOLTIP_WIDTH = 320;
const TOOLTIP_OPEN_EVENT = 'ans-ui-tooltip-open';

/**
 * A small, dependency-free tooltip anchored to the trigger. It is rendered in a portal so
 * sidebar rows never clip it and adjacent rows never receive its pointer surface.
 */
export function Tooltip({ content, children, delayMs = 160, boundarySelector }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TooltipPosition>({ left: 0, top: 0 });
  const timerRef = useRef<number | undefined>(undefined);

  const hide = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    setOpen(false);
  }, []);

  const schedule = useCallback(
    (trigger: HTMLElement) => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        const rect = trigger.getBoundingClientRect();
        const top = Math.min(Math.max(rect.top + rect.height / 2, 150), innerHeight - 150);
        const boundary = boundarySelector
          ? trigger.closest<HTMLElement>(boundarySelector)?.getBoundingClientRect()
          : undefined;
        const preferredLeft = Math.max(rect.right, boundary?.right ?? 0) + 8;
        const left = Math.max(8, Math.min(preferredLeft, innerWidth - MAX_TOOLTIP_WIDTH - 8));
        window.dispatchEvent(new CustomEvent(TOOLTIP_OPEN_EVENT, { detail: id }));
        setPosition({ left, top });
        setOpen(true);
      }, delayMs);
    },
    [boundarySelector, delayMs, id],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    },
    [],
  );

  useEffect(() => {
    const handleOtherTooltipOpen = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) hide();
    };
    window.addEventListener(TOOLTIP_OPEN_EVENT, handleOtherTooltipOpen);
    return () => window.removeEventListener(TOOLTIP_OPEN_EVENT, handleOtherTooltipOpen);
  }, [hide, id]);

  useEffect(() => {
    if (!open) return;
    const handleScroll = () => hide();
    const handleResize = () => hide();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('resize', handleResize);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hide, open]);

  const triggerProps = children.props;
  const trigger = cloneElement(children, {
    'aria-describedby': open ? id : triggerProps['aria-describedby'],
    onMouseEnter: (event: ReactMouseEvent<HTMLElement>) => {
      triggerProps.onMouseEnter?.(event);
      schedule(event.currentTarget);
    },
    onMouseLeave: (event: ReactMouseEvent<HTMLElement>) => {
      triggerProps.onMouseLeave?.(event);
      hide();
    },
    onFocus: (event: ReactFocusEvent<HTMLElement>) => {
      triggerProps.onFocus?.(event);
      schedule(event.currentTarget);
    },
    onBlur: (event: ReactFocusEvent<HTMLElement>) => {
      triggerProps.onBlur?.(event);
      hide();
    },
  });

  return (
    <>
      {trigger}
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            id={id}
            className="ui-tooltip"
            role="tooltip"
            data-testid="ui-tooltip"
            style={{ left: position.left, top: position.top }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
