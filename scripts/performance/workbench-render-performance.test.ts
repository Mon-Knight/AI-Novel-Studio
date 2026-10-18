import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { createElement, Fragment, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TaskConversationBundle, TaskModelSnapshot } from '../../src/types/conversation';
import {
  groupWorkbenchDisplaySegments,
  groupWorkbenchRounds,
  presentationWindowStart,
  projectWorkbenchEvents,
  WORKBENCH_HISTORY_PAGE_SIZE,
} from '../../src/features/workbench/workbenchPresentation';
import { WorkbenchTurn } from '../../src/pages/Workbench/WorkbenchTurn';

// CPU/SSR regression budgets, not browser frame-rate or real desktop latency claims.
// Browser layout, painting and input latency are measured in desktop/browser scenarios.
const BUDGETS = { projectionP95Ms: 150, visibleMessageSsrP95Ms: 100 };
const epoch = Date.UTC(2026, 8, 10);
const at = (milliseconds: number) => new Date(epoch + milliseconds).toISOString();
const model: TaskModelSnapshot = {
  providerId: 'mock',
  modelId: 'Mock',
  runtimeMode: 'mock',
  capabilities: [],
  options: {},
  capturedAt: at(0),
};

function history(roundCount: number): TaskConversationBundle {
  const bundle: TaskConversationBundle = {
    conversation: {
      conversationId: 'performance-task',
      novelId: 'performance-novel',
      title: '性能夹具',
      status: 'waiting_user',
      createdAt: at(0),
      updatedAt: at(roundCount * 2000),
    },
    turns: [],
    runs: [],
    toolEvents: [],
    artifacts: [],
  };
  for (let index = 0; index < roundCount; index++) {
    const runId = `run-${index}`;
    const turnId = `user-${index}`;
    const start = index * 2000;
    bundle.turns.push(
      {
        turnId,
        conversationId: 'performance-task',
        role: 'user',
        sequence: index * 2 + 1,
        content: `第${index + 1}轮创作要求`,
        createdAt: at(start),
      },
      {
        turnId: `assistant-${index}`,
        conversationId: 'performance-task',
        role: 'assistant',
        sequence: index * 2 + 2,
        runId,
        content: '候选已保留，请检查来源和正文后决定。'.repeat(150),
        createdAt: at(start + 700),
      },
    );
    bundle.runs.push({
      runId,
      turnId,
      conversationId: 'performance-task',
      chapterId: `chapter-${index}`,
      status: 'completed',
      modelSnapshot: model,
      workerId: 'fixture-worker',
      createdAt: at(start + 1),
      updatedAt: at(start + 800),
      finishedAt: at(start + 800),
    });
    for (let tool = 0; tool < 10; tool++) {
      bundle.toolEvents.push({
        eventId: `tool-${index}-${tool}`,
        runId,
        sequence: tool + 1,
        toolName: tool === 9 ? 'generate_chapter' : 'novel.read_context',
        argumentsSummary: {},
        status: 'succeeded',
        result: { ok: true },
        createdAt: at(start + 10 + tool * 40),
        finishedAt: at(start + 20 + tool * 40),
      });
    }
    bundle.artifacts.push({
      cardId: `card-${index}`,
      conversationId: 'performance-task',
      turnId,
      runId,
      artifactId: `artifact-${index}`,
      artifactType: 'chapter_text',
      title: `候选${index + 1}`,
      summary: '待作者审阅',
      status: 'candidate',
      createdAt: at(start + 600),
    });
  }
  return bundle;
}

function p95(samples: number[]): number {
  const ordered = [...samples].sort((left, right) => left - right);
  return ordered[Math.ceil(ordered.length * 0.95) - 1];
}

const turnProps: Omit<ComponentProps<typeof WorkbenchTurn>, 'entry'> = {
  eventsByRunId: new Map(),
  newlyArrivedArtifacts: new Set(),
  decisionBusyCardId: '',
  chapterSummaryOrchestration: { phase: 'none' },
  retryRunBlockedReason: '',
  onDecideArtifact: () => undefined,
  onRetry: () => undefined,
  onLocateTurn: () => undefined,
};

