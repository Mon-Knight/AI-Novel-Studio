import { useEffect, useRef, type TextareaHTMLAttributes } from 'react';
import { goalTextareaHeight } from './goalTextareaLayout';

/** Grows without replacing the textarea, preserving the user's selection and IME session. */
export function GrowingGoalTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const textarea = ref.current;
    if (!textarea) return;
    const resize = () => {
      const style = window.getComputedStyle(textarea);
      const lineHeight = Number.parseFloat(style.lineHeight) || 22;
      const padding =
        (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
      textarea.style.height = 'auto';
      textarea.style.height = `${goalTextareaHeight(textarea.scrollHeight, lineHeight, padding, window.innerHeight)}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    let lastWidth = textarea.clientWidth;
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            if (textarea.clientWidth !== lastWidth) {
              lastWidth = textarea.clientWidth;
              resize();
            }
          });
    observer?.observe(textarea);
    return () => {
      window.removeEventListener('resize', resize);
      observer?.disconnect();
    };
  }, [props.value]);
  return (
    <textarea
      {...props}
      ref={ref}
      rows={2}
      style={{ ...props.style, maxHeight: '30vh', overflowY: 'auto', resize: 'none' }}
    />
  );
}
