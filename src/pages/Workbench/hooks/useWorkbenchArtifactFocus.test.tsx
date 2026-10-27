/** @vitest-environment jsdom */
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useWorkbenchArtifactFocus } from './useWorkbenchArtifactFocus';

const initialWidth = window.innerWidth;
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: initialWidth });
});

test('explicit navigation closes only temporary narrow panels and assigns a fresh request', () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
  const close = vi.fn();
  const { result } = renderHook(() => useWorkbenchArtifactFocus('conversation-a', close));
  act(() => result.current.onLocateArtifact('card-a'));
  const first = result.current.artifactFocusRequest;
  expect(first).toMatchObject({ conversationId: 'conversation-a', cardId: 'card-a' });
  expect(close).toHaveBeenCalledTimes(1);
  act(() => result.current.onLocateArtifact('card-a'));
  expect(result.current.artifactFocusRequest?.requestId).not.toBe(first?.requestId);
});

test('wide reference panel stays docked while an exact candidate is requested', () => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 2560 });
  const close = vi.fn();
  const { result } = renderHook(() => useWorkbenchArtifactFocus('conversation-a', close));
  act(() => result.current.onLocateArtifact('card-a'));
  expect(result.current.artifactFocusRequest?.cardId).toBe('card-a');
  expect(close).not.toHaveBeenCalled();
});

test('switching tasks clears an old navigation request instead of replaying it on return', () => {
  const close = vi.fn();
  const { result, rerender } = renderHook(({ id }) => useWorkbenchArtifactFocus(id, close), {
    initialProps: { id: 'a' },
  });
  act(() => result.current.onLocateArtifact('card-a'));
  rerender({ id: 'b' });
  expect(result.current.artifactFocusRequest).toBeUndefined();
  rerender({ id: 'a' });
  expect(result.current.artifactFocusRequest).toBeUndefined();
  rerender({ id: '' });
  act(() => result.current.onLocateArtifact('card-a'));
  expect(result.current.artifactFocusRequest).toBeUndefined();
});
