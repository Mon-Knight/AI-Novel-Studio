import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/#/',
});
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  Node: { value: dom.window.Node, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});

const { createElement } = await import('react');
const { cleanup, render, screen } = await import('@testing-library/react');
const { default: WorldRuleSummary } = await import('./WorldRuleSummary');

afterEach(() => {
  cleanup();
});

test('summary gaps use a list, not alerts or meters', () => {
  render(createElement(WorldRuleSummary, {}));
  const root = screen.getByTestId('world-rule-structure-summary');
  assert.equal(root.querySelector('[role="alert"]'), null);
  assert.equal(root.querySelector('progress, meter'), null);
  assert.ok(screen.getByTestId('world-rule-structure-gaps'));
  assert.equal(root.querySelectorAll('[data-determined="false"]').length >= 4, true);
});
