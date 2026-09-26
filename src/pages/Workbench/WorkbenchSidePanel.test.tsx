import { useState } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    const { result } = renderHook(() => {
      // The plugin flag is real component state; a plain object would keep the hook closed over
      // its initial value and never re-derive the view.
      const [showPlugins, setShowPlugins] = useState(false);
      return {
        showPlugins,
        state: useWorkbenchSidePanel(showPlugins, setShowPlugins),
      };
    });
    expect(result.current.state.view).toBeNull();
    act(() => result.current.state.toggle());
    expect(result.current.state.view).toBe('launcher');
    act(() => result.current.state.open('artifacts'));
    expect(result.current.state.view).toBe('artifacts');
    act(() => result.current.state.back());
    expect(result.current.state.view).toBe('launcher');
    act(() => result.current.state.open('plugins'));
    expect(result.current.showPlugins).toBe(true);
    act(() => result.current.state.close());
    expect(result.current.showPlugins).toBe(false);
    expect(result.current.state.view).toBeNull();
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

  it('only pins a wide reference column and overlays every other open panel', () => {
    const css = readFileSync(resolve('src/styles/workbench-zcode.css'), 'utf8');
    const shellCss = readFileSync(resolve('src/styles/app-shell.css'), 'utf8');
    expect(css).toMatch(
      /\.workbench-page\[data-panel-intent='pinned'\]\s*\{[^}]*grid-template-columns:\s*var\(--sidebar-width\)\s+minmax\(0,\s*1fr\)\s+var\(--side-panel-width\)/u,
    );
    expect(css).toMatch(
      /data-panel-intent='transient'[\s\S]*?position:\s*absolute[\s\S]*?top:\s*var\(--workbench-panel-top, 0px\)/u,
    );
    expect(css).not.toMatch(
      /--workbench-panel-top,\s*64px|--workbench-panel-top-narrow|top:\s*(?:64|88)px/u,
    );
    expect(shellCss).not.toMatch(/--workbench-panel-top|top:\s*(?:64|88)px/u);
    expect(css).not.toMatch(/\.workbench-page\[data-side-panel='launcher'\]/u);
    expect(css).not.toMatch(/\.workbench-side-panel\s*\{[^}]*grid-(?:row|column)/u);
  });
});
function PanelInteractionHarness({ scopeKey = 'task-a' }: { scopeKey?: string }) {
  const [plugins, setPlugins] = useState(false);
  const side = useWorkbenchSidePanel(plugins, setPlugins);
  return (
    <MemoryRouter>
      <button data-testid="workbench-toggle-side-panel" onClick={side.toggle}>
        打开参考
      </button>
      <button data-testid="workbench-current-plugins" onClick={side.openPlugins}>
        插件参考
      </button>
      <textarea aria-label="保留的任务目标" defaultValue="尚未发送的目标" />
      {side.view && (
        <WorkbenchSidePanel
          view={side.view}
          scopeKey={scopeKey}
          presentation={side.presentation}
          novelId="novel-1"
          bundle={bundle}
          plugins={[]}
          pluginsLoading={false}
          pluginsError=""
          assetScope={null}
          assetScopeLoading={false}
          assetScopeError=""
          onRefreshAssetScope={() => undefined}
          onOpenAssetScopePath={() => undefined}
          onOpen={side.open}
          onBack={side.back}
          onClose={side.close}
          onTogglePresentation={side.togglePresentation}
        />
      )}
    </MemoryRouter>
  );
}

