import assert from 'node:assert/strict';
import { after, test } from 'node:test';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import type { AiTaskRecord } from '../../types/ai';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/#/ai-tasks',
});

Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  localStorage: { value: dom.window.localStorage, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  Node: { value: dom.window.Node, configurable: true },
  MutationObserver: { value: dom.window.MutationObserver, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});

const { MemoryRouter } = await import('react-router-dom');
const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
const pageModule = (await vite.ssrLoadModule(
  '/src/pages/AiTasks/AiTasksPageView.tsx',
)) as typeof import('./AiTasksPageView');
const AiTasksPageView = pageModule.default;
const { cleanup, fireEvent, render } = await import('@testing-library/react');

const timestamp = '2026-07-28T00:00:00.000Z';

function task(overrides: Partial<AiTaskRecord> = {}): AiTaskRecord {
  return {
    id: 'task-1',
    taskType: 'chapter_generate',
    status: 'succeeded',
    createdAt: timestamp,
    finishedAt: timestamp,
    inputSummary: 'a'.repeat(80),
    modelName: 'model-a',
    tokenInput: 1200,
    tokenOutput: 800,
    costStatus: 'complete',
    costEstimate: 0.12,
    errorMessage: 'failed',
    resultText: 'result '.repeat(60),
    ...overrides,
  };
}

function renderView(tasks: AiTaskRecord[]) {
  const callbacks = {
    onTypeFilterChange: () => undefined,
    onStatusFilterChange: () => undefined,
    onToggleSelectMode: () => undefined,
    onToggleSelectAll: () => undefined,
    onDeleteSelected: () => undefined,
    onClearAll: () => undefined,
    onDeleteFiltered: () => undefined,
    onToggleSelect: () => undefined,
    onToggleExpand: () => undefined,
    onStopTask: () => undefined,
    onDeleteOne: () => undefined,
    onPreviousPage: () => undefined,
    onNextPage: () => undefined,
  };

  return render(
    <MemoryRouter initialEntries={['/ai-tasks']}>
      <AiTasksPageView
        tasks={tasks}
        total={tasks.length + 1}
        typeFilter="all"
        statusFilter="all"
        expandedId="task-1"
        msg=""
        selectedIds={new Set(['task-2'])}
        selectMode={false}
        deleting={false}
        visibleCost={0.12}
        totalPages={2}
        visiblePage={1}
        pagedTasks={tasks}
        executionStates={
          new Map([
            ['task-1', 'active'],
            ['task-2', 'cancelling'],
            ['task-3', 'inactive'],
            ['task-4', 'inactive'],
          ])
        }
        {...callbacks}
      />
    </MemoryRouter>,
  );
}

test('renders task statuses, expanded details, execution controls, and pagination', () => {
  const { container, rerender } = renderView([
    task(),
    task({ id: 'task-2', taskType: 'quality_check', status: 'pending', costStatus: 'unpriced' }),
    task({
      id: 'task-3',
      taskType: 'chapter_polish',
      status: 'failed',
      costStatus: 'usage_missing',
      errorMessage: 'failed',
    }),
    task({ id: 'task-4', taskType: 'chapter_rewrite', status: 'cancelled', costStatus: 'mock' }),
  ]);

  assert.equal(container.querySelectorAll('.detail-card').length, 4);
  assert.match(container.textContent ?? '', /model-a/);
  assert.match(container.textContent ?? '', /failed/);
  assert.match(container.textContent ?? '', /0\.12/);
  assert.equal(container.querySelectorAll('.list-pagination').length, 1);
  assert.equal(container.querySelectorAll('button[title="删除此记录"]').length, 3);

  const actionButtons = container.querySelectorAll('.detail-card button');
  assert.ok(actionButtons.length >= 3);
  fireEvent.click(actionButtons[0]);
  fireEvent.click(actionButtons[1]);
  fireEvent.click(container.querySelector('.list-pagination button:last-child')!);

  rerender(
    <MemoryRouter initialEntries={['/ai-tasks']}>
      <AiTasksPageView
        tasks={[]}
        total={0}
        typeFilter="all"
        statusFilter="all"
        expandedId={null}
        msg=""
        selectedIds={new Set()}
        selectMode={true}
        deleting={false}
        visibleCost={0}
        totalPages={1}
        visiblePage={1}
        pagedTasks={[]}
        executionStates={new Map()}
        onTypeFilterChange={() => undefined}
        onStatusFilterChange={() => undefined}
        onToggleSelectMode={() => undefined}
        onToggleSelectAll={() => undefined}
        onDeleteSelected={() => undefined}
        onClearAll={() => undefined}
        onDeleteFiltered={() => undefined}
        onToggleSelect={() => undefined}
        onToggleExpand={() => undefined}
        onStopTask={() => undefined}
        onDeleteOne={() => undefined}
        onPreviousPage={() => undefined}
        onNextPage={() => undefined}
      />
    </MemoryRouter>,
  );
  assert.match(container.textContent ?? '', /AI/);
  cleanup();
});

after(async () => {
  await vite.close();
  dom.window.close();
});
