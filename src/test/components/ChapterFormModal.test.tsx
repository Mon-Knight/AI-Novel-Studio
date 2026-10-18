import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import ChapterFormModal from '../../components/outline/ChapterFormModal';
import type { Chapter } from '../../types/chapter';

const chapter: Chapter = {
  id: 'c',
  novelId: 'n',
  title: '旧标题',
  outline: '采用章纲',
  goal: '旧目标',
  status: 'adopted',
  targetWordCount: 3400,
  wordCount: 3200,
  currentWords: 3200,
  targetWords: 3400,
  chapterNumber: 1,
  orderIndex: 0,
  sortOrder: 0,
  drafts: [],
  createdAt: 'created',
  updatedAt: 'before',
};

it('sends only an edited goal and waits for persistence instead of reporting early success', async () => {
  let reject!: (cause: Error) => void;
  const onSave = vi.fn(
    () =>
      new Promise<void>((_resolve, failed) => {
        reject = failed;
      }),
  );
  const onClose = vi.fn();
  render(
    <MemoryRouter>
      <ChapterFormModal
        initial={chapter}
        novelId="n"
        volumes={[]}
        onSave={onSave}
        onClose={onClose}
      />
    </MemoryRouter>,
  );
  expect(screen.queryByRole('textbox', { name: '章节大纲' })).toBeNull();
  expect(screen.getByRole('link', { name: '核对并编辑采用章纲' }).getAttribute('href')).toBe(
    '/novels/n/outline?type=chapter&chapterId=c',
  );
  fireEvent.change(screen.getByRole('textbox', { name: '本章目标' }), {
    target: { value: '新目标' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(onSave).toHaveBeenCalledWith({ goal: '新目标' }, chapter);
  expect((screen.getByRole('button', { name: '保存中…' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(screen.getByRole('textbox', { name: '本章目标' }).closest('fieldset')?.disabled).toBe(
    true,
  );
  await act(async () => reject(new Error('保存连接中断')));
  expect((await screen.findByRole('alert')).textContent).toContain('保存连接中断');
  expect((screen.getByRole('textbox', { name: '本章目标' }) as HTMLInputElement).value).toBe(
    '新目标',
  );
  expect(onClose).not.toHaveBeenCalled();
});

it('retains local edits after CAS failure, refreshes untouched fields, and requires explicit review', async () => {
  const latest = {
    ...chapter,
    title: '他处新标题',
    outline: '他处新采用章纲',
    goal: '他处目标',
    updatedAt: 'new',
  };
  const onSave = vi
    .fn()
    .mockRejectedValueOnce(new Error('CHAPTER_DETAILS_CONFLICT: 已变化'))
    .mockResolvedValue(undefined);
  const onRefresh = vi.fn().mockResolvedValue(latest);
  render(
    <MemoryRouter>
      <ChapterFormModal
        initial={chapter}
        novelId="n"
        volumes={[]}
        onSave={onSave}
        onClose={vi.fn()}
        onRefresh={onRefresh}
      />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByRole('textbox', { name: '本章目标' }), {
    target: { value: '保留我的目标' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByRole('alert');
  expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '刷新正式版本（保留输入）' }));
  await screen.findByText('他处新采用章纲');
  expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '已核对，使用最新基线（保留输入）' }));
  expect((screen.getByRole('textbox', { name: '本章目标' }) as HTMLInputElement).value).toBe(
    '保留我的目标',
  );
  expect((screen.getByRole('textbox', { name: '章节标题' }) as HTMLInputElement).value).toBe(
    '他处新标题',
  );
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
  expect(onSave.mock.calls[1]).toEqual([{ goal: '保留我的目标' }, latest]);
});

it('does not allow a deleted or foreign chapter to become the new baseline', async () => {
  const onSave = vi.fn().mockRejectedValue(new Error('CHAPTER_DETAILS_CONFLICT: 已变化'));
  render(
    <MemoryRouter>
      <ChapterFormModal
        initial={chapter}
        novelId="n"
        volumes={[]}
        onSave={onSave}
        onClose={vi.fn()}
        onRefresh={async () => ({ ...chapter, novelId: 'other' })}
      />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByRole('textbox', { name: '本章目标' }), {
    target: { value: '保留输入' },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '刷新正式版本（保留输入）' }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toContain('章节已删除或不属于当前作品'),
  );
  expect((screen.getByRole('textbox', { name: '本章目标' }) as HTMLInputElement).value).toBe(
    '保留输入',
  );
  expect(screen.queryByRole('button', { name: /已核对/ })).toBeNull();
});

it('keeps the initial outline input available when creating a chapter', () => {
  render(
    <MemoryRouter>
      <ChapterFormModal
        initial={null}
        novelId="n"
        volumes={[]}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole('textbox', { name: '章节大纲' })).toBeTruthy();
});
