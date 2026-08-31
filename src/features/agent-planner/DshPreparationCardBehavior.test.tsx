// DshPreparationCard 行为测试（jsdom + testing-library，node:test）。

import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import React from 'react';
import type {
  ChapterBaselineRevision,
  ChapterPreparationPlannerOptions,
  ChapterPreparationProposal,
} from '../../types/chapterPreparation';
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
  retrievedEvidence: [{ source: 'outline', revision: 7, summary: '已读大纲' }],
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
  revisions: ChapterBaselineRevision[] | null;
  revisionsLoading: boolean;
  revisionsError: string;
  summary: { runs: number; promptTokens: number; completionTokens: number; durationMs: number };
  summaryError: string;
  runCalls: { mode: DshPreparationMode; options?: ChapterPreparationPlannerOptions }[];
}

function baseHookState(overrides: Partial<FakeHookState> = {}): FakeHookState {
  return {
    proposal: null,
    planner: 'current',
    running: false,
    error: '',
    elapsedMs: null,
    revisions: [
      { source: 'outline', revision: 7 },
      { source: 'chapter_context', revision: 3 },
    ],
    revisionsLoading: false,
    revisionsError: '',
    summary: { runs: 0, promptTokens: 0, completionTokens: 0, durationMs: 0 },
    summaryError: '',
    runCalls: [],
    ...overrides,
  };
}

function renderWithHook(
  state: FakeHookState,
  apiKey: string | undefined = 'sk-test',
  modelName = 'deepseek-v4-flash',
  baseUrl?: string,
) {
  const hook = () => ({
    proposal: state.proposal,
    planner: state.planner,
    running: state.running,
    error: state.error,
    elapsedMs: state.elapsedMs,
    revisions: state.revisions,
    revisionsLoading: state.revisionsLoading,
    revisionsError: state.revisionsError,
    summary: state.summary,
    summaryError: state.summaryError,
    run: (mode: DshPreparationMode, options?: ChapterPreparationPlannerOptions) => {
      state.runCalls.push({ mode, options });
      return Promise.resolve();
    },
  });
  return render(
    React.createElement(DshPreparationCard, {
      novelId: 'nov-a',
      chapterId: 'ch-a1',
      apiKey,
      baseUrl,
      modelName,
      hook,
    }),
  );
}

test('无 apiKey 时禁用 DSH 按钮并提示', () => {
  renderWithHook(baseHookState(), '');
  const dshButton = screen.getByTestId('dsh-run-dsh');
  assert.equal((dshButton as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByTestId('dsh-no-key'));
});

test('修订号未就绪时禁用两个按钮并展示加载态', () => {
  renderWithHook(baseHookState({ revisions: null, revisionsLoading: true }));
  assert.equal((screen.getByTestId('dsh-run-dsh') as HTMLButtonElement).disabled, true);
  assert.equal((screen.getByTestId('dsh-run-current') as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByTestId('dsh-revisions-loading'));
});

test('修订号就绪后展示六来源快照', () => {
  renderWithHook(baseHookState());
  const ready = screen.getByTestId('dsh-revisions-ready');
  assert.ok(ready.textContent?.includes('outline=7'));
});

test('展示 DSH 用量并明确它不是预算门禁', () => {
  renderWithHook(
    baseHookState({
      summary: { runs: 3, promptTokens: 4500, completionTokens: 8800, durationMs: 12000 },
    }),
  );
  const summary = screen.getByTestId('dsh-usage-summary');
  assert.ok(summary.textContent?.includes('3 次'));
  assert.ok(summary.textContent?.includes('4500'));
  assert.ok(summary.textContent?.includes('8800'));
  assert.ok(summary.textContent?.includes('不替代全局预算门禁'));
});

test('用量汇总读取失败会显示警告', () => {
  renderWithHook(baseHookState({ summaryError: '汇总读取失败' }));
  assert.equal(screen.getByTestId('dsh-summary-error').textContent, '汇总读取失败');
});

test('点击 DSH 按钮携带 apiKey 与 deepseek 模型', () => {
  const state = baseHookState();
  renderWithHook(state);
  fireEvent.click(screen.getByTestId('dsh-run-dsh'));
  assert.equal(state.runCalls.length, 1);
  assert.equal(state.runCalls[0].mode, 'dsh');
  assert.equal(state.runCalls[0].options?.apiKey, 'sk-test');
  assert.equal(state.runCalls[0].options?.model, 'deepseek-v4-flash');
});

test('点击 DSH 按钮原样携带 OpenAI-compatible Base URL 与非 DeepSeek 模型', () => {
  const state = baseHookState();
  renderWithHook(state, 'test-session-key', 'gpt-5.6-luna', 'http://localhost:12074/v1');
  fireEvent.click(screen.getByTestId('dsh-run-dsh'));
  assert.deepEqual(state.runCalls[0], {
    mode: 'dsh',
    options: {
      apiKey: 'test-session-key',
      baseUrl: 'http://localhost:12074/v1',
      model: 'gpt-5.6-luna',
    },
  });
});

test('点击当前 Planner 按钮走确定性映射', () => {
  const state = baseHookState({ planner: 'dsh' });
  renderWithHook(state);
  fireEvent.click(screen.getByTestId('dsh-run-current'));
  assert.equal(state.runCalls[0].mode, 'current');
  assert.equal(state.runCalls[0].options, undefined);
});

test('提案展示归一标记与度量', () => {
  const state = baseHookState({ proposal, planner: 'dsh' });
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
  const state = baseHookState({ error: 'DSH 提案生成失败' });
  renderWithHook(state);
  assert.equal(screen.getByTestId('dsh-error').textContent, 'DSH 提案生成失败');
});
