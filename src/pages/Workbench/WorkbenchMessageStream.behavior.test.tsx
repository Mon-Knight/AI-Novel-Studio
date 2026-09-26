import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import type { ComponentProps } from 'react';
import type { TaskConversationBundle } from '../../types/conversation';
import { clearWorkbenchPresentationReading } from '../../features/workbench/workbenchPresentationReading';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/#/',
});

Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  Event: { value: dom.window.Event, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});

const { act, cleanup, fireEvent, render, screen } = await import('@testing-library/react');
const { WorkbenchMessageStream } = await import('./WorkbenchMessageStream');
const { expandWorkbenchAncestorDetails, useWorkbenchPresentationScroll } =
  await import('./hooks/useWorkbenchPresentationScroll');
const { completedReadDisclosureKey, groupWorkbenchDisplaySegments, projectWorkbenchEvents } =
  await import('../../features/workbench/workbenchPresentation');

let nextFrameId = 1;
let frameCallbacks = new Map<number, FrameRequestCallback>();
let reducedMotion = false;

function bundleWithContent(content: string): TaskConversationBundle {
  return {
    conversation: {
      conversationId: 'conversation-scroll',
      novelId: 'novel-scroll',
      title: '流式跟随测试',
      status: 'running',
      createdAt: '2026-08-29T01:00:00.000Z',
      updatedAt: '2026-08-29T01:00:00.000Z',
    },
    turns: [
      {
        turnId: 'turn-scroll',
        conversationId: 'conversation-scroll',
        sequence: 1,
        role: 'assistant',
        content,
        createdAt: '2026-08-29T01:00:00.000Z',
      },
    ],
    runs: [],
    toolEvents: [],
    artifacts: [],
  };
}

function longConversationBundle(turnCount = 24): TaskConversationBundle {
  const bundle = bundleWithContent('占位');
  bundle.conversation.conversationId = 'conversation-long-history';
  bundle.conversation.title = '长会话投影测试';
  bundle.conversation.status = 'waiting_user';
  bundle.turns = Array.from({ length: turnCount }, (_, index) => ({
    turnId: `turn-history-${index + 1}`,
    conversationId: bundle.conversation.conversationId,
    sequence: index + 1,
    role: 'user' as const,
    content: `历史回合 ${index + 1}`,
    createdAt: `2026-08-29T01:${String(index).padStart(2, '0')}:00.000Z`,
  }));
  bundle.runs = bundle.turns.map((turn, index) => ({
    runId: `run-history-${index + 1}`,
    conversationId: bundle.conversation.conversationId,
    turnId: turn.turnId,
    workerId: 'worker-history',
    status: 'completed' as const,
    modelSnapshot: {
      providerId: 'openai_compatible',
      modelId: 'gpt-5.6-luna',
      runtimeMode: 'api' as const,
      capabilities: ['conversation_turn'],
      options: {},
      capturedAt: turn.createdAt,
    },
    createdAt: turn.createdAt,
    updatedAt: turn.createdAt,
    finishedAt: turn.createdAt,
  }));
  bundle.toolEvents = bundle.runs.map((run, index) => ({
    eventId: `event-history-${index + 1}`,
    runId: run.runId,
    sequence: 1,
    toolName: 'generate_chapter',
    argumentsSummary: { chapter: index + 1 },
    result: { payload: `隐藏工具详情 ${index + 1} ${'证据'.repeat(2_000)}` },
    status: 'succeeded' as const,
    createdAt: run.createdAt,
    finishedAt: run.finishedAt,
  }));
  bundle.artifacts = bundle.runs.map((run, index) => ({
    cardId: `card-history-${index + 1}`,
    conversationId: bundle.conversation.conversationId,
    runId: run.runId,
    artifactId: `artifact-history-${index + 1}`,
    artifactType: 'chapter_text',
    title: `第 ${index + 1} 章候选`,
    summary: `候选摘要 ${index + 1}`,
    content: `隐藏正文 ${index + 1} ${'正文'.repeat(2_000)}`,
    status: 'confirmed' as const,
    createdAt: run.createdAt,
  }));
  return bundle;
}

function streamElement(
  bundle: TaskConversationBundle,
  overrides: Partial<ComponentProps<typeof WorkbenchMessageStream>> = {},
) {
  return (
    <WorkbenchMessageStream
      bundle={bundle}
      compressionCandidate={null}
      compressionBusy={false}
      decisionBusyCardId=""
      assetRecovery={null}
      assetReadinessBusy={false}
      selectedConversationRunning={false}
      chapterSummaryOrchestration={{ phase: 'none' }}
      onDismissCompression={() => undefined}
      onDecideArtifact={() => undefined}
      onRetry={() => undefined}
      onGenerateMissingAsset={() => undefined}
      onEditMissingAsset={() => undefined}
      onRefreshAssetReadiness={() => undefined}
      onResumeChapterGoal={() => undefined}
      onDismissAssetReadiness={() => undefined}
      {...overrides}
    />
  );
}

function renderStream(bundle: TaskConversationBundle) {
  return render(streamElement(bundle));
}

function flushAnimationFrames(): void {
  const pending = [...frameCallbacks.values()];
  frameCallbacks.clear();
  pending.forEach((callback) => callback(0));
}

