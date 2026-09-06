import { useEffect, useRef, useState } from 'react';

/** A single timeout with remaining-time accounting; no time elapses while reading. */
export function usePausableDismiss({
  durationMs,
  active,
  identity,
  onDismiss,
}: {
  durationMs: number;
  active: boolean;
  identity: string | number;
  onDismiss: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(durationMs);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    remaining.current = durationMs;
  }, [identity, durationMs, active]);

  useEffect(() => {
    if (!active || durationMs <= 0 || hovered || focused) return;
    const started = Date.now();
    const timer = window.setTimeout(() => dismiss.current(), Math.max(0, remaining.current));
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - started));
    };
  }, [active, durationMs, identity, hovered, focused]);

  return {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onFocusCapture: () => setFocused(true),
    onBlurCapture: (event: React.FocusEvent<HTMLElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
    },
  };
}