test('production projection and grouping handle 100 rounds and 1000 tools within the CPU budget', (context) => {
  const bundle = history(100);
  projectWorkbenchEvents(bundle);
  const durations: number[] = [];
  for (let iteration = 0; iteration < 10; iteration++) {
    const start = performance.now();
    const events = projectWorkbenchEvents(bundle);
    const rounds = groupWorkbenchRounds(events);
    const first = presentationWindowStart(rounds, null, WORKBENCH_HISTORY_PAGE_SIZE);
    const visible = rounds.slice(first);
    const segments = visible.flatMap((round) => groupWorkbenchDisplaySegments(round.events));
    durations.push(performance.now() - start);
    assert.equal(rounds.length, 100);
    assert.equal(events.filter((event) => event.kind === 'tool').length, 1000);
    assert.equal(visible.length, 8);
    assert.equal(visible[0].id, 'turn:user-92');
    assert.equal(segments.filter((segment) => segment.kind === 'completed-read').length, 8);
    assert.ok(visible.every((round) => round.events.some((event) => event.kind === 'artifact')));
  }
  const measured = p95(durations);
  context.diagnostic(`Production projection/grouping p95: ${measured.toFixed(2)} ms (not FPS)`);
  assert.ok(
    measured < BUDGETS.projectionP95Ms,
    `projection p95 ${measured.toFixed(2)} ms exceeded ${BUDGETS.projectionP95Ms} ms`,
  );
});

test('the visible message window renders actual WorkbenchTurn components within an SSR CPU budget', (context) => {
  const rounds = groupWorkbenchRounds(projectWorkbenchEvents(history(100)));
  const visible = rounds.slice(presentationWindowStart(rounds, null, WORKBENCH_HISTORY_PAGE_SIZE));
  const messages = visible.flatMap((round) =>
    round.events.filter((event) => event.kind === 'turn'),
  );
  const render = () =>
    renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        ...messages.map((entry) =>
          createElement(WorkbenchTurn, { ...turnProps, entry, key: entry.id }),
        ),
      ),
    );
  render();
  const samples: number[] = [];
  for (let iteration = 0; iteration < 10; iteration++) {
    const start = performance.now();
    const html = render();
    samples.push(performance.now() - start);
    assert.equal((html.match(/data-testid="workbench-turn"/gu) ?? []).length, 16);
    assert.ok(html.includes('data-turn-id="user-92"'));
    assert.ok(html.includes('data-turn-id="assistant-99"'));
    assert.ok(!html.includes('data-turn-id="user-0"'));
  }
  const measured = p95(samples);
  context.diagnostic(
    `WorkbenchTurn visible-window SSR p95: ${measured.toFixed(2)} ms (not browser layout/paint)`,
  );
  assert.ok(
    measured < BUDGETS.visibleMessageSsrP95Ms,
    `SSR p95 ${measured.toFixed(2)} ms exceeded ${BUDGETS.visibleMessageSsrP95Ms} ms`,
  );
});

test('production read compaction preserves warnings and failed tool facts at long-history scale', () => {
  const bundle = history(100);
  bundle.toolEvents[0] = { ...bundle.toolEvents[0], result: { warning: '上下文未命中' } };
  bundle.toolEvents[1] = { ...bundle.toolEvents[1], status: 'failed', error: '固定故障夹具' };
  const events = projectWorkbenchEvents(bundle);
  const segments = groupWorkbenchDisplaySegments(events);
  const standalone = segments.flatMap((segment) =>
    segment.kind === 'event' ? [segment.event] : [],
  );
  assert.ok(standalone.some((event) => event.id === 'tool:tool-0-0'));
  assert.ok(standalone.some((event) => event.id === 'tool:tool-0-1'));
  assert.ok(standalone.some((event) => event.id === 'tool-error:tool-0-1'));
  assert.equal(events.filter((event) => event.kind === 'tool').length, 1000);
});