beforeEach(() => {
  clearWorkbenchPresentationReading();
  nextFrameId = 1;
  frameCallbacks = new Map();
  reducedMotion = false;
  window.requestAnimationFrame = (callback) => {
    const frameId = nextFrameId++;
    frameCallbacks.set(frameId, callback);
    return frameId;
  };
  window.cancelAnimationFrame = (frameId) => {
    frameCallbacks.delete(frameId);
  };
  window.matchMedia = ((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' && reducedMotion,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  })) as typeof window.matchMedia;
});

afterEach(() => cleanup());

test('automatic stream updates coalesce in RAF and scroll immediately', () => {
  const view = renderStream(bundleWithContent('第一段'));
  const list = screen.getByTestId('workbench-message-list') as HTMLElement;
  const calls: ScrollToOptions[] = [];
  Object.defineProperties(list, {
    scrollHeight: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 240 },
    scrollTo: {
      configurable: true,
      value: (options: ScrollToOptions) => calls.push(options),
    },
  });

  view.rerender(
    <WorkbenchMessageStream
      bundle={bundleWithContent('第一段，继续流式更新')}
      compressionCandidate={null}
      compressionBusy={false}
      decisionBusyCardId=""
      assetRecovery={null}
      assetReadinessBusy={false}
      selectedConversationRunning={false}
      chapterSummaryOrchestration={{ phase: 'none' }}
      onDismissCompression={() => undefined}
      onDecideArtifact={() => undefined}
      onRetry={() => undefined}
      onGenerateMissingAsset={() => undefined}
      onEditMissingAsset={() => undefined}
      onRefreshAssetReadiness={() => undefined}
      onResumeChapterGoal={() => undefined}
      onDismissAssetReadiness={() => undefined}
    />,
  );

  assert.equal(frameCallbacks.size, 1);
  flushAnimationFrames();
  assert.deepEqual(calls, [{ top: 900, behavior: 'auto' }]);
});

test('only the explicit latest-progress action scrolls smoothly and honors reduced motion', () => {
  const view = renderStream(bundleWithContent('第一段'));
  const list = screen.getByTestId('workbench-message-list') as HTMLElement;
  const calls: ScrollToOptions[] = [];
  Object.defineProperties(list, {
    scrollHeight: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 240 },
    scrollTop: { configurable: true, writable: true, value: 0 },
    scrollTo: {
      configurable: true,
      value: (options: ScrollToOptions) => calls.push(options),
    },
  });
  flushAnimationFrames();
  calls.length = 0;

  fireEvent.scroll(list);
  view.rerender(
    <WorkbenchMessageStream
      bundle={bundleWithContent('第一段，新增进展')}
      compressionCandidate={null}
      compressionBusy={false}
      decisionBusyCardId=""
      assetRecovery={null}
      assetReadinessBusy={false}
      selectedConversationRunning={false}
      chapterSummaryOrchestration={{ phase: 'none' }}
      onDismissCompression={() => undefined}
      onDecideArtifact={() => undefined}
      onRetry={() => undefined}
      onGenerateMissingAsset={() => undefined}
      onEditMissingAsset={() => undefined}
      onRefreshAssetReadiness={() => undefined}
      onResumeChapterGoal={() => undefined}
      onDismissAssetReadiness={() => undefined}
    />,
  );
  const latestDock = screen.getByTestId('workbench-latest-dock');
  assert.equal(latestDock.previousElementSibling, list);
  assert.equal(latestDock.parentElement, list.parentElement);
  fireEvent.click(screen.getByRole('button', { name: '查看最新进展' }));
  assert.deepEqual(calls, [{ top: 900, behavior: 'smooth' }]);

  fireEvent.wheel(list, { deltaY: -120 });
  fireEvent.scroll(list);
  view.rerender(
    <WorkbenchMessageStream
      bundle={bundleWithContent('第一段，新增进展，再次更新')}
      compressionCandidate={null}
      compressionBusy={false}
      decisionBusyCardId=""
      assetRecovery={null}
      assetReadinessBusy={false}
      selectedConversationRunning={false}
      chapterSummaryOrchestration={{ phase: 'none' }}
      onDismissCompression={() => undefined}
      onDecideArtifact={() => undefined}
      onRetry={() => undefined}
      onGenerateMissingAsset={() => undefined}
      onEditMissingAsset={() => undefined}
      onRefreshAssetReadiness={() => undefined}
      onResumeChapterGoal={() => undefined}
      onDismissAssetReadiness={() => undefined}
    />,
  );
  reducedMotion = true;
  fireEvent.click(screen.getByRole('button', { name: '查看最新进展' }));
  assert.deepEqual(calls[calls.length - 1], { top: 900, behavior: 'auto' });
});

test('closely spaced artifact arrivals keep an independent full feedback window', () => {
  const originalSetTimeout = window.setTimeout.bind(window);
  const originalClearTimeout = window.clearTimeout.bind(window);
  const arrivalTimers = new Map<number, () => void>();
  let nextTimerId = 10_000;
  window.setTimeout = ((handler: TimerHandler, timeout?: number) => {
    if (timeout === 220 && typeof handler === 'function') {
      const timerId = nextTimerId++;
      arrivalTimers.set(timerId, () => handler());
      return timerId;
    }
    return originalSetTimeout(handler, timeout);
  }) as typeof window.setTimeout;
  window.clearTimeout = ((timerId?: number) => {
    if (typeof timerId === 'number' && arrivalTimers.delete(timerId)) return;
    originalClearTimeout(timerId);
  }) as typeof window.clearTimeout;

  try {
    const initial = bundleWithContent('产物到达基线');
    const view = renderStream(initial);
    const first = bundleWithContent('第一张产物到达');
    first.artifacts = [
      {
        cardId: 'arrival-card-1',
        conversationId: first.conversation.conversationId,
        artifactId: 'arrival-artifact-1',
        artifactType: 'quality_report',
        title: '第一张核对结果',
        summary: '第一张产物摘要',
        status: 'candidate',
        createdAt: '2026-08-29T01:01:00.000Z',
      },
    ];
    view.rerender(streamElement(first));
    const firstCard = document.querySelector<HTMLElement>('[data-card-id="arrival-card-1"]');
    assert.equal(firstCard?.dataset.newlyArrived, 'true');
    assert.equal(arrivalTimers.size, 1);

    const second = bundleWithContent('第二张产物紧接着到达');
    second.artifacts = [
      ...first.artifacts,
      {
        cardId: 'arrival-card-2',
        conversationId: second.conversation.conversationId,
        artifactId: 'arrival-artifact-2',
        artifactType: 'style_analysis',
        title: '第二张风格结果',
        summary: '第二张产物摘要',
        status: 'candidate',
        createdAt: '2026-08-29T01:01:00.100Z',
      },
    ];
    view.rerender(streamElement(second));
    const secondCard = document.querySelector<HTMLElement>('[data-card-id="arrival-card-2"]');
    assert.equal(firstCard?.dataset.newlyArrived, 'true');
    assert.equal(secondCard?.dataset.newlyArrived, 'true');
    assert.equal(arrivalTimers.size, 2);

    const [firstTimerId, secondTimerId] = [...arrivalTimers.keys()];
    assert.ok(firstTimerId !== undefined && secondTimerId !== undefined);
    act(() => arrivalTimers.get(firstTimerId)?.());
    arrivalTimers.delete(firstTimerId);
    assert.equal(firstCard?.dataset.newlyArrived, undefined);
    assert.equal(secondCard?.dataset.newlyArrived, 'true');

    act(() => arrivalTimers.get(secondTimerId)?.());
    arrivalTimers.delete(secondTimerId);
    assert.equal(secondCard?.dataset.newlyArrived, undefined);
  } finally {
    window.setTimeout = originalSetTimeout;
    window.clearTimeout = originalClearTimeout;
  }
});

