import assert from 'node:assert/strict';
import test from 'node:test';
import { isComposingKeyboardEvent } from './keyboardEvent';

test('keyboard composition detection covers native, React, and legacy Windows IME events', () => {
  for (const event of [
    { isComposing: true },
    { nativeEvent: { isComposing: true } },
    { keyCode: 229 },
    { nativeEvent: { keyCode: 229 } },
  ])
    assert.equal(isComposingKeyboardEvent(event), true);
  assert.equal(isComposingKeyboardEvent({}), false);
  assert.equal(
    isComposingKeyboardEvent({ keyCode: 13, nativeEvent: { isComposing: false } }),
    false,
  );
});
