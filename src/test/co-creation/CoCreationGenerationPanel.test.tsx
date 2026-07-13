import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CoCreationGenerationPanel from '../../components/co-creation/CoCreationGenerationPanel';

const volumes = [{
  id: 'volume-a', novelId: 'novel-a', title: '第一卷', summary: '', goal: '',
  orderIndex: 1, volumeNumber: 1, sortOrder: 1, status: 'planned' as const,
  createdAt: 'now', updatedAt: 'now',
}];
const chapters = [{
  id: 'chapter-a', novelId: 'novel-a', volumeId: 'volume-a', title: '第一章',
  chapterNumber: 1, orderIndex: 1, sortOrder: 1, status: 'editing' as const,
  wordCount: 0, currentWords: 0, targetWordCount: 3600, targetWords: 3600,
  drafts: [], createdAt: 'now', updatedAt: 'now',
}];

describe('co-creation generation panel', () => {
  it('does not leak the current chapter scope into a master-outline request', () => {
    const onStart = vi.fn();
    render(
      <CoCreationGenerationPanel
        stage="outline"
        objectContext={{ novelId: 'novel-a', volumeId: 'volume-a', chapterId: 'chapter-a' }}
        volumes={volumes}
        chapters={chapters}
        records={[]}
        desktopRuntime
        onStart={onStart}
        onRetry={vi.fn()}
        onOpenTasks={vi.fn()}
        onOpenHandoff={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '提交后台任务' }));
    expect(onStart).toHaveBeenCalledWith({ kind: 'master_outline' });
  });

  it('keeps background outlines desktop-only but allows a safe workspace chapter handoff', () => {
    const onStart = vi.fn();
    render(
      <CoCreationGenerationPanel
        stage="outline"
        objectContext={{ novelId: 'novel-a', volumeId: 'volume-a', chapterId: 'chapter-a' }}
        volumes={volumes}
        chapters={chapters}
        records={[]}
        desktopRuntime={false}
        onStart={onStart}
        onRetry={vi.fn()}
        onOpenTasks={vi.fn()}
        onOpenHandoff={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '提交后台任务' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/仅在桌面应用中可用/)).not.toBeNull();

    fireEvent.change(screen.getByLabelText('生成类型'), {
      target: { value: 'chapter_generation_handoff' },
    });
    const submit = screen.getByRole('button', { name: '准备工作台交接' });
    expect(submit.hasAttribute('disabled')).toBe(false);
    fireEvent.click(submit);
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'chapter_generation_handoff',
      volumeId: 'volume-a',
      chapterId: 'chapter-a',
      targetWordCount: 3600,
    }));
    expect(screen.getByText(/不会自动生成或采用正文/)).not.toBeNull();
  });

  it('requires a fresh request instead of retrying a stale generation record', () => {
    const onRetry = vi.fn();
    render(
      <CoCreationGenerationPanel
        stage="outline"
        objectContext={{ novelId: 'novel-a' }}
        volumes={volumes}
        chapters={chapters}
        records={[{
          request: { requestId: 'request-stale' } as never,
          status: 'failed',
          errorCode: 'CO_CREATION_GENERATION_STALE',
          errorMessage: '正式作品数据已经变化',
          updatedAt: 'now',
        }]}
        desktopRuntime
        onStart={vi.fn()}
        onRetry={onRetry}
        onOpenTasks={vi.fn()}
        onOpenHandoff={vi.fn()}
      />,
    );

    expect(screen.getByText(/旧请求不可重试/)).not.toBeNull();
    expect(screen.queryByRole('button', { name: '重试同一请求' })).toBeNull();
    expect(onRetry).not.toHaveBeenCalled();
  });
});