test('long conversations mount only the latest history window and restore older records on demand', () => {
  renderStream(longConversationBundle());
  const list = screen.getByTestId('workbench-message-list');

  assert.equal(list.getAttribute('data-total-turn-count'), '24');
  assert.equal(list.getAttribute('data-visible-turn-count'), '8');
  assert.equal(list.getAttribute('data-hidden-turn-count'), '16');
  assert.equal(screen.getAllByTestId('workbench-turn').length, 8);
  assert.equal(screen.queryByText('历史回合 1'), null);
  assert.ok(screen.getByText('历史回合 24'));
  assert.doesNotMatch(document.body.textContent ?? '', /隐藏正文 24/);
  assert.doesNotMatch(document.body.textContent ?? '', /隐藏工具详情 24/);

  fireEvent.click(screen.getByTestId('workbench-load-earlier'));
  assert.equal(list.getAttribute('data-visible-turn-count'), '16');
  assert.equal(screen.getAllByTestId('workbench-turn').length, 16);
  assert.ok(screen.getByText('历史回合 9'));
  assert.equal(screen.queryByText('历史回合 8'), null);

  fireEvent.click(screen.getByTestId('workbench-load-earlier'));
  assert.equal(list.getAttribute('data-visible-turn-count'), '24');
  assert.ok(screen.getByText('历史回合 1'));

  fireEvent.click(screen.getByTestId('workbench-collapse-history'));
  assert.equal(list.getAttribute('data-visible-turn-count'), '8');
  assert.equal(screen.getAllByTestId('workbench-turn').length, 8);
  assert.equal(screen.queryByText('历史回合 1'), null);
  assert.ok(screen.getByText('历史回合 24'));
});

test('a retry appears at its own activity position and reveals its original user round only on request', () => {
  const bundle = longConversationBundle(12);
  bundle.runs.push({
    ...bundle.runs[0],
    runId: 'run-restored-original-goal',
    status: 'completed',
    createdAt: '2026-08-29T02:00:00.000Z',
    updatedAt: '2026-08-29T02:00:00.000Z',
    finishedAt: '2026-08-29T02:00:00.000Z',
  });

  renderStream(bundle);

  const list = screen.getByTestId('workbench-message-list');
  assert.equal(list.getAttribute('data-visible-turn-count'), '8');
  assert.equal(screen.queryByText('历史回合 1'), null);
  assert.ok(
    document.querySelector(
      '[data-testid="workbench-run"][data-run-id="run-restored-original-goal"]',
    ),
  );
  fireEvent.click(screen.getByTestId('workbench-locate-run-turn'));
  assert.equal(list.getAttribute('data-visible-turn-count'), '12');
  assert.ok(screen.getByText('历史回合 1'));
  assert.ok(screen.getByTestId('workbench-collapse-history'));
});

test('large tool and artifact payloads mount only after their disclosure is opened', () => {
  renderStream(longConversationBundle(1));

  assert.doesNotMatch(document.body.textContent ?? '', /隐藏工具详情 1/);
  assert.doesNotMatch(document.body.textContent ?? '', /隐藏正文 1/);

  const tool = screen.getByTestId('workbench-tool-event') as HTMLDetailsElement;
  tool.open = true;
  fireEvent(tool, new Event('toggle'));
  assert.match(document.body.textContent ?? '', /长文本已隐藏 · 4009 字符/);
  assert.ok(screen.getByTestId('workbench-context-receipt'));

  const artifact = screen.getByTestId('workbench-artifact-card');
  const artifactDetails = artifact.querySelector('details:last-of-type') as HTMLDetailsElement;
  artifactDetails.open = true;
  fireEvent(artifactDetails, new Event('toggle'));
  assert.match(document.body.textContent ?? '', /隐藏正文 1/);
});

test('pre-run automatic summary failure provides a dedicated retry action', () => {
  let retryCount = 0;
  const bundle = bundleWithContent('总结本章');
  bundle.turns[0] = { ...bundle.turns[0], turnId: 'summary-generation-auth-1', role: 'user' };

  render(
    <WorkbenchMessageStream
      bundle={bundle}
      compressionCandidate={null}
      compressionBusy={false}
      decisionBusyCardId=""
      assetRecovery={null}
      assetReadinessBusy={false}
      selectedConversationRunning={false}
      chapterSummaryOrchestration={{
        phase: 'failed',
        turnId: 'summary-generation-auth-1',
      }}
      onDismissCompression={() => undefined}
      onDecideArtifact={() => undefined}
      onRetry={() => undefined}
      onRetryChapterSummaryStart={() => {
        retryCount += 1;
      }}
      onGenerateMissingAsset={() => undefined}
      onEditMissingAsset={() => undefined}
      onRefreshAssetReadiness={() => undefined}
      onResumeChapterGoal={() => undefined}
      onDismissAssetReadiness={() => undefined}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: '重试章节总结' }));
  assert.equal(retryCount, 1);
});

