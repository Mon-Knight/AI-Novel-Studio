import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Chapter } from '../../types/chapter';
import type { ChapterDraft } from '../../types/ai';

const mocks = vi.hoisted(() => ({
  chapter: vi.fn(),
  draft: vi.fn(),
  worlds: vi.fn(),
  rules: vi.fn(),
  preview: vi.fn(),
  save: vi.fn(),
  confirm: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('react-router-dom', async (original) => ({
  ...(await original<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock('../../utils/nativeDialog', () => ({ confirmDanger: mocks.confirm }));
vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: { getById: mocks.chapter },
}));
vi.mock('../../services/database/draftVersionService', () => ({
  draftVersionService: { getById: mocks.draft },
}));
vi.mock('../../services/database/settingRepository', () => ({
  settingRepository: {
    getWorldSettings: mocks.worlds,
    getRuleSystems: mocks.rules,
    previewWorldRuleChange: mocks.preview,
    saveWorldSetting: mocks.save,
    saveRuleSystem: mocks.save,
  },
}));
import { ChapterSourceReview } from '../../components/workspace/ChapterSourceReview';
import { useChapterSourceReview } from '../../features/workspace/useChapterSourceReview';
import {
  loadChapterSourceReview,
  previewChapterSourceCorrection,
  saveChapterSourceCorrection,
} from '../../services/worldRules/chapterSourceReview';

const chapter = { id: 'c', novelId: 'n', title: '第1章', adoptedDraftId: 'd' } as Chapter;
const content = '不得喷水，不揭裱，原件保持原状。';
const draft = {
  id: 'd',
  novelId: 'n',
  chapterId: 'c',
  versionNo: 1,
  content,
  isAdopted: true,
  contentState: {
    status: 'ready',
    content,
    contentHash: 'checked-in-service',
    contentLength: content.length,
  },
} as ChapterDraft;
const world = {
  id: 'w',
  novelId: 'n',
  title: '物证规则',
  content: '可以喷水醒纸。' + '完整设定。'.repeat(60),
  isActive: true,
  createdAt: 'before',
  updatedAt: 'before',
};
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.chapter.mockResolvedValue(chapter);
  mocks.draft.mockResolvedValue(draft);
  mocks.worlds.mockResolvedValue([world]);
  mocks.rules.mockResolvedValue([]);
  mocks.preview.mockResolvedValue({
    novelId: 'n',
    previewHash: 'preview',
    ruleSetFingerprint: 'rules',
    sources: [],
    affectedChapters: [],
    dependentRules: [],
    blockingConflicts: [],
    uncertainty: [],
    requiresConfirmation: true,
  });
  mocks.save.mockResolvedValue({ ...world, updatedAt: 'after', content });
  mocks.confirm.mockResolvedValue(false);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function editSource() {
  render(
    <MemoryRouter>
      <ChapterSourceReview chapter={chapter} draft={draft} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByTestId('chapter-source-review'));
  fireEvent.click(await screen.findByRole('button', { name: '核对并编辑' }));
  fireEvent.change(screen.getByTestId('setting-content'), { target: { value: content } });
}

async function previewAndConfirm() {
  fireEvent.click(screen.getByTestId('setting-impact-preview'));
  fireEvent.click(await screen.findByTestId('setting-author-confirm'));
}

it('shows full sources and requires preview plus author confirmation before saving', async () => {
  render(
    <MemoryRouter>
      <ChapterSourceReview chapter={chapter} draft={draft} original="可以喷水。" />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByTestId('chapter-source-review'));
  expect(await screen.findByText(world.content)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '核对并编辑' }));
  fireEvent.change(screen.getByTestId('setting-content'), { target: { value: content } });
  expect((screen.getByTestId('setting-save') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId('setting-impact-preview'));
  await screen.findByTestId('setting-author-confirm');
  expect(mocks.save).not.toHaveBeenCalled();
  expect((screen.getByTestId('setting-save') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByTestId('setting-author-confirm'));
  fireEvent.click(screen.getByTestId('setting-save'));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  const input = mocks.save.mock.calls[0][1];
  expect(input.expectedUpdatedAt).toBe('before');
  expect(input.changeAuthorization.notes).toMatch(/^ans-adopted-chapter-v1:c:d:[a-f\d]{64}$/u);
  expect(JSON.parse(input.structuredJson).provenance.origin).toBe('adopted_text');
});

it('rejects a changed adopted source and retains the edited input for review', async () => {
  render(
    <MemoryRouter>
      <ChapterSourceReview chapter={chapter} draft={draft} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByTestId('chapter-source-review'));
  fireEvent.click(await screen.findByRole('button', { name: '核对并编辑' }));
  fireEvent.change(screen.getByTestId('setting-content'), { target: { value: content } });
  fireEvent.click(screen.getByTestId('setting-impact-preview'));
  await screen.findByTestId('setting-author-confirm');
  fireEvent.click(screen.getByTestId('setting-author-confirm'));
  mocks.chapter.mockResolvedValue({ ...chapter, adoptedDraftId: 'new-draft' });
  fireEvent.click(screen.getByTestId('setting-save'));
  await waitFor(() =>
    expect(screen.getByTestId('setting-editor-message').textContent).toContain(
      'CHAPTER_SOURCE_CHANGED',
    ),
  );
  expect((screen.getByTestId('setting-content') as HTMLTextAreaElement).value).toBe(content);
  expect(mocks.save).not.toHaveBeenCalled();
});

it('recovers from an external CAS conflict without losing input or bypassing a fresh review', async () => {
  let official = { ...world };
  mocks.worlds.mockImplementation(async () => [official]);
  mocks.save.mockImplementation(async (_id, input) => {
    if (input.expectedUpdatedAt !== official.updatedAt)
      throw new Error('RULE_SOURCE_CONFLICT: 正式设定已更新');
    official = { ...official, title: input.title, content: input.content, updatedAt: 'saved' };
    return official;
  });
  await editSource();
  fireEvent.change(screen.getByTestId('setting-title'), { target: { value: '保留的标题' } });
  fireEvent.change(screen.getByTestId('setting-change-notes'), { target: { value: '保留的说明' } });
  await previewAndConfirm();
  official = { ...world, content: '外部修订：原件不得喷水，也不得折叠。', updatedAt: 'external' };
  fireEvent.click(screen.getByTestId('setting-save'));
  await waitFor(() =>
    expect(screen.getByTestId('setting-editor-message').textContent).toContain(
      'RULE_SOURCE_CONFLICT',
    ),
  );

  const editor = screen.getByTestId('setting-content') as HTMLTextAreaElement;
  const refresh = deferred<(typeof world)[]>();
  mocks.worlds.mockReturnValueOnce(refresh.promise);
  fireEvent.click(screen.getByRole('button', { name: '刷新正式版本（保留输入）' }));
  await screen.findByText('正在刷新正式版本，未保存内容保留…');
  expect(screen.getByTestId('setting-content')).toBe(editor);
  expect(editor.value).toBe(content);
  expect(editor.closest('fieldset')?.disabled).toBe(true);
  await act(async () => refresh.resolve([official]));

  fireEvent.click(await screen.findByTestId('setting-rebase-draft'));
  expect(screen.getByTestId('setting-content')).toBe(editor);
  expect(editor.value).toBe(content);
  expect((screen.getByTestId('setting-title') as HTMLInputElement).value).toBe('保留的标题');
  expect((screen.getByTestId('setting-change-notes') as HTMLTextAreaElement).value).toBe(
    '保留的说明',
  );
  expect(screen.queryByTestId('setting-author-confirm')).toBeNull();
  expect((screen.getByTestId('setting-save') as HTMLButtonElement).disabled).toBe(true);
  await previewAndConfirm();
  fireEvent.click(screen.getByTestId('setting-save'));
  await screen.findByText(/已保存源设定：保留的标题/u);
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.save.mock.calls[1][1]).toMatchObject({
    title: '保留的标题',
    content,
    expectedUpdatedAt: 'external',
    changeAuthorization: { notes: expect.stringContaining('保留的说明') },
  });
});

it('invalidates an earlier preview after refresh even if the edited asset did not change', async () => {
  await editSource();
  await previewAndConfirm();
  expect((screen.getByTestId('setting-save') as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '刷新正式版本（保留输入）' }));
  await waitFor(() => expect(screen.queryByTestId('setting-author-confirm')).toBeNull());
  expect((screen.getByTestId('setting-content') as HTMLTextAreaElement).value).toBe(content);
  expect((screen.getByTestId('setting-save') as HTMLButtonElement).disabled).toBe(true);
  expect(mocks.save).not.toHaveBeenCalled();
});

it('keeps the original adopted hash after refresh finds changed prose and blocks saving', async () => {
  await editSource();
  await previewAndConfirm();
  const changed = '新的采用正文，不能作为先前核对的依据。';
  mocks.draft.mockResolvedValue({
    ...draft,
    content: changed,
    contentState: { ...draft.contentState, content: changed },
  });
  fireEvent.click(screen.getByRole('button', { name: '刷新正式版本（保留输入）' }));
  await screen.findByText(/CHAPTER_SOURCE_CHANGED/u);
  const editor = screen.getByTestId('setting-content') as HTMLTextAreaElement;
  expect(editor.value).toBe(content);
  expect(editor.closest('fieldset')?.disabled).toBe(true);
  fireEvent.click(screen.getByTestId('setting-save'));
  expect(mocks.save).not.toHaveBeenCalled();
  expect(screen.queryByText(changed)).toBeNull();
});

it('keeps local input when a refresh fails or removes the edited source', async () => {
  await editSource();
  const editor = screen.getByTestId('setting-content') as HTMLTextAreaElement;
  mocks.worlds.mockRejectedValueOnce(new Error('读取中断'));
  fireEvent.click(screen.getByRole('button', { name: '刷新正式版本（保留输入）' }));
  await screen.findByText('读取中断');
  expect(screen.getByTestId('setting-content')).toBe(editor);
  expect(editor.value).toBe(content);
  mocks.worlds.mockResolvedValue([]);
  fireEvent.click(screen.getByRole('button', { name: '刷新正式版本（保留输入）' }));
  await screen.findByText('此设定已停用或移除。本地输入保留，当前不能保存。');
  expect(screen.getByTestId('setting-content')).toBe(editor);
  expect(editor.value).toBe(content);
  expect(editor.closest('fieldset')?.disabled).toBe(true);
  expect(mocks.save).not.toHaveBeenCalled();
});

it('never exposes the previous scope or a late response while loading another chapter', async () => {
  const firstLoad = deferred<(typeof world)[]>();
  mocks.worlds.mockReturnValueOnce(firstLoad.promise);
  const { result, rerender } = renderHook(
    ({ chapterId, draftId }) => useChapterSourceReview('n', chapterId, draftId),
    {
      initialProps: { chapterId: 'c', draftId: 'd' },
    },
  );
  await waitFor(() => expect(mocks.worlds).toHaveBeenCalledTimes(1));
  mocks.chapter.mockResolvedValue({ ...chapter, id: 'c2', adoptedDraftId: 'd2' });
  mocks.draft.mockResolvedValue({ ...draft, id: 'd2', chapterId: 'c2' });
  mocks.worlds.mockResolvedValue([{ ...world, id: 'w2', title: '另章设定' }]);
  rerender({ chapterId: 'c2', draftId: 'd2' });
  expect(result.current.snapshot).toBeUndefined();
  await waitFor(() => expect(result.current.snapshot?.chapterId).toBe('c2'));
  await act(async () => firstLoad.resolve([world]));
  expect(result.current.snapshot?.draftId).toBe('d2');
  expect(result.current.snapshot?.assets[0].record.id).toBe('w2');
  const nextDraftLoad = deferred<(typeof world)[]>();
  mocks.chapter.mockResolvedValue({ ...chapter, id: 'c2', adoptedDraftId: 'd3' });
  mocks.draft.mockResolvedValue({ ...draft, id: 'd3', chapterId: 'c2' });
  mocks.worlds.mockReturnValueOnce(nextDraftLoad.promise);
  rerender({ chapterId: 'c2', draftId: 'd3' });
  expect(result.current.snapshot).toBeUndefined();
  await waitFor(() => expect(mocks.worlds).toHaveBeenCalledTimes(3));
  await act(async () => nextDraftLoad.resolve([world]));
  await waitFor(() => expect(result.current.snapshot?.draftId).toBe('d3'));
});

it('requires discarding unsaved input before closing or following focused source links', async () => {
  await editSource();
  fireEvent.click(screen.getByRole('button', { name: '关闭' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
  expect((screen.getByTestId('setting-content') as HTMLTextAreaElement).value).toBe(content);
  expect(mocks.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '核对人物档案' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2));
  expect(mocks.navigate).not.toHaveBeenCalled();
  mocks.confirm.mockResolvedValue(true);
  fireEvent.click(screen.getByRole('button', { name: '核对本章与后章大纲' }));
  await waitFor(() =>
    expect(mocks.navigate).toHaveBeenCalledWith('/novels/n/outline?type=chapter&chapterId=c'),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
});

it('fails closed on unavailable prose, wrong scope, stale asset and absent confirmation', async () => {
  const snapshot = await loadChapterSourceReview('n', 'c', 'd');
  await expect(
    saveChapterSourceCorrection(snapshot, snapshot.assets[0], {
      title: 'x',
      content,
      expectedUpdatedAt: 'before',
    }),
  ).rejects.toThrow('确认');
  await expect(
    previewChapterSourceCorrection(snapshot, {
      targetType: 'world_setting',
      targetId: 'other',
      title: 'x',
      content,
      isActive: true,
    }),
  ).rejects.toThrow('失效');
  mocks.draft.mockResolvedValue({ ...draft, novelId: 'other' });
  await expect(loadChapterSourceReview('n', 'c', 'd')).rejects.toThrow('完整可读');
  mocks.draft.mockResolvedValue({ ...draft, contentState: { status: 'unavailable' } });
  await expect(loadChapterSourceReview('n', 'c', 'd')).rejects.toThrow('完整可读');
});
