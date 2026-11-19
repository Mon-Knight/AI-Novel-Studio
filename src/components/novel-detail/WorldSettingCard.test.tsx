import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import type { WorldSetting } from '../../types/setting';

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
const { default: WorldSettingCard } = await import('./WorldSettingCard');

afterEach(() => {
  cleanup();
});

const noopSave = async () => undefined;
const noopPreview = async () => {
  throw new Error('preview should not run in summary tests');
};

function setting(overrides: Partial<WorldSetting> = {}): WorldSetting {
  return {
    id: 'world-1',
    novelId: 'novel-1',
    title: '港口背景',
    content: '港口靠人工维护的潮汐闸门调节航道，渡船是两岸常用交通工具。',
    isActive: true,
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
    ...overrides,
  };
}

test('world card shows undetermined structure summary and neutral gaps instead of status bars', () => {
  render(
    createElement(WorldSettingCard, {
      novelId: 'novel-1',
      settings: [setting()],
      onSave: noopSave,
      onPreview: noopPreview,
    }),
  );
  const summary = screen.getByTestId('world-rule-structure-summary');
  assert.match(summary.textContent ?? '', /尚未补充结构化说明/);
  const gaps = screen.getByTestId('world-rule-structure-gaps');
  assert.match(gaps.textContent ?? '', /可按当前情节/);
  assert.equal(summary.querySelector('[role="alert"]'), null);
  assert.equal(summary.querySelector('progress'), null);
  assert.match(screen.getByTestId('world-setting-edit').textContent ?? '', /编辑/);
});

test('world card lists determined nature and filled world parameters without replacing user prose', () => {
  const document = createWorldRuleDocument('world-1', '港口靠闸门调节航道。', 'world_fact');
  document.scope.summary = '内河渡口';
  document.boundaries.cost = '延误一个潮汐窗口';
  document.worldParameters.institutions_power = '港务可封港';
  const content = '港口靠人工维护的潮汐闸门调节航道，渡船是两岸常用交通工具。';
  render(
    createElement(WorldSettingCard, {
      novelId: 'novel-1',
      settings: [
        setting({
          content,
          structuredJson: serializeWorldRuleDocument(document),
        }),
      ],
      onSave: noopSave,
      onPreview: noopPreview,
    }),
  );
  const proseNodes = screen.getAllByText(content, { exact: false });
  assert.ok(proseNodes.some((node) => node.classList.contains('detail-fact-text--pre')));
  assert.equal(
    proseNodes.every((node) => (node.textContent ?? '').includes(content)),
    true,
  );
  const summary = screen.getByTestId('world-rule-structure-summary');
  assert.match(summary.textContent ?? '', /世界事实/);
  assert.match(summary.textContent ?? '', /内河渡口/);
  assert.match(summary.textContent ?? '', /已填 1\/8/);
  assert.match(summary.textContent ?? '', /制度与权力/);
  assert.equal(summary.querySelector('[data-determined="true"]') !== null, true);
});