test('failed run retry is visibly disabled while the task cannot execute', () => {
  let retryCount = 0;
  const bundle = bundleWithContent('审计这一章');
  bundle.conversation.status = 'failed';
  bundle.turns[0] = { ...bundle.turns[0], role: 'user' };
  bundle.runs = [
    {
      runId: 'run-failed',
      conversationId: bundle.conversation.conversationId,
      turnId: bundle.turns[0].turnId,
      workerId: 'worker-failed',
      status: 'failed',
      modelSnapshot: {
        providerId: 'mock',
        modelId: 'Mock',
        runtimeMode: 'mock',
        capabilities: ['conversation_turn'],
        options: {},
        capturedAt: '2026-08-29T01:00:00.000Z',
      },
      error: 'fixture failure',
      createdAt: '2026-08-29T01:00:00.000Z',
      updatedAt: '2026-08-29T01:00:01.000Z',
      finishedAt: '2026-08-29T01:00:01.000Z',
    },
  ];

  render(
    <WorkbenchMessageStream
      bundle={bundle}
      compressionCandidate={null}
      compressionBusy={false}
      decisionBusyCardId=""
      assetRecovery={null}
      assetReadinessBusy={false}
      selectedConversationRunning
      retryRunBlockedReason="当前任务仍在运行，结束或取消后才能重试。"
      chapterSummaryOrchestration={{ phase: 'none' }}
      onDismissCompression={() => undefined}
      onDecideArtifact={() => undefined}
      onRetry={() => {
        retryCount += 1;
      }}
      onGenerateMissingAsset={() => undefined}
      onEditMissingAsset={() => undefined}
      onRefreshAssetReadiness={() => undefined}
      onResumeChapterGoal={() => undefined}
      onDismissAssetReadiness={() => undefined}
    />,
  );

  const retry = screen.getByTestId('workbench-retry-turn') as HTMLButtonElement;
  assert.equal(retry.disabled, true);
  assert.equal(retry.title, '当前任务仍在运行，结束或取消后才能重试。');
  fireEvent.click(retry);
  assert.equal(retryCount, 0);
});

test('retry disable reasons consistently cover archived and pending task states', () => {
  const bundle = bundleWithContent('审计这一章');
  bundle.turns[0] = { ...bundle.turns[0], role: 'user' };
  bundle.runs = [
    {
      runId: 'run-failed-reasons',
      conversationId: bundle.conversation.conversationId,
      turnId: bundle.turns[0].turnId,
      workerId: 'worker-failed-reasons',
      status: 'failed',
      modelSnapshot: {
        providerId: 'mock',
        modelId: 'Mock',
        runtimeMode: 'mock',
        capabilities: ['conversation_turn'],
        options: {},
        capturedAt: '2026-08-29T01:00:00.000Z',
      },
      createdAt: '2026-08-29T01:00:00.000Z',
      updatedAt: '2026-08-29T01:00:01.000Z',
    },
  ];

  for (const reason of ['已归档任务不能重试。', '当前任务正在准备执行，请稍候。']) {
    const view = render(
      <WorkbenchMessageStream
        bundle={bundle}
        compressionCandidate={null}
        compressionBusy={false}
        decisionBusyCardId=""
        assetRecovery={null}
        assetReadinessBusy={false}
        selectedConversationRunning={false}
        retryRunBlockedReason={reason}
        chapterSummaryOrchestration={{ phase: 'none' }}
        onDismissCompression={() => undefined}
        onDecideArtifact={() => undefined}
        onRetry={() => undefined}
        onGenerateMissingAsset={() => undefined}
        onEditMissingAsset={() => undefined}
        onRefreshAssetReadiness={() => undefined}
        onResumeChapterGoal={() => undefined}
        onDismissAssetReadiness={() => undefined}
      />,
    );
    const retry = screen.getByTestId('workbench-retry-turn') as HTMLButtonElement;
    assert.equal(retry.disabled, true);
    assert.equal(retry.title, reason);
    view.unmount();
  }
});

test('history pages count complete user rounds rather than cutting off assistant replies', () => {
  const bundle = longConversationBundle();
  bundle.turns = bundle.turns.flatMap((turn, index) => [
    { ...turn, sequence: index * 2 + 1 },
    {
      ...turn,
      turnId: 'assistant-' + turn.turnId,
      role: 'assistant' as const,
      runId: bundle.runs[index].runId,
      sequence: index * 2 + 2,
      content: '回应 ' + (index + 1),
      createdAt: new Date(Date.parse(turn.createdAt) + 30_000).toISOString(),
    },
  ]);
  renderStream(bundle);
  const list = screen.getByTestId('workbench-message-list');
  assert.equal(list.dataset.totalRoundCount, '24');
  assert.equal(list.dataset.visibleRoundCount, '8');
  assert.equal(list.dataset.visibleTurnCount, '16');
  assert.equal(screen.queryByText('历史回合 16'), null);
  assert.equal(screen.queryByText('回应 16'), null);
  assert.ok(screen.getByText('历史回合 17'));
  assert.ok(screen.getByText('回应 17'));
  fireEvent.click(screen.getByTestId('workbench-load-earlier'));
  assert.equal(list.dataset.visibleTurnCount, '32');
});

