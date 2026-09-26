import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import type { WorldRuleChange, WorldRuleChangeImpact } from '../../types/worldRules';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/#/',
});
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  Node: { value: dom.window.Node, configurable: true },
  MutationObserver: { value: dom.window.MutationObserver, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});

const { createElement } = await import('react');
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { default: WorldRuleChangeConfirmation } = await import('./WorldRuleChangeConfirmation');

afterEach(() => {
  cleanup();
});

const preview: WorldRuleChangeImpact = {
  novelId: 'novel-1',
  ruleSetFingerprint: 'fp-confirm-1',
  previewHash: 'hash-confirm-1',
  sources: [],
  affectedChapters: [],
  dependentRules: [],
  blockingConflicts: [],
  uncertainty: [],
  requiresConfirmation: true,
};

const change: WorldRuleChange = {
  operation: 'delete',
  targetType: 'rule_system',
  targetId: 'rule-1',
  title: '旧配额规则',
  content: '每户三桶。',
  isActive: true,
};

test('popup preview shows full text, delete action, hashes and does not auto-approve', () => {
  const confirmed: unknown[] = [];
  render(
    createElement(WorldRuleChangeConfirmation, {
      preview,
      change,
      previewedContent: '删除《旧配额规则》及其规则内容，保留已采用正文。\n每户三桶。',
      onConfirm: (guard) => {
        confirmed.push(guard);
      },
      onCancel: () => undefined,
    }),
  );
  assert.ok(screen.getByTestId('world-rule-change-confirmation'));
  assert.match(screen.getByTestId('world-rule-previewed-content').textContent ?? '', /每户三桶/);
  assert.match(screen.getByTestId('setting-change-action').textContent ?? '', /永久删除/);
  assert.equal(screen.getByTestId('setting-impact-preview-hash').textContent, 'hash-confirm-1');
  assert.equal(
    screen.getByTestId('setting-impact-ruleset-fingerprint').textContent,
    'fp-confirm-1',
  );
  const save = screen.getByTestId('world-rule-change-confirm') as HTMLButtonElement;
  const checkbox = screen.getByTestId('setting-author-confirm') as HTMLInputElement;
  assert.equal(checkbox.checked, false);
  assert.equal(save.disabled, true);
  fireEvent.click(checkbox);
  assert.equal(
    (screen.getByTestId('world-rule-change-confirm') as HTMLButtonElement).disabled,
    false,
  );
  fireEvent.change(screen.getByTestId('setting-change-intent'), { target: { value: 'retcon' } });
  assert.equal((screen.getByTestId('setting-author-confirm') as HTMLInputElement).checked, false);
  assert.equal(
    (screen.getByTestId('world-rule-change-confirm') as HTMLButtonElement).disabled,
    true,
  );
  assert.equal(confirmed.length, 0);
});
