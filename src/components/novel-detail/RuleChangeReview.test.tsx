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

const { createElement, useState } = await import('react');
const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { default: RuleChangeReview } = await import('./RuleChangeReview');

afterEach(() => {
  cleanup();
});

const impact: WorldRuleChangeImpact = {
  novelId: 'novel-1',
  ruleSetFingerprint: 'fp-abc123def',
  previewHash: 'hash-xyz789',
  sources: [{ sourceId: 's1' }],
  affectedChapters: [
    {
      chapterId: 'c1',
      title: '第一章 渡口',
      adoptedDraftId: 'd1',
      evidence: '该章已有采用稿；需要作者核对，不代表已证明矛盾',
      certainty: 'potential_impact',
    },
  ],
  dependentRules: [],
  blockingConflicts: [
    {
      code: 'RULE_DEPENDENCY_MISSING',
      ruleId: 'missing-1',
      certainty: 'verified_reference',
      reason: '依赖规则不属于当前作品；请先修订依赖，不可用作者确认覆盖',
    },
  ],
  uncertainty: ['影响范围采用保守估计'],
  requiresConfirmation: true,
};

const change: WorldRuleChange = {
  operation: 'upsert',
  targetType: 'rule_system',
  targetId: 'rule-1',
  title: '渡航规则',
  content: '普通渡船必须等待可通航的潮位。',
  isActive: false,
};

test('inline preview shows proposed full text, enable/disable, real hashes and human blocking items', () => {
  function Harness() {
    const [intent, setIntent] = useState<'confirm_change' | 'retcon' | 'approve_exception'>(
      'confirm_change',
    );
    const [notes, setNotes] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    return createElement(RuleChangeReview, {
      impact,
      change,
      intent,
      notes,
      confirmed,
      onIntent: setIntent,
      onNotes: setNotes,
      onConfirm: setConfirmed,
    });
  }
  render(createElement(Harness));
  assert.ok(screen.getByTestId('setting-impact-result'));
  assert.match(screen.getByTestId('setting-change-action').textContent ?? '', /停用/);
  assert.equal(
    screen.getByTestId('setting-change-preview').textContent?.includes(change.content),
    true,
  );
  assert.equal(screen.getByTestId('setting-impact-preview-hash').textContent, 'hash-xyz789');
  assert.equal(
    screen.getByTestId('setting-impact-ruleset-fingerprint').textContent,
    'fp-abc123def',
  );
  assert.match(screen.getByTestId('setting-impact-potential').textContent ?? '', /第一章 渡口/);
  assert.match(
    screen.getByTestId('setting-impact-potential').textContent ?? '',
    /不是已证明的矛盾/,
  );
  const blocking = screen.getByTestId('setting-impact-blocking').textContent ?? '';
  assert.match(blocking, /缺少当前作品中的显式依赖/);
  assert.equal(blocking.includes(JSON.stringify(impact.blockingConflicts)), false);
  assert.equal(blocking.includes('"ruleId"'), false);
  const confirm = screen.getByTestId('setting-author-confirm') as HTMLInputElement;
  assert.equal(confirm.checked, false);
  assert.equal(confirm.disabled, true);
  assert.ok(screen.getByTestId('setting-change-intent'));
  assert.ok(screen.getByTestId('setting-change-notes'));
});

test('editing intent does not auto-check author confirmation', () => {
  const openImpact: WorldRuleChangeImpact = { ...impact, blockingConflicts: [] };
  function Harness() {
    const [intent, setIntent] = useState<'confirm_change' | 'retcon' | 'approve_exception'>(
      'confirm_change',
    );
    const [notes, setNotes] = useState('');
    const [confirmed, setConfirmed] = useState(false);
    return createElement(RuleChangeReview, {
      impact: openImpact,
      change,
      intent,
      notes,
      confirmed,
      onIntent: (value) => {
        setIntent(value);
        setConfirmed(false);
      },
      onNotes: setNotes,
      onConfirm: setConfirmed,
    });
  }
  render(createElement(Harness));
  const confirm = screen.getByTestId('setting-author-confirm') as HTMLInputElement;
  assert.equal(confirm.disabled, false);
  fireEvent.click(confirm);
  assert.equal((screen.getByTestId('setting-author-confirm') as HTMLInputElement).checked, true);
  fireEvent.change(screen.getByTestId('setting-change-intent'), { target: { value: 'retcon' } });
  assert.equal((screen.getByTestId('setting-author-confirm') as HTMLInputElement).checked, false);
});