test('an old pending candidate stays reachable without expanding history or stealing focus on arrival', () => {
  const bundle = longConversationBundle();
  bundle.artifacts[0] = { ...bundle.artifacts[0], status: 'candidate' };
  renderStream(bundle);
  assert.equal(document.querySelector('[data-card-id="card-history-1"]'), null);
  const pending = screen.getByTestId('workbench-locate-pending');
  assert.equal(pending.textContent, '查看待处理候选（1）');
  fireEvent.click(pending);
  const card = document.querySelector(
    '[data-testid="workbench-artifact-card"][data-card-id="card-history-1"]',
  );
  assert.ok(card);
  const anchor = card.closest<HTMLElement>('[data-presentation-id]');
  assert.equal(anchor?.dataset.located, 'true');
  assert.equal(document.activeElement, anchor);
  assert.equal(screen.getByTestId('workbench-message-list').dataset.visibleRoundCount, '24');
});

test('external candidate requests expand history, keep exact ownership and do not replay focus after refresh', () => {
  const bundle = longConversationBundle();
  let decisions = 0;
  const view = render(
    streamElement(bundle, {
      onDecideArtifact: () => {
        decisions += 1;
      },
    }),
  );
  const request = {
    conversationId: bundle.conversation.conversationId,
    cardId: 'card-history-2',
    requestId: 'focus-1',
  };
  view.rerender(streamElement(bundle, { artifactFocusRequest: request }));
  const anchor = document.querySelector<HTMLElement>(
    '[data-presentation-id="artifact:card-history-2"]',
  );
  assert.ok(anchor);
  assert.equal(anchor.dataset.runId, 'run-history-2');
  assert.equal(anchor.dataset.turnId, 'turn-history-2');
  assert.equal(document.activeElement, anchor);
  const focus = document.createElement('textarea');
  document.body.append(focus);
  focus.focus();
  const reordered = {
    ...bundle,
    turns: [...bundle.turns].reverse(),
    runs: [...bundle.runs].reverse(),
    toolEvents: [...bundle.toolEvents].reverse(),
    artifacts: [...bundle.artifacts].reverse(),
  };
  view.rerender(streamElement(reordered, { artifactFocusRequest: request }));
  assert.equal(document.querySelector('[data-presentation-id="artifact:card-history-2"]'), anchor);
  assert.equal(document.activeElement, focus);
  assert.equal(decisions, 0);
  focus.remove();
});

test('preparation action shows in-place generation state then an exact link to this candidate, not a newer same-type card', () => {
  const bundle = longConversationBundle();
  let generated = 0;
  const recovery: NonNullable<ComponentProps<typeof WorkbenchMessageStream>['assetRecovery']> = {
    conversationId: bundle.conversation.conversationId,
    novelId: bundle.conversation.novelId,
    originalGoal: '保留的正文要求',
    sourceTurnId: 'turn-history-1',
    missingAssets: ['chapter_outline'],
    createdAt: '2026-08-29T01:23:10.000Z',
    checkedAt: '2026-08-29T01:23:10.000Z',
    orchestration: {
      phase: 'generating',
      asset: 'chapter_outline',
      preparationTurnId: 'turn-history-1',
      preparationRunId: 'run-history-1',
      updatedAt: '2026-08-29T01:23:10.000Z',
    },
  };
  const view = render(
    streamElement(bundle, {
      assetRecovery: recovery,
      onGenerateMissingAsset: () => {
        generated += 1;
      },
    }),
  );
  const generate = screen.getByTestId(
    'workbench-generate-asset-chapter_outline',
  ) as HTMLButtonElement;
  assert.equal(generate.disabled, true);
  assert.match(generate.textContent ?? '', /正在生成候选/);
  const awaiting = {
    ...recovery,
    orchestration: {
      ...recovery.orchestration,
      phase: 'awaiting_apply' as const,
      candidateArtifactId: 'artifact-history-1',
    },
  };
  view.rerender(
    streamElement(bundle, { assetRecovery: awaiting, selectedConversationRunning: true }),
  );
  const locate = screen.getByTestId('workbench-view-preparation-candidate') as HTMLButtonElement;
  assert.equal(locate.textContent?.trim(), '查看本次候选');
  assert.equal(locate.disabled, false);
  assert.equal(locate.dataset.candidateCardId, 'card-history-1');
  fireEvent.click(locate);
  assert.equal(
    document.activeElement?.getAttribute('data-presentation-id'),
    'artifact:card-history-1',
  );
  assert.equal(generated, 0);
  assert.doesNotMatch(document.body.textContent ?? '', /请在上方/);
});

function userOnlyBundle(count = 24, conversationId = 'reading-a'): TaskConversationBundle {
  const bundle = longConversationBundle(count);
  bundle.conversation = { ...bundle.conversation, conversationId };
  bundle.turns = bundle.turns.map((turn) => ({ ...turn, conversationId }));
  bundle.runs = [];
  bundle.toolEvents = [];
  bundle.artifacts = [];
  return bundle;
}

