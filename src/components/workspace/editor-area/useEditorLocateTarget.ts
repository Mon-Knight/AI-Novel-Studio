import { useEffect, useState, type RefObject } from 'react';
import type { EditorAreaProps } from './editorAreaTypes';

interface UseEditorLocateTargetOptions {
  textareaRef: RefObject<HTMLTextAreaElement>;
  locateTarget: EditorAreaProps['locateTarget'];
  onLocateDone: EditorAreaProps['onLocateDone'];
}

export function useEditorLocateTarget({
  textareaRef,
  locateTarget,
  onLocateDone,
}: UseEditorLocateTargetOptions): void {
  const [, setHighlightRange] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    if (!locateTarget || !textareaRef.current) return;
    const textarea = textareaRef.current;
    const { startOffset, endOffset, quote, paragraphIndex } = locateTarget;
    let found = false;
    let selectionStart = 0;
    let selectionEnd = 0;

    if (startOffset >= 0 && endOffset >= 0 && startOffset < textarea.value.length) {
      selectionStart = startOffset;
      selectionEnd = Math.min(endOffset, textarea.value.length);
      found = true;
    } else if (paragraphIndex !== undefined && paragraphIndex >= 0) {
      const paragraphs = textarea.value.split(/\n\n+/);
      let position = 0;
      for (let index = 0; index < Math.min(paragraphIndex, paragraphs.length); index++) {
        if (index > 0) position += 2;
        position += paragraphs[index].length;
      }
      const paragraphText = paragraphs[Math.min(paragraphIndex, paragraphs.length - 1)] || '';
      selectionStart = Math.max(0, position - paragraphText.length);
      selectionEnd = Math.min(position, textarea.value.length);
      found = true;
    } else if (quote && quote.length >= 3) {
      const quoteIndex = textarea.value.indexOf(quote);
      if (quoteIndex >= 0) {
        selectionStart = quoteIndex;
        selectionEnd = quoteIndex + quote.length;
        found = true;
      } else {
        const shortQuote = quote.slice(0, Math.min(20, quote.length));
        if (shortQuote.length >= 3) {
          const fuzzyIndex = textarea.value.indexOf(shortQuote);
          if (fuzzyIndex >= 0) {
            selectionStart = fuzzyIndex;
            selectionEnd = fuzzyIndex + shortQuote.length;
            found = true;
          }
        }
      }
    }

    if (found) {
      textarea.focus();
      textarea.setSelectionRange(selectionStart, selectionEnd);
      setHighlightRange({ start: selectionStart, end: selectionEnd });
      const lineHeight = 24;
      const linesBefore = textarea.value.substring(0, selectionStart).split('\n').length;
      textarea.scrollTop = Math.max(0, (linesBefore - 5) * lineHeight);
    }

    const timer = setTimeout(() => {
      setHighlightRange(null);
      onLocateDone?.({
        found,
        message: found ? undefined : '原文片段可能已被修改，无法精确定位',
      });
    }, 2500);
    return () => clearTimeout(timer);
  }, [locateTarget, onLocateDone, textareaRef]);
}
