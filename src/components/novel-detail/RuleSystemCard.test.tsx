import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import type { RuleSystem } from '../../types/setting';

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
const { createWorldRuleDocument, serializeWorldRuleDocument } =
  await import('../../services/worldRules/worldRuleSchema');
const { default: RuleSystemCard } = await import('./RuleSystemCard');

afterEach(() => {
  cleanup();
});

test('rule card shows structure summary beside the excerpt and keeps original e2e test ids', () => {
  const document = createWorldRuleDocument(
    'rule-1',
    '普通渡船必须等待可通航的潮位。',
    'causal_rule',
  );
  document.scope.summary = '普通渡船';
  const rule: RuleSystem = {
    id: 'rule-1',
    novelId: 'novel-1',
    title: '渡航规则',
    content: '普通渡船必须等待可通航的潮位。抢渡需要有可解释的路径与代价。',
    category: 'social',
    isActive: true,
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
    structuredJson: serializeWorldRuleDocument(document),
  };
  render(
    createElement(RuleSystemCard, {
      novelId: 'novel-1',
      ruleSystems: [rule],
      onSave: async () => undefined,
      onDelete: async () => undefined,
      onPreview: async () => {
        throw new Error('preview should not run');
      },
    }),
  );
  assert.ok(screen.getByTestId('rule-system-add'));
  assert.equal(screen.getByTestId('rule-system-edit').getAttribute('data-rule-id'), 'rule-1');
  const summary = screen.getByTestId('world-rule-structure-summary');
  assert.match(summary.textContent ?? '', /因果规则/);
  assert.match(summary.textContent ?? '', /普通渡船/);
  assert.match(summary.textContent ?? '', /认知/);
  assert.equal(summary.querySelector('[role="alert"]'), null);
});