/** Deterministic layout seam only; no browser/server or real model is started by these tests. */
function installReadingGeometry() {
  const prototype = window.HTMLElement.prototype;
  const original = {
    rect: Object.getOwnPropertyDescriptor(prototype, 'getBoundingClientRect'),
    scrollHeight: Object.getOwnPropertyDescriptor(prototype, 'scrollHeight'),
    clientHeight: Object.getOwnPropertyDescriptor(prototype, 'clientHeight'),
    scrollTo: Object.getOwnPropertyDescriptor(prototype, 'scrollTo'),
    resize: Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver'),
  };
  const sizes = new Map<string, number>();
  const calls: Array<{ node: HTMLElement; options: ScrollToOptions }> = [];
  const observers = new Set<LayoutObserver>();
  class LayoutObserver implements ResizeObserver {
    constructor(readonly callback: ResizeObserverCallback) {
      observers.add(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {
      observers.delete(this);
    }
  }
  const entries = (node: HTMLElement) => [
    ...node.querySelectorAll<HTMLElement>('[data-presentation-id]'),
  ];
  const height = (node: HTMLElement) => sizes.get(node.dataset.presentationId ?? '') ?? 100;
  Object.defineProperties(prototype, {
    scrollHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return entries(this).reduce((total, node) => total + height(node), 0);
      },
    },
    clientHeight: {
      configurable: true,
      get() {
        return 240;
      },
    },
    scrollTo: {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) {
        calls.push({ node: this, options });
        this.scrollTop = Math.max(
          0,
          Math.min(options.top ?? this.scrollTop, this.scrollHeight - this.clientHeight),
        );
      },
    },
    getBoundingClientRect: {
      configurable: true,
      value(this: HTMLElement) {
        let top = 100;
        let size = 240;
        if (this.dataset.presentationId) {
          const list = this.closest<HTMLElement>('[data-testid="workbench-message-list"]');
          const siblings = list ? entries(list) : [];
          top +=
            siblings
              .slice(0, siblings.indexOf(this))
              .reduce((total, node) => total + height(node), 0) - (list?.scrollTop ?? 0);
          size = height(this);
        }
        return {
          top,
          bottom: top + size,
          left: 0,
          right: 800,
          width: 800,
          height: size,
          x: 0,
          y: top,
          toJSON: () => ({}),
        };
      },
    },
  });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: LayoutObserver,
  });
  return {
    sizes,
    calls,
    resize: () => act(() => observers.forEach((observer) => observer.callback([], observer))),
    restore: () => {
      for (const [name, descriptor] of Object.entries(original)) {
        if (name === 'resize') {
          if (descriptor) Object.defineProperty(globalThis, 'ResizeObserver', descriptor);
          else Reflect.deleteProperty(globalThis, 'ResizeObserver');
        } else {
          const property = name === 'rect' ? 'getBoundingClientRect' : name;
          if (descriptor) Object.defineProperty(prototype, property, descriptor);
          else Reflect.deleteProperty(prototype, property);
        }
      }
    },
  };
}

test('first visit follows latest; task switches and real unmounts restore the reading anchor and loaded window', () => {
  const layout = installReadingGeometry();
  try {
    const bundleA = userOnlyBundle();
    const view = renderStream(bundleA);
    act(() => flushAnimationFrames());
    let list = screen.getByTestId('workbench-message-list');
    assert.equal(list.scrollTop, list.scrollHeight - list.clientHeight);
    list.scrollTop = 250;
    fireEvent.scroll(list);
    const anchor = document.querySelector<HTMLElement>(
      '[data-presentation-id="turn:turn-history-19"]',
    )!;
    const offset = anchor.getBoundingClientRect().top - list.getBoundingClientRect().top;
    fireEvent.click(screen.getByTestId('workbench-load-earlier'));
    assert.equal(list.dataset.visibleRoundCount, '16');
    assert.equal(anchor.getBoundingClientRect().top - list.getBoundingClientRect().top, offset);

    view.rerender(streamElement(userOnlyBundle(10, 'reading-b')));
    act(() => flushAnimationFrames());
    list = screen.getByTestId('workbench-message-list');
    assert.equal(list.scrollTop, list.scrollHeight - list.clientHeight);
    view.rerender(streamElement(userOnlyBundle(25)));
    list = screen.getByTestId('workbench-message-list');
    const restored = document.querySelector<HTMLElement>(
      '[data-presentation-id="turn:turn-history-19"]',
    )!;
    assert.equal(list.dataset.visibleRoundCount, '17');
    assert.equal(restored.getBoundingClientRect().top - list.getBoundingClientRect().top, offset);
    assert.ok(screen.getByRole('button', { name: '查看最新进展' }));

    view.unmount();
    renderStream(userOnlyBundle(25));
    list = screen.getByTestId('workbench-message-list');
    assert.equal(list.dataset.visibleRoundCount, '17');
    assert.equal(
      document
        .querySelector<HTMLElement>('[data-presentation-id="turn:turn-history-19"]')!
        .getBoundingClientRect().top - list.getBoundingClientRect().top,
      offset,
    );
  } finally {
    cleanup();
    layout.restore();
  }
});

test('late cards and candidate-body hydration preserve historical reading and the active input', () => {
  const layout = installReadingGeometry();
  try {
    const bundle = userOnlyBundle();
    const view = renderStream(bundle);
    act(() => flushAnimationFrames());
    const list = screen.getByTestId('workbench-message-list');
    list.scrollTop = 250;
    fireEvent.scroll(list);
    const anchor = document.querySelector<HTMLElement>(
      '[data-presentation-id="turn:turn-history-19"]',
    )!;
    const offset = anchor.getBoundingClientRect().top - list.getBoundingClientRect().top;
    const composer = document.createElement('textarea');
    document.body.append(composer);
    composer.value = '尚未发送的草稿';
    composer.focus();
    fireEvent.compositionStart(composer);
    const next: TaskConversationBundle = {
      ...bundle,
      artifacts: [
        {
          cardId: 'late-reading-card',
          conversationId: bundle.conversation.conversationId,
          artifactId: 'late-reading-artifact',
          artifactType: 'chapter_text',
          title: '迟到候选',
          summary: '只读候选',
          status: 'candidate',
          createdAt: '2026-08-29T01:17:30.000Z',
        },
      ],
    };
    layout.calls.length = 0;
    view.rerender(streamElement(next));
    assert.equal(anchor.getBoundingClientRect().top - list.getBoundingClientRect().top, offset);
    layout.sizes.set('artifact:late-reading-card', 600);
    view.rerender(
      streamElement({
        ...next,
        artifacts: [{ ...next.artifacts[0], content: '水合正文'.repeat(500) }],
      }),
    );
    layout.resize();
    act(() => flushAnimationFrames());
    assert.equal(anchor.getBoundingClientRect().top - list.getBoundingClientRect().top, offset);
    assert.equal(document.activeElement, composer);
    assert.equal(composer.value, '尚未发送的草稿');
    assert.equal(layout.calls.length, 0);
    fireEvent.compositionEnd(composer);
    composer.remove();
  } finally {
    cleanup();
    layout.restore();
  }
});

