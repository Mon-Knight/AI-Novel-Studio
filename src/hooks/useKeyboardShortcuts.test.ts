import assert from 'node:assert/strict';
import test from 'node:test';
import { useKeyboardShortcuts, type ShortcutDefinition } from './useKeyboardShortcuts';

test('useKeyboardShortcuts is defined and exports types correctly', () => {
  assert.equal(typeof useKeyboardShortcuts, 'function');
  const shortcut: ShortcutDefinition = {
    key: 's',
    ctrlOrMeta: true,
    allowInInputs: true,
    description: '保存正文',
    action: () => {},
  };
  assert.equal(shortcut.key, 's');
  assert.equal(shortcut.ctrlOrMeta, true);
});
