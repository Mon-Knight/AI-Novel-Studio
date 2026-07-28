import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PanelToolState } from '../../store/rightSidebarStore';
import { createInitialSidebarState, useRightSidebarStore } from '../../store/rightSidebarStore';
import { getCurrentWritingContext } from '../../utils/writingContext';
import RightPanel from './RightPanel';

const panelProbe = vi.hoisted(() => ({
  outlineRenders: 0,
  checkRenders: 0,
}));

vi.mock('./panels/OutlinePanel', () => ({
  default: ({
    onUpdateToolState,
  }: {
    onUpdateToolState?: (patch: Partial<PanelToolState>) => void;
  }) => {
    panelProbe.outlineRenders += 1;
    return (
      <button
        type="button"
        onClick={() => onUpdateToolState?.({ output: 'outline-ready', loading: false })}
      >
        outline-probe
      </button>
    );
  },
}));

vi.mock('./panels/CheckPanel', () => ({
  default: () => {
    panelProbe.checkRenders += 1;
    return <div>check-probe</div>;
  },
}));

describe('RightPanel render isolation', () => {
  beforeEach(() => {
    panelProbe.outlineRenders = 0;
    panelProbe.checkRenders = 0;
    useRightSidebarStore.getState().reset();
  });

  it('forwards tool-state ownership and keeps an unrelated panel stable during editor changes', async () => {
    const initialContext = getCurrentWritingContext({
      novelId: 'novel-1',
      fullText: 'initial editor text',
    });
    const changedContext = getCurrentWritingContext({
      novelId: 'novel-1',
      fullText: 'changed editor text',
      isDirty: true,
    });
    const sidebarState = {
      ...createInitialSidebarState(),
      activeTool: 'outline' as const,
      collapsed: false,
      toolStates: {
        outline: {
          output: 'owned output',
          error: '',
          loading: false,
          relatedContentHash: initialContext.contentHash,
        },
      },
    };
    const updateToolState = vi.fn((toolKey: string, patch: Partial<PanelToolState>) => {
      useRightSidebarStore.getState().updateTool(toolKey, patch);
    });
    const close = vi.fn();
    const view = render(
      <RightPanel
        panelType="outline"
        onClose={close}
        novelId="novel-1"
        currentEditorContent={initialContext.fullText}
        currentEditorWordCount={initialContext.wordCount}
        currentEditorDirty={initialContext.isDirty}
        currentContentHash={initialContext.contentHash}
        writingContext={initialContext}
        sidebarState={sidebarState}
        onUpdateToolState={updateToolState}
      />,
    );

    const probe = await screen.findByRole('button', { name: 'outline-probe' });
    expect(panelProbe.outlineRenders).toBe(1);
    expect(view.container.querySelector('.panel-stale-warning')).toBeNull();

    fireEvent.click(probe);
    expect(updateToolState).toHaveBeenCalledWith('outline', {
      output: 'outline-ready',
      loading: false,
    });
    expect(useRightSidebarStore.getState().toolStates.outline).toEqual(
      expect.objectContaining({ output: 'outline-ready', loading: false }),
    );

    view.rerender(
      <RightPanel
        panelType="outline"
        onClose={close}
        novelId="novel-1"
        currentEditorContent={changedContext.fullText}
        currentEditorWordCount={changedContext.wordCount}
        currentEditorDirty={changedContext.isDirty}
        currentContentHash={changedContext.contentHash}
        writingContext={changedContext}
        sidebarState={sidebarState}
        onUpdateToolState={updateToolState}
      />,
    );

    await waitFor(() =>
      expect(view.container.querySelector('.panel-stale-warning')).not.toBeNull(),
    );
    expect(panelProbe.outlineRenders).toBe(1);
  });

  it('still rerenders an editor-sensitive panel when its content snapshot changes', async () => {
    const close = vi.fn();
    const view = render(
      <RightPanel
        panelType="check"
        onClose={close}
        currentEditorContent="first"
        currentContentHash="hash-first"
      />,
    );
    await screen.findByText('check-probe');
    expect(panelProbe.checkRenders).toBe(1);

    view.rerender(
      <RightPanel
        panelType="check"
        onClose={close}
        currentEditorContent="second"
        currentContentHash="hash-second"
      />,
    );
    await waitFor(() => expect(panelProbe.checkRenders).toBe(2));
  });
});