test('a missing exact preparation candidate disables navigation instead of substituting another card', () => {
  const bundle = longConversationBundle(1);
  const recovery: NonNullable<ComponentProps<typeof WorkbenchMessageStream>['assetRecovery']> = {
    conversationId: bundle.conversation.conversationId,
    novelId: bundle.conversation.novelId,
    originalGoal: '保留要求',
    missingAssets: ['protagonist'],
    createdAt: '2026-08-29T01:00:10.000Z',
    checkedAt: '2026-08-29T01:00:10.000Z',
    orchestration: {
      phase: 'awaiting_apply',
      asset: 'protagonist',
      candidateArtifactId: 'not-loaded',
      preparationRunId: 'run-history-1',
      preparationTurnId: 'turn-history-1',
      updatedAt: '2026-08-29T01:00:10.000Z',
    },
  };
  render(streamElement(bundle, { assetRecovery: recovery }));
  const locate = screen.getByTestId('workbench-view-preparation-candidate') as HTMLButtonElement;
  assert.equal(locate.disabled, true);
  assert.equal(locate.dataset.candidateCardId, undefined);
  assert.match(locate.textContent ?? '', /正在恢复本次候选/);
  assert.ok(screen.getByTestId('workbench-refresh-asset-readiness'));
});

test('foreign candidate focus requests do not expand or focus the current task', () => {
  const bundle = longConversationBundle();
  render(
    streamElement(bundle, {
      artifactFocusRequest: {
        conversationId: 'another-task',
        cardId: 'card-history-1',
        requestId: 'foreign-focus',
      },
    }),
  );
  assert.equal(screen.getByTestId('workbench-message-list').dataset.visibleRoundCount, '8');
  assert.equal(document.querySelector('[data-presentation-id="artifact:card-history-1"]'), null);
});

test('returning to a task restores opened candidate prose without replaying arrival highlights', () => {
  const bundle = longConversationBundle(1);
  const view = renderStream(bundle);
  const artifact = screen.getByTestId('workbench-artifact-card');
  const details = artifact.querySelector('details:last-of-type') as HTMLDetailsElement;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  assert.match(document.body.textContent ?? '', /隐藏正文 1/);
  view.rerender(streamElement(userOnlyBundle(1, 'another-task')));
  view.rerender(streamElement(bundle));
  const restored = screen.getByTestId('workbench-artifact-card');
  assert.equal((restored.querySelector('details:last-of-type') as HTMLDetailsElement).open, true);
  assert.match(document.body.textContent ?? '', /隐藏正文 1/);
  assert.equal(restored.dataset.newlyArrived, undefined);
});

test('explicit latest navigation keeps follow mode during smooth intermediate scroll events', () => {
  const view = renderStream(bundleWithContent('第一段'));
  const list = screen.getByTestId('workbench-message-list');
  Object.defineProperties(list, {
    scrollHeight: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 240 },
    scrollTop: { configurable: true, writable: true, value: 0 },
    scrollTo: { configurable: true, value: () => undefined },
  });
  act(() => flushAnimationFrames());
  fireEvent.scroll(list);
  fireEvent.click(screen.getByRole('button', { name: '查看最新进展' }));
  list.scrollTop = 200;
  fireEvent.scroll(list);
  assert.equal(list.dataset.followLatest, 'true');
  assert.equal(screen.queryByRole('button', { name: '查看最新进展' }), null);
  list.scrollTop = 660;
  fireEvent.scroll(list);
  view.rerender(streamElement(bundleWithContent('第一段和新增进展')));
  assert.equal(list.dataset.followLatest, 'true');
  fireEvent.wheel(list, { deltaY: -120 });
  list.scrollTop = 300;
  fireEvent.scroll(list);
  assert.equal(list.dataset.followLatest, 'false');
  assert.ok(screen.getByRole('button', { name: '查看最新进展' }));
});

function groupedReadBundle(): TaskConversationBundle {
  const bundle = bundleWithContent('读取上下文');
  bundle.conversation.conversationId = 'conversation-read-group';
  bundle.conversation.title = '读取分组';
  bundle.conversation.status = 'completed';
  bundle.turns[0] = {
    ...bundle.turns[0],
    turnId: 'turn-read-group',
    conversationId: bundle.conversation.conversationId,
    role: 'user',
  };
  bundle.runs = [
    {
      runId: 'run-read-group',
      conversationId: bundle.conversation.conversationId,
      turnId: 'turn-read-group',
      workerId: 'worker-read-group',
      status: 'completed',
      modelSnapshot: {
        providerId: 'mock',
        modelId: 'Mock',
        runtimeMode: 'mock',
        capabilities: [],
        options: {},
        capturedAt: '2026-08-29T01:00:00.000Z',
      },
      createdAt: '2026-08-29T01:00:00.000Z',
      updatedAt: '2026-08-29T01:02:00.000Z',
      finishedAt: '2026-08-29T01:02:00.000Z',
    },
  ];
  bundle.toolEvents = [
    {
      eventId: 'read-group-a',
      runId: 'run-read-group',
      sequence: 1,
      toolName: 'novel.read_context',
      argumentsSummary: {},
      status: 'succeeded',
      durationMs: 210,
      createdAt: '2026-08-29T01:00:01.000Z',
      finishedAt: '2026-08-29T01:00:02.000Z',
    },
    {
      eventId: 'read-group-b',
      runId: 'run-read-group',
      sequence: 2,
      toolName: 'structure.read',
      argumentsSummary: {},
      status: 'succeeded',
      durationMs: 320,
      createdAt: '2026-08-29T01:00:03.000Z',
      finishedAt: '2026-08-29T01:00:04.000Z',
    },
    {
      eventId: 'read-group-fail',
      runId: 'run-read-group',
      sequence: 3,
      toolName: 'memory.search',
      argumentsSummary: {},
      status: 'failed',
      error: '检索失败不得折叠',
      createdAt: '2026-08-29T01:00:05.000Z',
      finishedAt: '2026-08-29T01:00:06.000Z',
    },
  ];
  return bundle;
}

