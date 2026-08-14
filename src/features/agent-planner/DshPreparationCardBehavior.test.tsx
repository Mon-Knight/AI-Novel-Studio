// DshPreparationCard 行为测试（jsdom + testing-library，node:test）。

import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import React from 'react';
import type { ChapterPreparationProposal } from '../../types/chapterPreparation';
import { DshPreparationCard } from './DshPreparationCard';
import type { DshPreparationMode } from './useDshPreparation';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  Node: { value: dom.window.Node, configurable: true },
  MutationObserver: { value: dom.window.MutationObserver, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});

const { cleanup, fireEvent, render, screen } = await import('@testing-library/react');

afterEach(() => cleanup());
after(() => dom.window.close());

const proposal: ChapterPreparationProposal = {
  schemaVersion: 1,
  planner: 'dsh_spike_v0',
  targetChapter: { novelId: 'nov-a', chapterId: 'ch-a1' },
  baselineRevisions: [],
  retrievedEvidence: [{ source: 'outline', revision: 0, summary: '已读大纲' }],
  chapterGoals: ['推进主线'],
  scenePlan: [{ title: '场景一', purpose: '揭示线索' }],
  characterConstraints: [{ characterId: 'char-1', constraint: '不登场' }],
  continuityRisks: [{ kind: '时间线', description: '倒计时衔接', severity: 'high' }],
  unresolvedQuestions: ['谁来接应'],
  recommendedActions: [{ type: 'ask_user', description: '确认接应人选' }],
  producedAt: '2026-08-14T00:00:00Z',
  metrics: {
    planner: 'dsh_spike_v0',
    durationMs: 45000,
    promptTokens: 1200,
    completionTokens: 3000,
    toolCallCount: 6,
    plannerCoerced: { original: 'dsp_spike_v0', distance: 1 },
  },
};

interface FakeHookState {
  proposal: ChapterPreparationProposal | null;
  planner: DshPreparationMode;
  running: boolean;
  error: string;
  elapsedMs: number | null;
  runCalls: { mode: DshPreparationMode; options?: { apiKey?: string; model?: string } }[];
}

function renderWithHook(state: FakeHookState) {
  const hook = () => ({
    proposal: state.proposal,
    planner: state.planner,
    running: state.running,
    error: state.error,
    elapsedMs: state.elapsedMs,
    run: (mode: DshPreparationMode, options?: { apiKey?: string; model?: string }) => {
      state.runCalls.push({ mode, options });
      return Promise.resolve();
    },
  });
  return render(
    React.createElement(DshPreparationCard, {
      novelId: 'nov-a',
      chapterId: 'ch-a1',
      apiKey: 'sk-test',
      modelName: 'deepseek-v4-flash',
      hook,
    }),
  );
}

test('无 apiKey 时禁用 DSH 按钮并提示', () => {
  const state: FakeHookState = {
    proposal: null,
    planner: 'current',
    running: false,
    error: '',
    elapsedMs: null,
    runCalls: [],
  };
  render(
    React.createElement(DshPreparationCard, {
      novelId: 'nov-a',
      chapterId: 'ch-a1',
      apiKey: undefined,
      hook: () => ({
        proposal: state.proposal,
        planner: state.planner,
        running: state.running,
        error: state.error,
        elapsedMs: state.elapsedMs,
        run: () => Promise.resolve(),
      }),
    }),
  );
  const dshButton = screen.getByTestId('dsh-run-dsh');
  assert.equal((dshButton as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByTestId('dsh-no-key'));
});

test('点击 DSH 按钮携带 apiKey 与 deepseek 模型', () => {
  const state: FakeHookState = {
    proposal: null,
    planner: 'current',
    running: false,
    error: '',
    elapsedMs: null,
    runCalls: [],
  };
  renderWithHook(state);
  fireEvent.click(screen.getByTestId('dsh-run-dsh'));
  assert.equal(state.runCalls.length, 1);
  assert.equal(state.runCalls[0].mode, 'dsh');
  assert.equal(state.runCalls[0].options?.apiKey, 'sk-test');
  assert.equal(state.runCalls[0].options?.model, 'deepseek-v4-flash');
});

test('点击当前 Planner 按钮走确定性映射', () => {
  const state: FakeHookState = {
    proposal: null,
    planner: 'dsh',
    running: false,
    error: '',
    elapsedMs: null,
    runCalls: [],
  };
  renderWithHook(state);
  fireEvent.click(screen.getByTestId('dsh-run-current'));
  assert.equal(state.runCalls[0].mode, 'current');
  assert.equal(state.runCalls[0].options, undefined);
});

test('提案展示归一标记与度量', () => {
  const state: FakeHookState = {
    proposal,
    planner: 'dsh',
    running: false,
    error: '',
    elapsedMs: null,
    runCalls: [],
  };
  renderWithHook(state);
  assert.ok(screen.getByTestId('dsh-proposal'));
  const mark = screen.getByTestId('dsh-coercion-mark');
  assert.ok(mark.textContent?.includes('dsp_spike_v0'));
  assert.ok(screen.getAllByText(/耗时 45.0s/).length > 0);
  assert.ok(screen.getAllByText(/工具 6 次/).length > 0);
  assert.ok(screen.getAllByText(/倒计时衔接/).length > 0);
  assert.ok(screen.getAllByText(/询问用户/).length > 0);
});

test('错误信息展示', () => {
  const state: FakeHookState = {
    proposal: null,
    planner: 'dsh',
    running: false,
    error: 'DSH 提案生成失败',
    elapsedMs: null,
    runCalls: [],
  };
  renderWithHook(state);
  assert.equal(screen.getByTestId('dsh-error').textContent, 'DSH 提案生成失败');
});
