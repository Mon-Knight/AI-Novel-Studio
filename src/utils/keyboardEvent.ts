/** Covers native events, React events, and Windows IME's legacy 229 key code. */
export function isComposingKeyboardEvent(event: {
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
}): boolean {
  return Boolean(
    event.isComposing ||
    event.nativeEvent?.isComposing ||
    event.keyCode === 229 ||
    event.nativeEvent?.keyCode === 229,
  );
}
