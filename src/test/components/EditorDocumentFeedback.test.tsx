import { createRef } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EditorArea, {
  type EditorAreaHandle,
  type EditorActionState,
} from '../../components/workspace/EditorArea';
import { useEditorDocumentController } from '../../components/workspace/editor-area/useEditorDocumentController';
import { useChapterOutlineEditor } from '../../components/workspace/editor-area/useChapterOutlineEditor';
import StatusBar from '../../components/workspace/StatusBar';
import { draftVersionService } from '../../services/database/draftVersionService';
import { chapterRepository } from '../../services/database/chapterRepository';
import { artifactDecisionService } from '../../services/conversation/artifactDecisionService';
import type { ChapterDraft } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import { confirmInfo } from '../../utils/nativeDialog';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { ModalFrame } from '../../components/common/ModalFrame';

vi.mock('../../utils/nativeDialog', () => ({ confirmInfo: vi.fn() }));
vi.mock('../../utils/contentIntegrity', () => ({
  computeContentSha256: vi.fn(async () => 'verified-content-hash'),
}));

const timestamp = '2026-09-05T00:00:00.000Z';
const chapter: Chapter = {
  id: 'chapter-feedback-a',
  novelId: 'novel-feedback',
  title: '雾港来信',
  chapterNumber: 1,
  orderIndex: 1,
  sortOrder: 1,
  status: 'editing',
  wordCount: 6,
  currentWords: 6,
  targetWords: 3000,
  drafts: [],
  createdAt: timestamp,
  updatedAt: timestamp,
};
const draft: ChapterDraft = {
  id: 'draft-feedback-a',
  chapterId: chapter.id,
  novelId: chapter.novelId,
  content: '原始正文。',
  source: 'user_edited',
  versionNo: 1,
  wordCount: 6,
  isAdopted: false,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const chapterB = { ...chapter, id: 'chapter-feedback-b', title: '灯塔守夜' };
const draftB = { ...draft, id: 'draft-feedback-b', chapterId: chapterB.id, content: '乙章正文。' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function renderDocument(onDraftSaved = vi.fn(), initialDraft = draft) {
  return renderHook(
    ({ currentChapter, currentDraft }) =>
      useEditorDocumentController({
        chapter: currentChapter,
        novelId: currentChapter.novelId,
        currentDraft,
        documentState: 'ready',
        onDraftSaved,
      }),
    { initialProps: { currentChapter: chapter, currentDraft: initialDraft } },
  );
}

beforeEach(() => {
  vi.mocked(confirmInfo).mockResolvedValue(true);
  vi.spyOn(draftVersionService, 'create').mockRejectedValue(
    new Error('Unexpected create in feedback test'),
  );
  vi.spyOn(draftVersionService, 'update').mockImplementation(async (_id, _chapterId, content) => ({
    ...draft,
    content,
    versionNo: 2,
  }));
  vi.spyOn(draftVersionService, 'adopt').mockResolvedValue({ ...draft, isAdopted: true });
  vi.spyOn(chapterRepository, 'update').mockResolvedValue(chapter);
  vi.spyOn(artifactDecisionService, 'adoptReviewAuthorizedDraft').mockRejectedValue(
    new Error('Unexpected authorized adoption'),
  );
});

describe('editor persistence and adoption feedback', () => {
  it('does not save background prose for shortcuts while a modal or IME owns input', async () => {
    const editor = <EditorArea chapter={chapter} novelId={chapter.novelId} currentDraft={draft} />;
    const view = render(editor);
    fireEvent.change(screen.getByTestId('chapter-editor'), { target: { value: '未保存修改' } });
    fireEvent.keyDown(screen.getByTestId('chapter-editor'), {
      key: 's',
      ctrlKey: true,
      keyCode: 229,
    });
    expect(draftVersionService.update).not.toHaveBeenCalled();
    view.rerender(
      <>
        {editor}
        <ModalFrame title="正在处理表单">
          <input aria-label="表单字段" />
        </ModalFrame>
      </>,
    );
    expect((screen.getByTestId('chapter-editor') as HTMLTextAreaElement).value).toBe('未保存修改');
    expect(screen.getByTestId('chapter-editor').getAttribute('data-dirty')).toBe('true');
    fireEvent.keyDown(screen.getByRole('textbox', { name: '表单字段' }), {
      key: 's',
      ctrlKey: true,
    });
    expect(draftVersionService.update).not.toHaveBeenCalled();
  });

  it('starts persistence and publishes saving state even when animation frames never fire', async () => {
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const pending = deferred<ChapterDraft>();
    vi.mocked(draftVersionService.update).mockReturnValue(pending.promise);
    const ref = createRef<EditorAreaHandle>();
    const actions = vi.fn<(state: EditorActionState) => void>();
    render(
      <EditorArea
        ref={ref}
        chapter={chapter}
        novelId={chapter.novelId}
        currentDraft={draft}
        onActionStateChange={actions}
      />,
    );
    fireEvent.change(screen.getByTestId('chapter-editor'), {
      target: { value: '立即保存的正文。' },
    });
    let saving!: Promise<ChapterDraft | null>;
    act(() => {
      saving = ref.current!.save();
    });
    expect(draftVersionService.update).toHaveBeenCalledTimes(1);
    expect(actions).toHaveBeenCalledWith(
      expect.objectContaining({ saving: true, saveState: 'saving' }),
    );
    expect(frame).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor-save-feedback').textContent).toBe('保存中');
    await act(async () => {
      pending.resolve({ ...draft, content: '立即保存的正文。' });
      await saving;
    });
    expect(screen.getByTestId('editor-save-feedback').textContent).toBe('已保存');
  });

  it('preserves edited text and a persistent save error with an inline retry', async () => {
    vi.mocked(draftVersionService.update).mockRejectedValueOnce(new Error('磁盘不可写'));
    const ref = createRef<EditorAreaHandle>();
    render(
      <EditorArea ref={ref} chapter={chapter} novelId={chapter.novelId} currentDraft={draft} />,
    );
    fireEvent.change(screen.getByTestId('chapter-editor'), {
      target: { value: '错误期间保留正文' },
    });
    await act(async () => {
      await ref.current!.save();
    });
    expect(screen.getByTestId('editor-save-feedback').getAttribute('role')).toBe('alert');
    fireEvent.change(screen.getByTestId('chapter-editor'), { target: { value: '错误后继续编辑' } });
    vi.useFakeTimers();
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByTestId('editor-save-feedback').textContent).toContain('磁盘不可写');
    vi.useRealTimers();
    fireEvent.click(screen.getByRole('button', { name: '重试保存' }));
    await waitFor(() =>
      expect(screen.getByTestId('editor-save-feedback').textContent).toBe('已保存'),
    );
    expect((screen.getByTestId('chapter-editor') as HTMLTextAreaElement).value).toBe(
      '错误后继续编辑',
    );
  });

  it('keeps a successful save independent from a failed adoption, and retry asks for confirmation again', async () => {
    vi.mocked(draftVersionService.adopt).mockRejectedValueOnce(new Error('采用事务冲突'));
    const { result } = renderDocument();
    act(() => result.current.handleContentChange('新正文'));
    await act(async () => {
      await result.current.handleAdoptCurrent();
    });
    expect(result.current.saveState).toBe('saved');
    expect(result.current.saveMsg).toBe('已保存');
    expect(result.current.adoptState).toBe('error');
    expect(result.current.adoptMsg).toContain('采用事务冲突');
    vi.useFakeTimers();
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(result.current.adoptState).toBe('error');
    vi.useRealTimers();
    vi.mocked(draftVersionService.adopt).mockResolvedValue({
      ...draft,
      content: '新正文',
      isAdopted: true,
    });
    await act(async () => {
      await result.current.handleAdoptCurrent();
    });
    expect(confirmInfo).toHaveBeenCalledTimes(2);
    expect(result.current.adoptState).toBe('adopted');
  });

  it('retries adoption from its inline error without converting the saved draft into a save error', async () => {
    vi.mocked(draftVersionService.adopt).mockRejectedValueOnce(new Error('采用失败测试'));
    const view = render(
      <EditorArea chapter={chapter} novelId={chapter.novelId} currentDraft={draft} />,
    );
    view.rerender(
      <EditorArea
        chapter={chapter}
        novelId={chapter.novelId}
        currentDraft={draft}
        commandRequest={{ id: 'adopt-first', type: 'adopt-current' }}
      />,
    );
    await screen.findByRole('button', { name: '重试采用' });
    expect(screen.getByTestId('editor-adopt-feedback').getAttribute('role')).toBe('alert');
    fireEvent.click(screen.getByRole('button', { name: '重试采用' }));
    await waitFor(() =>
      expect(screen.getByTestId('editor-adopt-feedback').textContent).toBe('已采用为正式正文'),
    );
    expect(confirmInfo).toHaveBeenCalledTimes(2);
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a late save %s after visiting A -> B -> A',
    async (settlement) => {
      const pending = deferred<ChapterDraft>();
      vi.mocked(draftVersionService.update).mockReturnValueOnce(pending.promise);
      const onSaved = vi.fn();
      const { result, rerender } = renderDocument(onSaved);
      act(() => result.current.handleContentChange('旧访问中的修改'));
      let operation!: Promise<ChapterDraft | null>;
      act(() => {
        operation = result.current.handleSave();
      });
      rerender({ currentChapter: chapterB, currentDraft: draftB });
      rerender({ currentChapter: chapter, currentDraft: draft });
      act(() => result.current.handleContentChange('新访问中的修改'));
      await act(async () => {
        if (settlement === 'resolve') pending.resolve({ ...draft, content: '旧访问中的修改' });
        else pending.reject(new Error('旧保存错误'));
        await operation;
      });
      expect(result.current.content).toBe('新访问中的修改');
      expect(result.current.saveMsg).not.toContain('旧保存错误');
      expect(result.current.saveState).toBe('editing');
      expect(onSaved).not.toHaveBeenCalled();
    },
  );

  it('does not let a previous chapter save settle the current chapter saving state', async () => {
    const first = deferred<ChapterDraft>();
    const second = deferred<ChapterDraft>();
    vi.mocked(draftVersionService.update)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result, rerender } = renderDocument();
    act(() => result.current.handleContentChange('甲修改'));
    let firstSave!: Promise<ChapterDraft | null>;
    let secondSave!: Promise<ChapterDraft | null>;
    act(() => {
      firstSave = result.current.handleSave();
    });
    rerender({ currentChapter: chapterB, currentDraft: draftB });
    act(() => result.current.handleContentChange('乙修改'));
    act(() => {
      secondSave = result.current.handleSave();
    });
    await act(async () => {
      first.reject(new Error('甲错误'));
      await firstSave;
    });
    expect(result.current.saving).toBe(true);
    expect(result.current.saveMsg).toBe('保存中');
    await act(async () => {
      second.resolve({ ...draftB, content: '乙修改' });
      await secondSave;
    });
    expect(result.current.saveState).toBe('saved');
  });

  it('clears prior failure state while a different chapter is still loading', async () => {
    vi.mocked(draftVersionService.update).mockRejectedValueOnce(new Error('甲章写入失败'));
    const { result, rerender } = renderHook(
      ({ currentChapter, currentDraft, state }) =>
        useEditorDocumentController({
          chapter: currentChapter,
          novelId: currentChapter.novelId,
          currentDraft,
          documentState: state,
        }),
      {
        initialProps: {
          currentChapter: chapter,
          currentDraft: draft,
          state: 'ready' as 'ready' | 'loading',
        },
      },
    );
    act(() => result.current.handleContentChange('甲章未保存正文'));
    await act(async () => {
      await result.current.handleSave();
    });
    expect(result.current.saveState).toBe('error');
    rerender({ currentChapter: chapterB, currentDraft: draftB, state: 'loading' });
    expect(result.current.saveState).toBe('idle');
    expect(result.current.saveMsg).toBe('');
    expect(result.current.adoptState).toBe('idle');
  });

  it('abandons a pending adoption confirmation after switching chapter, without any formal write', async () => {
    const confirmation = deferred<boolean>();
    vi.mocked(confirmInfo).mockReturnValueOnce(confirmation.promise);
    const { result, rerender } = renderDocument();
    let adopting!: Promise<void>;
    act(() => {
      adopting = result.current.handleAdoptCurrent();
    });
    rerender({ currentChapter: chapterB, currentDraft: draftB });
    await act(async () => {
      confirmation.resolve(true);
      await adopting;
    });
    expect(draftVersionService.adopt).not.toHaveBeenCalled();
    expect(result.current.adoptMsg).toBe('');
    expect(result.current.adopting).toBe(false);
  });

  it('guards double adoption and ignores its late error in a different chapter', async () => {
    const pending = deferred<ChapterDraft>();
    vi.mocked(draftVersionService.adopt).mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderDocument();
    let operation!: Promise<void>;
    await act(async () => {
      operation = result.current.handleAdoptCurrent();
    });
    await act(async () => {
      await result.current.handleAdoptCurrent();
    });
    expect(draftVersionService.adopt).toHaveBeenCalledTimes(1);
    rerender({ currentChapter: chapterB, currentDraft: draftB });
    await act(async () => {
      pending.reject(new Error('旧采用错误'));
      await operation;
    });
    expect(result.current.adoptState).toBe('idle');
    expect(result.current.adoptMsg).toBe('');
    expect(result.current.content).toBe(draftB.content);
  });

  it('keeps authorized adoption on the original authorization/version/hash service boundary', async () => {
    vi.mocked(artifactDecisionService.adoptReviewAuthorizedDraft).mockResolvedValue({
      authorization: {
        authorizationId: 'review-auth',
        artifactId: 'review-artifact',
        chapterId: chapter.id,
        novelId: chapter.novelId,
        decisionId: 'decision-review',
        status: 'consumed',
        issuedAt: timestamp,
      },
      adoptedDraft: { ...draft, isAdopted: true },
      summaryFollowUp: {
        status: 'pending_generation',
        chapterId: chapter.id,
        adoptedDraftId: draft.id,
      },
    });
    const { result } = renderHook(() =>
      useEditorDocumentController({
        chapter,
        novelId: chapter.novelId,
        currentDraft: draft,
        documentState: 'ready',
        reviewAuthorizationId: 'review-auth',
      }),
    );
    await act(async () => {
      await result.current.handleAdoptCurrent();
    });
    expect(computeContentSha256).toHaveBeenCalledWith(draft.content);
    expect(artifactDecisionService.adoptReviewAuthorizedDraft).toHaveBeenCalledWith({
      authorizationId: 'review-auth',
      draftId: draft.id,
      expectedDraftVersion: draft.versionNo,
      expectedContentHash: 'verified-content-hash',
    });
    expect(draftVersionService.adopt).not.toHaveBeenCalled();
    expect(result.current.adoptState).toBe('adopted');
  });

  it('rejects a changed baseline after confirmation before calling adoption', async () => {
    const confirmation = deferred<boolean>();
    vi.mocked(confirmInfo).mockReturnValueOnce(confirmation.promise);
    const { result } = renderDocument();
    let operation!: Promise<void>;
    act(() => {
      operation = result.current.handleAdoptCurrent();
    });
    act(() => result.current.handleContentChange('确认期间正文已经改变'));
    await act(async () => {
      confirmation.resolve(true);
      await operation;
    });
    expect(draftVersionService.adopt).not.toHaveBeenCalled();
    expect(result.current.adoptState).toBe('error');
    expect(result.current.adoptMsg).toContain('已阻止采用');
    expect(result.current.content).toBe('确认期间正文已经改变');
  });

  it('does not emit a stale snapshot after a save callback finishes in another chapter', async () => {
    const callback = deferred<void>();
    const snapshots = vi.fn();
    const { result, rerender } = renderHook(
      ({ currentChapter, currentDraft }) =>
        useEditorDocumentController({
          chapter: currentChapter,
          novelId: currentChapter.novelId,
          currentDraft,
          documentState: 'ready',
          onDraftSaved: () => callback.promise,
          onEditorContentChange: snapshots,
        }),
      { initialProps: { currentChapter: chapter, currentDraft: draft } },
    );
    act(() => result.current.handleContentChange('保存的甲正文'));
    let operation!: Promise<ChapterDraft | null>;
    await act(async () => {
      operation = result.current.handleSave();
    });
    rerender({ currentChapter: chapterB, currentDraft: draftB });
    snapshots.mockClear();
    await act(async () => {
      callback.resolve();
      await operation;
    });
    expect(snapshots).not.toHaveBeenCalled();
    expect(result.current.content).toBe(draftB.content);
  });

  it('starts outline persistence without animation frames and keeps draft-only refreshes from clearing outline edits', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    const { result, rerender } = renderHook(
      ({ currentDraft }) =>
        useChapterOutlineEditor({
          chapter,
          novelId: chapter.novelId,
          documentState: 'ready',
          currentDraft,
        }),
      { initialProps: { currentDraft: draft } },
    );
    act(() => result.current.handleStartEditOutline());
    act(() => result.current.setOutlineDraft('尚未保存的章纲'));
    rerender({ currentDraft: { ...draft, versionNo: 2 } });
    expect(result.current.outlineDraft).toBe('尚未保存的章纲');
    await act(async () => {
      await result.current.handleSaveOutline();
    });
    expect(chapterRepository.update).toHaveBeenCalledWith(chapter.id, {
      outline: '尚未保存的章纲',
    });
    expect(result.current.outlineSaveState).toBe('saved');
  });

  it('keeps failed outline text editable for retry and isolates late completion from another chapter', async () => {
    const pending = deferred<Chapter | null>();
    vi.mocked(chapterRepository.update)
      .mockRejectedValueOnce(new Error('章纲保存失败'))
      .mockReturnValueOnce(pending.promise);
    const { result, rerender } = renderHook(
      ({ currentChapter }) =>
        useChapterOutlineEditor({
          chapter: currentChapter,
          novelId: currentChapter.novelId,
          documentState: 'ready',
        }),
      { initialProps: { currentChapter: chapter } },
    );
    act(() => result.current.handleStartEditOutline());
    act(() => result.current.setOutlineDraft('应当保留的章纲'));
    await act(async () => {
      await result.current.handleSaveOutline();
    });
    expect(result.current.outlineSaveState).toBe('error');
    expect(result.current.isEditingOutline).toBe(true);
    act(() => result.current.setOutlineDraft('更新后的章纲'));
    expect(result.current.outlineSaveState).toBe('error');
    let operation!: Promise<void>;
    act(() => {
      operation = result.current.handleSaveOutline();
    });
    rerender({ currentChapter: chapterB });
    await act(async () => {
      pending.resolve(chapter);
      await operation;
    });
    expect(result.current.outlineSaveMsg).toBe('');
    expect(result.current.isEditingOutline).toBe(false);
  });

  it('does not report outline saved when its repository cannot find the target', async () => {
    vi.mocked(chapterRepository.update).mockResolvedValueOnce(null);
    const { result } = renderHook(() =>
      useChapterOutlineEditor({ chapter, novelId: chapter.novelId, documentState: 'ready' }),
    );
    act(() => result.current.handleStartEditOutline());
    act(() => result.current.setOutlineDraft('未写入的章纲'));
    await act(async () => {
      await result.current.handleSaveOutline();
    });
    expect(result.current.outlineSaveState).toBe('error');
    expect(result.current.outlineDraft).toBe('未写入的章纲');
  });

  it('shows a single main title, named prose, and collapsed context/metadata without changing the original content', () => {
    render(
      <EditorArea
        chapter={{ ...chapter, outline: '长章纲', goal: '本章目标' }}
        novelId={chapter.novelId}
        currentDraft={draft}
      />,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: /雾港来信 正文/ })).toBeTruthy();
    expect((document.querySelector('.editor-chapter-context') as HTMLDetailsElement).open).toBe(
      false,
    );
    expect((document.querySelector('.editor-document-metadata') as HTMLDetailsElement).open).toBe(
      false,
    );
    expect((screen.getByTestId('chapter-editor') as HTMLTextAreaElement).value).toBe(draft.content);
  });

  it('reports realtime words and both successful draft save and failed adoption in the bottom status region', () => {
    render(
      <StatusBar
        chapter={chapter}
        draftWordCount={1234}
        draftVersion="v2"
        documentSaveState="saved"
        documentAdoptState="error"
        documentAdoptMessage="采用失败：版本冲突"
      />,
    );
    expect(screen.getByTestId('chapter-word-count').getAttribute('data-word-count')).toBe('1234');
    expect(screen.getByTestId('document-save-status').textContent).toContain('已保存');
    expect(screen.getByTestId('document-adopt-status').textContent).toContain('采用失败');
    expect(screen.queryByText(/雾港来信/)).toBeNull();
  });
});
