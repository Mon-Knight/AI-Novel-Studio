import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ChapterStage } from '../../features/workbench/chapterStageProjection';
import { WorkbenchChapterStageTree } from './WorkbenchChapterStageTree';

function completed(input: Omit<ChapterStage, 'status'>): ChapterStage {
  return { ...input, status: 'completed', persistence: input.persistence ?? 'sqlite' };
}

describe('WorkbenchChapterStageTree', () => {
  it('renders the read-only chapter pipeline and keeps future Beats explicitly unplanned', () => {
    render(
      <WorkbenchChapterStageTree
        chapterTitle="第十二章 · 城门"
        stages={[
          completed({
            stageId: 'materials',
            kind: 'chapter_materials',
            title: '资料就绪',
            anchor: { kind: 'tool', id: 'tool-read' },
          }),
          completed({ stageId: 'plan', kind: 'scene_plan', title: 'Scene 规划' }),
          completed({
            stageId: 'scene-1',
            kind: 'scene',
            sceneId: 'scene-1',
            sceneNo: 1,
            title: '城门盘查',
            anchor: { kind: 'run', id: 'run-1' },
          }),
          completed({
            stageId: 'scene-1-plan',
            kind: 'beat_plan',
            sceneId: 'scene-1',
            sceneNo: 1,
          }),
          completed({
            stageId: 'scene-1-beat-1',
            kind: 'beat_prose',
            sceneId: 'scene-1',
            sceneNo: 1,
            beatId: 'beat-1',
            beatOrder: 1,
            anchor: { kind: 'artifact', id: 'artifact-beat-1' },
          }),
          completed({
            stageId: 'scene-1-state',
            kind: 'scene_state',
            sceneId: 'scene-1',
            sceneNo: 1,
          }),
          completed({
            stageId: 'scene-1-complete',
            kind: 'scene_complete',
            sceneId: 'scene-1',
            sceneNo: 1,
          }),
          {
            stageId: 'candidate',
            kind: 'chapter_candidate',
            status: 'pending',
            anchor: { kind: 'artifact', id: 'artifact-candidate' },
          },
        ]}
        futureScenes={[{ sceneId: 'scene-2', sceneNo: 2, title: '客栈接头' }]}
      />,
    );

    expect(screen.getByRole('region', { name: '章节写作进度' })).not.toBeNull();
    expect(screen.getByText('章节资料准备')).not.toBeNull();
    expect(screen.getByText('Scene 规划')).not.toBeNull();
    expect(screen.getByText('完整章节候选')).not.toBeNull();
    expect(screen.getByText('Scene 1 · 城门盘查')).not.toBeNull();

    const sceneToggle = screen.getByTestId('workbench-chapter-stage-scene-toggle-scene-1');
    expect(sceneToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(sceneToggle);
    expect(sceneToggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Beat 1')).not.toBeNull();
    expect(screen.getByTestId('workbench-chapter-stage-plan-scene-1')).not.toBeNull();
    expect(screen.getByTestId('workbench-chapter-stage-state-scene-1')).not.toBeNull();
    expect(screen.getByTestId('workbench-chapter-stage-complete-scene-1')).not.toBeNull();

    const futureToggle = screen.getByTestId('workbench-chapter-stage-scene-toggle-scene-2');
    fireEvent.click(futureToggle);
    expect(
      within(screen.getByTestId('workbench-chapter-stage-scene-scene-2')).getByText(
        '执行到场景时规划',
      ),
    ).not.toBeNull();
    expect(screen.getByText(/只读进度：定位到已有运行/)).not.toBeNull();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('expands only running or abnormal branches by default and supports keyboard collapse and locate', () => {
    const onLocate = vi.fn();
    render(
      <WorkbenchChapterStageTree
        onLocate={onLocate}
        stages={[
          completed({
            stageId: 'completed-scene-complete',
            kind: 'scene_complete',
            sceneId: 'completed-scene',
            sceneNo: 1,
          }),
          {
            stageId: 'running-scene',
            kind: 'scene',
            sceneId: 'running-scene',
            sceneNo: 2,
            title: '运行场景',
            status: 'running',
            persistence: 'sqlite',
            anchor: { kind: 'run', id: 'run-scene' },
          },
          {
            stageId: 'running-plan',
            kind: 'beat_plan',
            sceneId: 'running-scene',
            sceneNo: 2,
            status: 'running',
            persistence: 'sqlite',
            anchor: { kind: 'tool', id: 'tool-running' },
          },
          {
            stageId: 'failed-state',
            kind: 'scene_state',
            sceneId: 'failed-scene',
            sceneNo: 3,
            status: 'failed',
            persistence: 'sqlite',
            anchor: { kind: 'run', id: 'run-failed' },
          },
          {
            stageId: 'cancelled-state',
            kind: 'scene_state',
            sceneId: 'cancelled-scene',
            sceneNo: 4,
            status: 'cancelled',
            persistence: 'sqlite',
          },
          {
            stageId: 'candidate',
            kind: 'chapter_candidate',
            status: 'pending',
            anchor: { kind: 'artifact', id: 'artifact-candidate' },
          },
        ]}
        futureScenes={[{ sceneId: 'future-scene', sceneNo: 5, title: '尚未到达' }]}
      />,
    );

    expect(screen.queryByTestId('workbench-chapter-stage-scene-panel-completed-scene')).toBeNull();
    expect(screen.getByTestId('workbench-chapter-stage-scene-panel-running-scene')).not.toBeNull();
    expect(screen.getByTestId('workbench-chapter-stage-scene-panel-failed-scene')).not.toBeNull();
    expect(screen.queryByTestId('workbench-chapter-stage-scene-panel-cancelled-scene')).toBeNull();
    expect(screen.queryByTestId('workbench-chapter-stage-scene-panel-future-scene')).toBeNull();

    const completedToggle = screen.getByTestId(
      'workbench-chapter-stage-scene-toggle-completed-scene',
    );
    fireEvent.click(completedToggle);
    expect(completedToggle.getAttribute('aria-expanded')).toBe('true');
    const completedPanel = screen.getByTestId(
      'workbench-chapter-stage-scene-panel-completed-scene',
    );
    expect(completedToggle.getAttribute('aria-controls')).toBe(completedPanel.id);
    fireEvent.keyDown(completedToggle, { key: 'Enter' });
    expect(completedToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('workbench-chapter-stage-scene-panel-completed-scene')).toBeNull();

    const locateButton = screen.getByTestId('workbench-chapter-stage-locate-running-plan');
    expect(locateButton.getAttribute('aria-label')).toContain('定位');
    fireEvent.keyDown(locateButton, { key: ' ' });
    expect(onLocate).toHaveBeenCalledWith({ kind: 'tool', id: 'tool-running' });

    const sceneLocateButton = screen.getByTestId(
      'workbench-chapter-stage-scene-locate-running-scene',
    );
    fireEvent.keyDown(sceneLocateButton, { key: 'Enter' });
    expect(onLocate).toHaveBeenLastCalledWith({ kind: 'run', id: 'run-scene' });

    fireEvent.click(screen.getByTestId('workbench-chapter-stage-locate-candidate'));
    expect(onLocate).toHaveBeenLastCalledWith({ kind: 'artifact', id: 'artifact-candidate' });
  });

  it('surfaces failed, cancelled and interrupted states without confirmation or adoption actions', () => {
    render(
      <WorkbenchChapterStageTree
        stages={[
          {
            stageId: 'failed',
            kind: 'scene_state',
            sceneId: 'scene-failed',
            sceneNo: 1,
            status: 'failed',
            persistence: 'sqlite',
          },
          {
            stageId: 'cancelled',
            kind: 'scene_complete',
            sceneId: 'scene-cancelled',
            sceneNo: 2,
            status: 'cancelled',
            persistence: 'browser',
          },
          {
            stageId: 'interrupted',
            kind: 'scene_complete',
            sceneId: 'scene-interrupted',
            sceneNo: 3,
            status: 'interrupted',
            persistence: 'sqlite',
          },
        ]}
      />,
    );

    expect(
      within(screen.getByTestId('workbench-chapter-stage-scene-scene-failed')).getAllByText('失败')
        .length,
    ).toBeGreaterThan(0);
    expect(
      within(screen.getByTestId('workbench-chapter-stage-scene-scene-cancelled')).getAllByText(
        '已取消',
      ).length,
    ).toBeGreaterThan(0);
    expect(
      within(screen.getByTestId('workbench-chapter-stage-scene-scene-interrupted')).getAllByText(
        '已中断',
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /确认|采用/ })).toBeNull();
    expect(screen.getByTestId('workbench-chapter-stage-persistence').textContent).toBe(
      'SQLite / 浏览器记录',
    );
  });

  it('does not present a no-record completed row as complete and labels its persistence evidence', () => {
    const { unmount } = render(
      <WorkbenchChapterStageTree
        stages={[{ stageId: 'materials', kind: 'chapter_materials', status: 'completed' }]}
      />,
    );

    expect(
      within(screen.getByTestId('workbench-chapter-stage-row-materials')).getByText('暂无记录'),
    ).not.toBeNull();
    expect(screen.queryByText('已完成')).toBeNull();
    expect(screen.getByTestId('workbench-chapter-stage-persistence').textContent).toBe(
      '暂无持久记录',
    );
    unmount();

    render(
      <WorkbenchChapterStageTree
        stages={[
          {
            stageId: 'browser-plan',
            kind: 'scene_plan',
            status: 'completed',
            persistence: 'browser',
          },
        ]}
      />,
    );
    expect(screen.getByTestId('workbench-chapter-stage-persistence').textContent).toBe(
      '浏览器本机记录',
    );
    expect(screen.getByText('已完成')).not.toBeNull();
  });

  it('renders labels only, not accidental prose, reasoning payloads or a fake rate', () => {
    const privateStage = {
      stageId: 'private',
      kind: 'beat_prose',
      status: 'completed',
      persistence: 'sqlite',
      sceneId: 'scene-1',
      sceneNo: 1,
      beatId: 'beat-1',
      beatOrder: 1,
      title: 'Beat 1 正文',
      content: '不应渲染的完整正文',
      reasoning: '不应渲染的隐藏推理',
    } as ChapterStage & { content: string; reasoning: string };

    render(<WorkbenchChapterStageTree stages={[privateStage]} />);

    expect(screen.queryByText('不应渲染的完整正文')).toBeNull();
    expect(screen.queryByText('不应渲染的隐藏推理')).toBeNull();
    expect(screen.queryByText(/\d+%/)).toBeNull();
    expect(screen.getByText(/只读进度：定位到已有运行/)).not.toBeNull();
  });

  it('renders a bounded-read history notice and describes it, without presenting full history', () => {
    const notice =
      '已加载 200 条阶段记录，可能不是全部历史；更早或更多记录未显示，当前进度树不代表完整历史。';
    const { unmount } = render(<WorkbenchChapterStageTree stages={[]} historyNotice={notice} />);

    const historyNote = screen.getByTestId('workbench-chapter-stage-history-note');
    expect(historyNote.textContent).toBe(notice);
    const region = screen.getByRole('region', { name: '章节写作进度' });
    expect(region.getAttribute('aria-describedby')?.split(' ')).toContain(historyNote.id);
    expect(screen.queryByText(/\d+%/)).toBeNull();
    unmount();

    render(<WorkbenchChapterStageTree stages={[]} />);
    expect(screen.queryByTestId('workbench-chapter-stage-history-note')).toBeNull();
  });
});