describe('side panel dismissal and navigation', () => {
  const originalWidth = window.innerWidth;
  afterEach(() =>
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth }),
  );

  it('ignores IME Escape, then closes and restores the opener without changing the draft', () => {
    render(<PanelInteractionHarness />);
    const opener = screen.getByText('打开参考');
    opener.focus();
    fireEvent.click(opener);
    const panel = screen.getByTestId('workbench-side-panel');
    expect(document.activeElement).toBe(panel);
    fireEvent.keyDown(panel, { key: 'Escape', isComposing: true });
    expect(screen.queryByTestId('workbench-side-panel')).not.toBeNull();
    fireEvent.keyDown(panel, { key: 'Escape', keyCode: 229 });
    expect(screen.queryByTestId('workbench-side-panel')).not.toBeNull();
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByTestId('workbench-side-panel')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect((screen.getByLabelText('保留的任务目标') as HTMLTextAreaElement).value).toBe(
      '尚未发送的目标',
    );
  });

  it('dismisses a transient overlay on an outside pointer even in a wide window', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    render(<PanelInteractionHarness />);
    fireEvent.click(screen.getByText('打开参考'));
    expect(screen.getByTestId('workbench-side-panel').getAttribute('data-panel-intent')).toBe(
      'transient',
    );
    const input = screen.getByLabelText('保留的任务目标');
    fireEvent.pointerDown(input);
    input.focus();
    expect(screen.queryByTestId('workbench-side-panel')).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('keeps a pinned wide panel on an outside pointer', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    render(<PanelInteractionHarness />);
    fireEvent.click(screen.getByText('打开参考'));
    fireEvent.click(screen.getByTestId('workbench-side-pin'));
    expect(screen.getByTestId('workbench-side-panel').getAttribute('data-panel-intent')).toBe(
      'pinned',
    );
    const input = screen.getByLabelText('保留的任务目标');
    fireEvent.pointerDown(input);
    input.focus();
    expect(screen.queryByTestId('workbench-side-panel')).not.toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('dismisses a pinned overlay on an outside pointer when the window is narrow', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    render(<PanelInteractionHarness />);
    fireEvent.click(screen.getByText('打开参考'));
    fireEvent.click(screen.getByTestId('workbench-side-pin'));
    const input = screen.getByLabelText('保留的任务目标');
    fireEvent.pointerDown(input);
    input.focus();
    expect(screen.queryByTestId('workbench-side-panel')).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('toggles the same plugin view and offers a back action without a ghost launcher', () => {
    render(<PanelInteractionHarness />);
    const pluginTrigger = screen.getByTestId('workbench-current-plugins');
    fireEvent.click(pluginTrigger);
    expect(screen.getByTestId('workbench-side-panel').getAttribute('data-view')).toBe('plugins');
    fireEvent.click(screen.getByTestId('workbench-side-back'));
    expect(screen.getByTestId('workbench-side-panel').getAttribute('data-view')).toBe('launcher');
    fireEvent.click(pluginTrigger);
    fireEvent.click(pluginTrigger);
    expect(screen.queryByTestId('workbench-side-panel')).toBeNull();
  });

  it('closes the transient task view when its scope changes, not on a bundle refresh', () => {
    const view = render(<PanelInteractionHarness />);
    fireEvent.click(screen.getByText('打开参考'));
    view.rerender(<PanelInteractionHarness />);
    expect(screen.queryByTestId('workbench-side-panel')).not.toBeNull();
    view.rerender(<PanelInteractionHarness scopeKey="task-b" />);
    expect(screen.queryByTestId('workbench-side-panel')).toBeNull();
  });

  it('requests deferred artifact location when no history card is mounted', () => {
    const locate = vi.fn();
    render(
      <MemoryRouter>
        <WorkbenchSidePanel
          view="artifacts"
          novelId="novel-1"
          scopeKey="conv-1"
          bundle={bundle}
          plugins={[]}
          pluginsLoading={false}
          pluginsError=""
          assetScope={null}
          assetScopeLoading={false}
          assetScopeError=""
          onRefreshAssetScope={vi.fn()}
          onOpenAssetScopePath={vi.fn()}
          onOpen={vi.fn()}
          onBack={vi.fn()}
          onClose={vi.fn()}
          onLocateArtifact={locate}
        />
      </MemoryRouter>,
    );
    expect(document.querySelector('[data-testid="workbench-artifact-card"]')).toBeNull();
    fireEvent.click(screen.getAllByTestId('workbench-side-artifact')[0]);
    expect(locate).toHaveBeenCalledOnce();
    expect(locate).toHaveBeenCalledWith('card-1');
  });

  it('declares combined collapsed-tree/open-panel layouts and scoped hub hiding', () => {
    const shellCss = readFileSync(resolve('src/styles/app-shell.css'), 'utf8');
    expect(shellCss).toContain(".app-shell--workbench[data-sidebar='collapsed']");
    expect(shellCss).toContain('grid-template-columns: minmax(0, 1fr) var(--side-panel-width)');
    expect(shellCss).toContain(".app-shell--hub[data-sidebar='collapsed'] .hub-sidebar");
    expect(shellCss).toContain("data-panel-intent='pinned'");
  });

  it('hides an overlay with inert and does not steal composer focus or treat IME Escape as close', () => {
    function HiddenHarness() {
      const [plugins, setPlugins] = useState(false);
      const side = useWorkbenchSidePanel(plugins, setPlugins);
      const [hidden, setHidden] = useState(false);
      return (
        <MemoryRouter>
          <button data-testid="workbench-toggle-side-panel" onClick={side.toggle}>
            打开参考
          </button>
          <button
            type="button"
            data-testid="workbench-toggle-focus"
            onClick={() => setHidden((value) => !value)}
          >
            切换专注
          </button>
          <textarea aria-label="创作目标" defaultValue="尚未发送的目标" />
          {side.view && (
            <WorkbenchSidePanel
              view={side.view}
              scopeKey="task-a"
              presentation={side.presentation}
              temporarilyHidden={hidden}
              novelId="novel-1"
              bundle={bundle}
              plugins={[]}
              pluginsLoading={false}
              pluginsError=""
              assetScope={null}
              assetScopeLoading={false}
              assetScopeError=""
              onRefreshAssetScope={() => undefined}
              onOpenAssetScopePath={() => undefined}
              onOpen={side.open}
              onBack={side.back}
              onClose={side.close}
              onTogglePresentation={side.togglePresentation}
            />
          )}
        </MemoryRouter>
      );
    }
    render(<HiddenHarness />);
    fireEvent.click(screen.getByText('打开参考'));
    const panel = screen.getByTestId('workbench-side-panel');
    const input = screen.getByLabelText('创作目标') as HTMLTextAreaElement;
    fireEvent.click(screen.getByTestId('workbench-toggle-focus'));
    expect(panel.hidden).toBe(true);
    input.focus();
    expect(panel.hasAttribute('inert')).toBe(true);
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 });
    expect(screen.queryByTestId('workbench-side-panel')).not.toBeNull();
    expect(input.value).toBe('尚未发送的目标');
    fireEvent.click(screen.getByTestId('workbench-toggle-focus'));
    expect(screen.getByTestId('workbench-side-panel').hidden).toBe(false);
    expect(document.activeElement).toBe(input);
  });
});
