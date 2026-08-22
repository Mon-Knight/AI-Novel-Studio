import { useEffect, useRef } from 'react';

export interface ShortcutDefinition {
  /** Target key, case-insensitive (e.g., 's', 'Enter', 'Escape', '/') */
  key: string;
  /** Whether Ctrl (Windows/Linux) or Cmd (macOS) is required */
  ctrlOrMeta?: boolean;
  /** Whether Shift key is required */
  shift?: boolean;
  /** Whether Alt key is required */
  alt?: boolean;
  /** Whether to trigger even when focused inside input/textarea/editable element */
  allowInInputs?: boolean;
  /** Prevents default browser action if true (default: true) */
  preventDefault?: boolean;
  /** Whether this shortcut is currently disabled */
  disabled?: boolean;
  /** Human-readable description for UI hints/tooltips */
  description?: string;
  /** Callback action */
  action: (event: KeyboardEvent) => void | Promise<void>;
}

export function useKeyboardShortcuts(shortcuts: ShortcutDefinition[]): void {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const activeElement = document.activeElement as HTMLElement | null;
      const isInput =
        activeElement &&
        (activeElement.tagName === 'INPUT' ||
          activeElement.tagName === 'TEXTAREA' ||
          activeElement.isContentEditable ||
          activeElement.getAttribute('role') === 'textbox');

      for (const shortcut of shortcutsRef.current) {
        if (shortcut.disabled) continue;

        // Check input suppression
        if (isInput && !shortcut.allowInInputs) continue;

        // Check key matching (case-insensitive)
        const keyMatch =
          event.key.toLowerCase() === shortcut.key.toLowerCase() ||
          event.code.toLowerCase() === `key${shortcut.key.toLowerCase()}`;
        if (!keyMatch) continue;

        // Check modifier keys
        const ctrlOrMeta = Boolean(shortcut.ctrlOrMeta);
        const actualCtrlOrMeta = event.ctrlKey || event.metaKey;
        if (ctrlOrMeta !== actualCtrlOrMeta) continue;

        const shift = Boolean(shortcut.shift);
        if (shift !== event.shiftKey) continue;

        const alt = Boolean(shortcut.alt);
        if (alt !== event.altKey) continue;

        // Match found!
        if (shortcut.preventDefault !== false) {
          event.preventDefault();
        }

        void shortcut.action(event);
        break; // Match first matching shortcut
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}
