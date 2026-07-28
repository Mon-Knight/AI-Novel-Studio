import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import React from 'react';
import type { AutonomousStoryPlan } from '../../types/autonomousCreation';
import AutonomousExecutionPanel from './AutonomousExecutionPanel';

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

function plan(overrides: Partial<AutonomousStoryPlan> = {}): AutonomousStoryPlan {
  return {
    chapters: [
      {
        id: 'chapter-1',
        chapterNumber: 1,
        volumeId: 'volume-1',
        arcId: 'arc-1',
        title: '第一章',
        outline: '找到线索',
        goal: '推进调查',
        targetWordCount: 2400,
        pacingMode: 'build',
        tension: 55,
        endingHook: '发现隐藏入口',
        conflictThreadIds: [],
        characterIds: [],
        characterBeatIds: [],
        worldElementIds: [],
        status: 'materialized',
      },
    ],
    chapterRuns: [],
    progress: {
      completedVolumeIds: [],
      currentVolumeIndex: 0,
      adoptedChapterNumbers: [],
      lastCheckpoint: '已应用',
    },
    ...overrides,
  } as AutonomousStoryPlan;
}

function renderPanel(value: AutonomousStoryPlan, calls: Record<string, number>) {
  render(
    React.createElement(AutonomousExecutionPanel, {
      plan: value,
      chapterRunning: false,
      bookRunning: false,
      analysisSaving: false,
      onGenerateCandidate: () => {
        calls.generate += 1;
      },
      onGenerateBookCandidates: () => {
        calls.book += 1;
      },
      onPauseBookCandidates: () => {
        calls.pause += 1;
      },
      onOpenCandidate: () => {
        calls.open += 1;
      },
      onRetryAnalysis: () => {
        calls.retry += 1;
      },
      onConfirmAnalysis: () => {
        calls.confirm += 1;
      },
      onViewWorldSuggestions: () => {
        calls.world += 1;
      },
    }),
  );
}

test('逐章面板只生成候选，并在六专家评审后引导用户到工作台采用', () => {
  const calls = { generate: 0, book: 0, pause: 0, open: 0, retry: 0, confirm: 0, world: 0 };
  let openedTarget: { chapterId: string; draftId: string } | undefined;
  const { rerender } = render(
    React.createElement(AutonomousExecutionPanel, {
      plan: plan(),
      chapterRunning: false,
      bookRunning: false,
      analysisSaving: false,
      onGenerateCandidate: () => {
        calls.generate += 1;
      },
      onGenerateBookCandidates: () => {
        calls.book += 1;
      },
      onPauseBookCandidates: () => {
        calls.pause += 1;
      },
      onOpenCandidate: (chapterId: string, draftId: string) => {
        calls.open += 1;
        openedTarget = { chapterId, draftId };
      },
      onRetryAnalysis: () => {
        calls.retry += 1;
      },
      onConfirmAnalysis: () => {
        calls.confirm += 1;
      },
      onViewWorldSuggestions: () => {
        calls.world += 1;
      },
    }),
  );

  fireEvent.click(screen.getByRole('button', { name: '生成下一章候选' }));
  assert.equal(calls.generate, 1);
  fireEvent.click(screen.getByRole('button', { name: '生成全书候选草稿' }));
  assert.equal(calls.book, 1);
  assert.equal(screen.queryByRole('button', { name: /自动采用/ }), null);

  const reviewedPlan = plan({
    chapterRuns: [
      {
        runId: 'run-1',
        operationId: 'operation-1',
        chapterId: 'chapter-1',
        chapterNumber: 1,
        status: 'candidate_ready',
        sourceDraftId: 'draft-1',
        candidateDraftId: 'draft-2',
        reviewSessionId: 'session-1',
        reviewAccepted: true,
        reviewAction: 'accept',
        acceptanceRate: 1,
        averageScore: 88,
        plannedCharacterBeatIds: [],
        confirmedCharacterBeatIds: [],
        createdAt: '2026-07-28T00:00:00Z',
        updatedAt: '2026-07-28T00:00:01Z',
      },
    ],
  });
  rerender(
    React.createElement(AutonomousExecutionPanel, {
      plan: reviewedPlan,
      chapterRunning: false,
      bookRunning: false,
      analysisSaving: false,
      onGenerateCandidate: () => {
        calls.generate += 1;
      },
      onGenerateBookCandidates: () => {
        calls.book += 1;
      },
      onPauseBookCandidates: () => {
        calls.pause += 1;
      },
      onOpenCandidate: (chapterId: string, draftId: string) => {
        calls.open += 1;
        openedTarget = { chapterId, draftId };
      },
      onRetryAnalysis: () => {
        calls.retry += 1;
      },
      onConfirmAnalysis: () => {
        calls.confirm += 1;
      },
      onViewWorldSuggestions: () => {
        calls.world += 1;
      },
    }),
  );

  assert.ok(screen.getByText('专家共识通过'));
  assert.ok(screen.getByText('接受率 100% · 均分 88'));
  fireEvent.click(screen.getByRole('button', { name: '在工作台审阅候选' }));
  assert.equal(calls.open, 1);
  assert.deepEqual(openedTarget, { chapterId: 'chapter-1', draftId: 'draft-2' });
});

