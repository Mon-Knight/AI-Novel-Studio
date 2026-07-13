import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NovelBasicInfoCard } from '../../components/novel-detail/NovelDetailCards';
import type { Novel } from '../../types/novel';

function novel(overrides: Partial<Novel> = {}): Novel {
  return {
    id: 'novel-1',
    title: '测试作品',
    description: '作品简介',
    outline: '',
    genre: '科幻',
    protagonistMode: 'single',
    protagonists: [],
    dualProtagonistRelation: {
      type: 'partner',
      description: '',
      conflict: '',
      cooperation: '',
      emotionalProgression: '',
      narrativeWeight: 'balanced',
    },
    status: 'writing',
    totalWordCount: 120,
    totalWords: 120,
    targetWordCount: 1000,
    targetWords: 1000,
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    volumes: [],
    ...overrides,
  };
}

describe('NovelBasicInfoCard save lifecycle', () => {
  it('uses a synchronous lock and disables all editing actions during save', async () => {
    let resolveSave: (() => void) | undefined;
    const onSave = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    render(<NovelBasicInfoCard novel={novel()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
    fireEvent.change(screen.getByLabelText('作品名称 *'), { target: { value: '连续保存测试' } });
    const save = screen.getByTestId('save-novel-basic-info');
    fireEvent.click(save);
    fireEvent.click(save);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText('作品名称 *') as HTMLInputElement).disabled).toBe(true);

    await act(async () => { resolveSave?.(); });
    expect(await screen.findByRole('button', { name: /编辑/ })).toBeTruthy();
  });

  it('keeps the editor open, restores controls and shows the actual save error', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('数据库繁忙，请稍后重试'));
    render(<NovelBasicInfoCard novel={novel()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
    fireEvent.click(screen.getByTestId('save-novel-basic-info'));

    expect((await screen.findByRole('alert')).textContent).toContain('数据库繁忙，请稍后重试');
    await waitFor(() => expect(
      (screen.getByTestId('save-novel-basic-info') as HTMLButtonElement).disabled,
    ).toBe(false));
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText('作品名称 *') as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: /编辑/ })).toBeNull();
  });

  it('releases the lock after success so consecutive edits can be saved', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const view = render(<NovelBasicInfoCard novel={novel()} onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
    fireEvent.change(screen.getByLabelText('作品名称 *'), { target: { value: '第一次保存' } });
    fireEvent.click(screen.getByTestId('save-novel-basic-info'));
    await screen.findByRole('button', { name: /编辑/ });

    view.rerender(<NovelBasicInfoCard novel={novel({ title: '第一次保存' })} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /编辑/ }));
    fireEvent.change(screen.getByLabelText('作品名称 *'), { target: { value: '第二次保存' } });
    fireEvent.click(screen.getByTestId('save-novel-basic-info'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[0][0].title).toBe('第一次保存');
    expect(onSave.mock.calls[1][0].title).toBe('第二次保存');
  });
});