function LocateGroupHarness({
  bundle,
  locateId,
}: {
  bundle: TaskConversationBundle;
  locateId?: string;
}) {
  const events = projectWorkbenchEvents(bundle);
  const { scrollRef, locateEvent, locatedId } = useWorkbenchPresentationScroll({
    events,
    novelId: bundle.conversation.novelId,
    conversationId: bundle.conversation.conversationId,
  });
  return (
    <section ref={scrollRef} data-testid="locate-group-harness">
      {groupWorkbenchDisplaySegments(events).map((segment) => {
        if (segment.kind === 'event') {
          return (
            <div
              key={segment.event.id}
              data-presentation-id={segment.event.id}
              data-testid={
                segment.event.kind === 'error' ? 'workbench-tool-public-error' : undefined
              }
            >
              {segment.event.kind === 'error' ? segment.event.error : segment.event.id}
            </div>
          );
        }
        const ids = segment.events.map((entry) => entry.id);
        const key = completedReadDisclosureKey(ids);
        return (
          <div key={ids[0]} data-presentation-id={ids[0]} data-testid="workbench-completed-read">
            <details data-disclosure-key={key}>
              <summary>已读取创作材料</summary>
              {segment.events.slice(1).map((entry) => (
                <div key={entry.id} data-presentation-id={entry.id} />
              ))}
            </details>
          </div>
        );
      })}
      {locateId && (
        <button type="button" onClick={() => locateEvent(locateId)}>
          locate-inner
        </button>
      )}
      <span data-testid="located-id">{locatedId}</span>
    </section>
  );
}

test('empty-task examples only insert text and never send or decide', () => {
  const bundle = bundleWithContent('占位');
  bundle.turns = [];
  bundle.runs = [];
  bundle.toolEvents = [];
  bundle.artifacts = [];
  bundle.conversation.status = 'idle';
  const inserted: string[] = [];
  let decisions = 0;
  let retries = 0;
  render(
    streamElement(bundle, {
      onInsertExample: (text) => {
        inserted.push(text);
      },
      onDecideArtifact: () => {
        decisions += 1;
      },
      onRetry: () => {
        retries += 1;
      },
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: '生成下一章，延续当前悬念' }));
  assert.deepEqual(inserted, ['生成下一章，延续当前悬念']);
  assert.equal(decisions, 0);
  assert.equal(retries, 0);
});

test('completed-read group expands, restores after task roundtrip, and keeps failures visible', () => {
  let decisions = 0;
  const bundle = groupedReadBundle();
  const view = render(
    streamElement(bundle, {
      onDecideArtifact: () => {
        decisions += 1;
      },
    }),
  );
  const group = screen.getByTestId('workbench-completed-read');
  const details = group.querySelector('details') as HTMLDetailsElement;
  assert.equal(details.open, false);
  assert.equal(details.dataset.disclosureKey, 'completed-read:tool:read-group-a,tool:read-group-b');
  assert.ok(document.querySelector('[data-presentation-id="tool:read-group-b"]'));
  assert.match(document.body.textContent ?? '', /检索失败不得折叠/);
  assert.equal(
    screen
      .getByTestId('workbench-tool-public-error')
      .closest('[data-testid="workbench-completed-read"]'),
    null,
  );
  details.open = true;
  fireEvent(details, new Event('toggle'));
  const inner = document.querySelector<HTMLElement>('[data-presentation-id="tool:read-group-b"]')!;
  expandWorkbenchAncestorDetails(inner);
  assert.equal(details.open, true);

  const reordered: TaskConversationBundle = {
    ...bundle,
    turns: [...bundle.turns].reverse(),
    runs: [...bundle.runs].reverse(),
    toolEvents: [...bundle.toolEvents].reverse(),
  };
  view.rerender(
    streamElement(reordered, {
      onDecideArtifact: () => {
        decisions += 1;
      },
    }),
  );
  assert.equal(
    screen
      .getByTestId('workbench-completed-read')
      .querySelector('details')
      ?.getAttribute('data-disclosure-key'),
    'completed-read:tool:read-group-a,tool:read-group-b',
  );
  assert.match(document.body.textContent ?? '', /检索失败不得折叠/);
  assert.equal(decisions, 0);

  view.rerender(streamElement(userOnlyBundle(1, 'another-task')));
  view.rerender(
    streamElement(bundle, {
      onDecideArtifact: () => {
        decisions += 1;
      },
    }),
  );
  const restored = screen
    .getByTestId('workbench-completed-read')
    .querySelector('details') as HTMLDetailsElement;
  assert.equal(restored.open, true);
  assert.equal(decisions, 0);
});

test('locating a grouped read member expands the ancestor disclosure first', () => {
  const bundle = groupedReadBundle();
  render(<LocateGroupHarness bundle={bundle} locateId="tool:read-group-b" />);
  const details = document.querySelector(
    '[data-testid="workbench-completed-read"] details',
  ) as HTMLDetailsElement;
  assert.equal(details.open, false);
  fireEvent.click(screen.getByRole('button', { name: 'locate-inner' }));
  assert.equal(details.open, true);
  assert.equal(screen.getByTestId('located-id').textContent, 'tool:read-group-b');
  assert.match(document.body.textContent ?? '', /检索失败不得折叠/);
});