test('章节分析明确等待确认，并提供世界候选入口', () => {
  const calls = { generate: 0, book: 0, pause: 0, open: 0, retry: 0, confirm: 0, world: 0 };
  const analyzedPlan = plan({
    chapters: [{ ...plan().chapters[0], status: 'adopted' }],
    progress: {
      completedVolumeIds: ['volume-1'],
      currentVolumeIndex: 1,
      adoptedChapterNumbers: [1],
      lastCheckpoint: '分析待确认',
    },
    chapterRuns: [
      {
        runId: 'run-1',
        operationId: 'operation-1',
        chapterId: 'chapter-1',
        chapterNumber: 1,
        status: 'adopted',
        adoptedDraftId: 'draft-2',
        plannedCharacterBeatIds: ['beat-1'],
        confirmedCharacterBeatIds: [],
        createdAt: '2026-07-28T00:00:00Z',
        updatedAt: '2026-07-28T00:00:01Z',
        analysis: {
          status: 'pending_confirmation',
          adoptedDraftId: 'draft-2',
          worldSuggestionIds: ['world-1'],
          updatedAt: '2026-07-28T00:00:01Z',
          result: {
            summary: '主角确认线索并进入新地点。',
            keyEvents: [],
            characterChanges: [],
            relationshipChanges: [],
            newForeshadows: [],
            resolvedForeshadows: [],
            nextChapterHints: '',
            newLocations: ['地下档案室'],
            contextRecords: [],
          },
        },
      },
    ],
  });

  renderPanel(analyzedPlan, calls);
  assert.ok(screen.getByText('主角确认线索并进入新地点。'));
  fireEvent.click(screen.getByRole('button', { name: '确认沉淀章节分析' }));
  fireEvent.click(screen.getByRole('button', { name: '查看世界候选' }));
  assert.equal(calls.confirm, 1);
  assert.equal(calls.world, 1);
});

test('桌面调度面板冻结三档策略、预算、时间窗和失败熔断配置', () => {
  let startedMode = '';
  render(
    React.createElement(AutonomousExecutionPanel, {
      plan: plan(),
      chapterRunning: false,
      bookRunning: false,
      analysisSaving: false,
      onGenerateCandidate: () => undefined,
      onGenerateBookCandidates: () => undefined,
      onPauseBookCandidates: () => undefined,
      onOpenCandidate: () => undefined,
      onRetryAnalysis: () => undefined,
      onConfirmAnalysis: () => undefined,
      onViewWorldSuggestions: () => undefined,
      scheduler: {
        capability: { persistent: true, runtime: 'tauri' },
        run: null,
        attempts: [],
        workerActive: false,
        busy: false,
      },
      onStartScheduler: (policy: { mode: string }) => {
        startedMode = policy.mode;
      },
      onPauseScheduler: () => undefined,
      onResumeScheduler: () => undefined,
      onStopScheduler: () => undefined,
    }),
  );

  assert.ok(screen.getByRole('region', { name: '跨进程无人值守调度' }));
  assert.ok(screen.getByLabelText('连续失败熔断'));
  assert.ok(screen.getByLabelText('每日 Token 上限'));
  fireEvent.click(screen.getByRole('button', { name: /全自动/ }));
  fireEvent.click(screen.getByRole('button', { name: '启动无人值守任务' }));
  assert.equal(startedMode, 'full_auto');
});
