import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import type { TaskConversationBundle } from '../../types/conversation';

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

function streamElement(bundle: TaskConversationBundle) {
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

test('latest activity expands history when its run belongs to an earlier creative turn', () => {
  const bundle = longConversationBundle(12);
  bundle.runs.push({
    ...bundle.runs[0],
    runId: 'run-restored-original-goal',
    status: 'completed',
    updatedAt: '2026-08-29T02:00:00.000Z',
    finishedAt: '2026-08-29T02:00:00.000Z',
  });

  renderStream(bundle);

  const list = screen.getByTestId('workbench-message-list');
  assert.equal(list.getAttribute('data-visible-turn-count'), '12');
  assert.ok(screen.getByText('历史回合 1'));
  assert.ok(
    document.querySelector(
      '[data-testid="workbench-run"][data-run-id="run-restored-original-goal"]',
    ),
  );
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
