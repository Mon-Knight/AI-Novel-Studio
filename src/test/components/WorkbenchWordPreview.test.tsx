import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../services/conversation/taskConversationService', () => ({
  taskConversationService: { get: mocks.get },
}));
import { useWorkbenchWordPreview } from '../../features/workbench/useWorkbenchWordPreview';
import { saveChapterWordRangePercents } from '../../services/conversation/chapterWordRangePolicy';

const context = {
  novelId: 'n',
  conversationId: 'task',
  chapterId: 'c',
  chapterTarget: 3400,
  historyRevision: 9,
};
beforeEach(() => {
  saveChapterWordRangePercents({ hardMinimumPercent: 90, hardMaximumPercent: 110 });
  mocks.get.mockResolvedValue({
    conversation: { novelId: 'n' },
    turns: [
      {
        turnId: 'old-outside-visible-window',
        role: 'user',
        sequence: 1,
        content: '本任务目标字数设为3200字',
      },
    ],
  });
});
it('uses persisted task settings and explicit overrides in the same precedence as writing', async () => {
  const { result, rerender } = renderHook(({ goal }) => useWorkbenchWordPreview(context, goal), {
    initialProps: { goal: '生成下一章' },
  });
  await waitFor(() => expect(result.current).toContain('3200 字（任务设置）'));
  expect(result.current).toContain('2880～3520');
  rerender({ goal: '生成下一章，目标3500字' });
  expect(result.current).toContain('3500 字（本次要求）');
  expect(result.current).toContain('3150～3850');
});
it('uses chapter target only when no task override exists and reports invalid directives', async () => {
  mocks.get.mockResolvedValue({ conversation: { novelId: 'n' }, turns: [] });
  const { result, rerender } = renderHook(({ goal }) => useWorkbenchWordPreview(context, goal), {
    initialProps: { goal: '生成下一章' },
  });
  await waitFor(() => expect(result.current).toContain('3400 字（所选章节）'));
  expect(result.current).toContain('3060～3740');
  rerender({ goal: '生成下一章，目标3000字，目标4000字' });
  expect(result.current).toContain('不要同时给出多个目标');
});
it('does not display a chapter fallback as authoritative while task settings cannot be read', async () => {
  mocks.get.mockRejectedValue(new Error('read failed'));
  const { result } = renderHook(() => useWorkbenchWordPreview(context, '生成下一章'));
  await waitFor(() => expect(result.current).toContain('暂未读到'));
  expect(result.current).not.toContain('3400');
});
