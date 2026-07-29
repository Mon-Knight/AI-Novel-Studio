import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VolumeTree from '../../components/workspace/VolumeTree';
import AiTaskRecordCard from '../../pages/AiTasks/AiTaskRecordCard';
import { reconcileAiTaskRecords } from '../../pages/AiTasks/aiTaskRecordReconciliation';
import type { AiTaskRecord } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type { Volume } from '../../types/volume';

const stableCallback = vi.fn();
const stableAsyncCallback = vi.fn(async () => undefined);

function task(overrides: Partial<AiTaskRecord> = {}): AiTaskRecord {
  return {
    id: 'task-1',
    taskType: 'chapter_generate',
    status: 'succeeded',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('high-frequency render identity budgets', () => {
  it('preserves unchanged task objects while replacing changed persisted facts', () => {
    const previous = [task(), task({ id: 'task-2', status: 'running' })];
    const incoming = [task(), task({ id: 'task-2', status: 'succeeded' })];
    const reconciled = reconcileAiTaskRecords(previous, incoming);

    expect(reconciled[0]).toBe(previous[0]);
    expect(reconciled[1]).toBe(incoming[1]);
  });

  it('does not re-render an unchanged AI task card during a polling parent commit', () => {
    let statusReads = 0;
    const record = task();
    Object.defineProperty(record, 'status', {
      enumerable: true,
      get: () => {
        statusReads += 1;
        return 'succeeded';
      },
    });
    const props = {
      task: record,
      expanded: false,
      selected: false,
      selectMode: false,
      activeExecutionState: 'inactive' as const,
      onToggleSelect: stableCallback,
      onToggleExpand: stableCallback,
      onStop: stableCallback,
      onDelete: stableCallback,
    };
    const view = render(<AiTaskRecordCard {...props} />);
    const readsAfterInitialRender = statusReads;

    view.rerender(<AiTaskRecordCard {...props} />);
    expect(statusReads).toBe(readsAfterInitialRender);

    view.rerender(<AiTaskRecordCard {...props} expanded />);
    expect(statusReads).toBeGreaterThan(readsAfterInitialRender);
  });

  it('keeps the volume tree out of editor-only parent updates', () => {
    let titleReads = 0;
    const volume = {
      id: 'volume-1',
      novelId: 'novel-1',
      orderIndex: 1,
      volumeNumber: 1,
      sortOrder: 1,
      status: 'writing',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    } as Volume;
    Object.defineProperty(volume, 'title', {
      enumerable: true,
      get: () => {
        titleReads += 1;
        return '第一卷';
      },
    });
    const volumes = [volume];
    const chapters: Chapter[] = [];
    const props = {
      volumes,
      chapters,
      activeChapterId: '',
      onSelectChapter: stableCallback,
      onCreateVolume: stableAsyncCallback,
      onCreateChapter: stableAsyncCallback,
    };
    const view = render(<VolumeTree {...props} />);
    const readsAfterInitialRender = titleReads;

    view.rerender(<VolumeTree {...props} />);
    expect(titleReads).toBe(readsAfterInitialRender);

    view.rerender(<VolumeTree {...props} volumes={[volume]} />);
    expect(titleReads).toBeGreaterThan(readsAfterInitialRender);
  });
});
