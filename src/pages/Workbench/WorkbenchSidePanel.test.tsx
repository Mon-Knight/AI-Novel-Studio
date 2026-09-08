import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { TaskConversationBundle } from '../../types/conversation';
import { useWorkbenchSidePanel } from './hooks/useWorkbenchSidePanel';
import { WorkbenchSidePanel } from './WorkbenchSidePanel';
import { WorkbenchArtifactIndex, WorkbenchRunLog } from './WorkbenchSidePanelViews';

const model = {
  providerId: 'mock',
  modelId: 'Mock',
  runtimeMode: 'mock' as const,
  capabilities: [],
  options: {},
  capturedAt: '2026-09-01T00:00:00.000Z',
};

const bundle: TaskConversationBundle = {
  conversation: {
    conversationId: 'conv-1',
    novelId: 'novel-1',
    title: '任务',
    status: 'waiting_user',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:02:00.000Z',
  } as TaskConversationBundle['conversation'],
  turns: [],
  runs: [
    {
      runId: 'run-1',
      conversationId: 'conv-1',
      turnId: 'turn-1',
      status: 'completed',
      modelSnapshot: model,
      workerId: 'worker-1',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:05.000Z',
      startedAt: '2026-09-01T00:00:00.000Z',
      finishedAt: '2026-09-01T00:00:02.500Z',
    },
    {
      runId: 'run-2',
      conversationId: 'conv-1',
      turnId: 'turn-2',
      status: 'failed',
      modelSnapshot: model,
      workerId: 'worker-1',
      error: '模型超时',
      createdAt: '2026-09-01T00:01:00.000Z',
      updatedAt: '2026-09-01T00:01:05.000Z',
    },
  ],
  toolEvents: [
    {
      eventId: 'event-2',
      runId: 'run-1',
      sequence: 2,
      toolName: 'generate_chapter',
      argumentsSummary: {},
      status: 'succeeded',
      durationMs: 1800,
      createdAt: '2026-09-01T00:00:01.000Z',
    },
    {
      eventId: 'event-1',
      runId: 'run-1',
      sequence: 1,
      toolName: 'novel.read',
      argumentsSummary: {},
      status: 'succeeded',
      durationMs: 120,
      createdAt: '2026-09-01T00:00:00.500Z',
    },
  ],
  artifacts: [
    {
      cardId: 'card-1',
      conversationId: 'conv-1',
      artifactId: 'artifact-1',
      artifactType: 'chapter_text',
      title: '第一章候选',
      summary: '正文候选',
      status: 'candidate',
      createdAt: '2026-09-01T00:00:02.000Z',
    },
    {
      cardId: 'card-0',
      conversationId: 'conv-1',
      artifactType: 'outline',
      title: '大纲草案',
      summary: '大纲',
      status: 'confirmed',
      createdAt: '2026-09-01T00:00:01.000Z',
    },
  ],
};

describe('workbench side panel', () => {
  it('lists artifacts newest first and reveals the card in the conversation', () => {
    const reveal = vi.fn(() => true);
    render(<WorkbenchArtifactIndex bundle={bundle} onReveal={reveal} />);
    const rows = screen.getAllByTestId('workbench-side-artifact');
    expect(rows.map((row) => row.getAttribute('data-card-id'))).toEqual(['card-1', 'card-0']);
    expect(rows[0].textContent).toContain('章节正文');
    expect(rows[0].textContent).toContain('待处理');
    fireEvent.click(rows[0]);
    expect(reveal).toHaveBeenCalledWith('card-1', 'artifact-1');
  });

  it('orders tool events by sequence inside each run and surfaces run errors', () => {
    render(<WorkbenchRunLog bundle={bundle} />);
    const runs = document.querySelectorAll('.workbench-side-run');
    expect(Array.from(runs).map((run) => run.getAttribute('data-run-id'))).toEqual([
      'run-2',
      'run-1',
    ]);
    const eventNames = Array.from(runs[1].querySelectorAll('.workbench-side-event-name')).map(
      (node) => node.textContent,
    );
    expect(eventNames).toEqual(['novel.read', 'generate_chapter']);
    expect(runs[1].textContent).toContain('2.5 s');
    expect(runs[0].textContent).toContain('模型超时');
  });

  it('opens launcher tabs in place and returns to the launcher', () => {
    const plugins = { value: false };
    const { result } = renderHook(() =>
      useWorkbenchSidePanel(plugins.value, (value) => {
        plugins.value = value;
      }),
    );
    expect(result.current.view).toBeNull();
    act(() => result.current.toggle());
    expect(result.current.view).toBe('launcher');
    act(() => result.current.open('artifacts'));
    expect(result.current.view).toBe('artifacts');
    act(() => result.current.back());
    expect(result.current.view).toBe('launcher');
    act(() => result.current.open('plugins'));
    expect(plugins.value).toBe(true);
    act(() => result.current.close());
    expect(plugins.value).toBe(false);
    expect(result.current.view).toBeNull();
  });

  it('renders the launcher cards with live counts and the view header with back/close', () => {
    const onOpen = vi.fn();
    const onBack = vi.fn();
    const props = {
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      bundle,
      plugins: [],
      pluginsLoading: false,
      pluginsError: '',
      assetScope: null,
      assetScopeLoading: false,
      assetScopeError: '',
      onRefreshAssetScope: vi.fn(),
      onOpenAssetScopePath: vi.fn(),
      onOpen,
      onBack,
      onClose: vi.fn(),
    };
    const view = render(
      <MemoryRouter>
        <WorkbenchSidePanel view="launcher" {...props} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('workbench-side-open-artifacts').textContent).toContain('2 张产物卡');
    expect(screen.getByTestId('workbench-side-open-events').textContent).toContain('2 次运行');
    fireEvent.click(screen.getByTestId('workbench-side-open-context'));
    expect(onOpen).toHaveBeenCalledWith('context');

    view.rerender(
      <MemoryRouter>
        <WorkbenchSidePanel view="events" {...props} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: '运行日志' })).not.toBeNull();
    expect(screen.getByTestId('workbench-side-events')).not.toBeNull();
    fireEvent.click(screen.getByTestId('workbench-side-back'));
    expect(onBack).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByTestId('workbench-side-close'));
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it('reserves the third grid column for every open view, not only launcher/plugins', () => {
    const css = readFileSync(resolve('src/styles/workbench-zcode.css'), 'utf8');
    // Regression: context/artifacts/events used to fall through to the two-column grid and
    // wrap under the task tree because only launcher/plugins selected the three-column template.
    expect(css).toMatch(
      /\.workbench-page\[data-side-panel\]:not\(\[data-side-panel='closed'\]\)\s*\{[^}]*grid-template-columns:\s*var\(--sidebar-width\)\s+minmax\(0,\s*1fr\)\s+var\(--side-panel-width\)/u,
    );
    expect(css).not.toMatch(/\.workbench-page\[data-side-panel='launcher'\]/u);
    // An explicit grid-row on the panel would make auto-placement seat it in column 1
    // (pushing the tree and transcript right); the panel must stay a plain third item.
    expect(css).not.toMatch(/\.workbench-side-panel\s*\{[^}]*grid-(?:row|column)/u);
    expect(css).toMatch(
      /@media \(max-width: 1180px\)[\s\S]*?\.workbench-page\[data-side-panel\]:not\(\[data-side-panel='closed'\]\) > \.workbench-side-panel\s*\{[^}]*position:\s*absolute/u,
    );
  });
});
