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
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});

const { createElement } = await import('react');
const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react');
const { default: SettingEditForm } = await import('./SettingEditForm');

afterEach(() => {
  cleanup();
});

const impact: WorldRuleChangeImpact = {
  novelId: 'novel-1',
  ruleSetFingerprint: 'rule-set-1',
  previewHash: 'preview-1',
  sources: [],
  affectedChapters: [],
  dependentRules: [],
  blockingConflicts: [],
  uncertainty: ['未证明语义一致'],
  requiresConfirmation: true,
};

test('first screen keeps title, long-form body, nature, scope and cost without injecting values', async () => {
  const previews: WorldRuleChange[] = [];
  render(
    createElement(SettingEditForm, {
      world: true,
      onClose: () => undefined,
      onSave: async () => undefined,
      onPreview: async (change) => {
        previews.push(change);
        return impact;
      },
    }),
  );
  const editor = screen.getByTestId('setting-editor-world-new');
  const title = editor.querySelector('[data-testid="setting-title"]') as HTMLInputElement;
  const content = editor.querySelector('[data-testid="setting-content"]') as HTMLTextAreaElement;
  assert.match(content.placeholder, /一句话/);
  assert.match(content.placeholder, /长文/);
  assert.equal(content.value, '');
  assert.ok(editor.querySelector('[data-testid="world-rule-kind"]'));
  assert.ok(screen.getByTestId('world-rule-scope'));
  assert.ok(screen.getByTestId('world-rule-cost'));
  fireEvent.change(title, { target: { value: '河港背景' } });
  fireEvent.change(content, { target: { value: '河港在暴雨后实行供水配额。' } });
  fireEvent.change(screen.getByTestId('world-parameter-economy_resources'), {
    target: { value: '每户每日三桶' },
  });
  fireEvent.click(screen.getByTestId('setting-impact-preview'));
  await waitFor(() => assert.ok(screen.getByTestId('setting-author-confirm')));
  assert.equal((screen.getByTestId('setting-save') as HTMLButtonElement).disabled, true);
  fireEvent.click(screen.getByTestId('setting-author-confirm'));
  assert.equal((screen.getByTestId('setting-save') as HTMLButtonElement).disabled, false);
  fireEvent.change(content, { target: { value: '河港实行配额，医院优先。' } });
  assert.equal(screen.queryByTestId('setting-impact-result'), null);
  assert.equal((screen.getByTestId('setting-save') as HTMLButtonElement).disabled, true);
  assert.equal(previews.length, 1);
  assert.equal(previews[0]?.content, '河港在暴雨后实行供水配额。');
});
