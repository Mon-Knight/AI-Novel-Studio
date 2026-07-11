import { createRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import ContentUnavailableState from '../../components/workspace/ContentUnavailableState';
import EditorArea, { type EditorAreaHandle } from '../../components/workspace/EditorArea';
import { draftVersionService } from '../../services/database/draftVersionService';
import type { ChapterDraft } from '../../types/ai';
import type { Chapter } from '../../types/chapter';

describe('T08 - unavailable large-text content', () => {
  it('never exposes the preview as editable content and disables a non-retryable reload', () => {
    render(
      <ContentUnavailableState
        state={{
          status: 'unavailable',
          preview: '这只是截断预览，不是完整正文',
          errorCode: 'LARGE_TEXT_CONTENT_UNAVAILABLE',
          retryable: false,
          expectedHash: 'expected-hash',
          actualHash: 'actual-hash',
        }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByTestId('content-unavailable-state')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByDisplayValue('这只是截断预览，不是完整正文')).toBeNull();
    expect(screen.queryByText('这只是截断预览，不是完整正文')).toBeNull();
    expect(screen.getByText(/编辑、保存、采用和 AI 正文操作已暂停/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '重新读取正文' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('offers an explicit retry without treating the preview as content', async () => {
    const onRetry = vi.fn();
    const user = userEvent.setup();
    render(
      <ContentUnavailableState
        state={{
          status: 'unavailable',
          preview: 'preview-only',
          errorCode: 'LARGE_TEXT_CONTENT_UNAVAILABLE',
          retryable: true,
        }}
        onRetry={onRetry}
      />,
    );

    await user.click(screen.getByRole('button', { name: '重新读取正文' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('preview-only')).toBeNull();
  });

  it('renders the real editor in a locked state and refuses an imperative save', async () => {
    const chapter: Chapter = {
      id: 'chapter-a',
      novelId: 'novel-a',
      title: '第一章',
      chapterNumber: 1,
      orderIndex: 0,
      sortOrder: 0,
      status: 'editing',
      wordCount: 500,
      currentWords: 500,
      targetWords: 2000,
      drafts: [],
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:01:00.000Z',
    };
    const draft: ChapterDraft = {
      id: 'draft-a',
      novelId: 'novel-a',
      chapterId: 'chapter-a',
      content: '',
      source: 'user_edited',
      versionNo: 2,
      wordCount: 500,
      isAdopted: false,
      largeTextRefId: 'document-a',
      contentState: {
        status: 'unavailable',
        preview: '不能进入编辑器的截断预览',
        errorCode: 'LARGE_TEXT_CONTENT_UNAVAILABLE',
        retryable: true,
      },
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:01:00.000Z',
    };
    const editorRef = createRef<EditorAreaHandle>();
    const onEditorContentChange = vi.fn();
    const updateSpy = vi.spyOn(draftVersionService, 'update');

    render(
      <EditorArea
        ref={editorRef}
        chapter={chapter}
        novelId="novel-a"
        currentDraft={draft}
        onEditorContentChange={onEditorContentChange}
      />,
    );

    expect(screen.getByTestId('content-unavailable-state')).toBeTruthy();
    expect(screen.queryByPlaceholderText(/在这里输入或粘贴正文内容/)).toBeNull();
    expect(screen.queryByText('不能进入编辑器的截断预览')).toBeNull();
    await waitFor(() => expect(onEditorContentChange).toHaveBeenCalledWith(expect.objectContaining({
      chapterId: 'chapter-a',
      draftId: 'draft-a',
      content: '',
      isDirty: false,
      contentAvailable: false,
    })));

    let saved: ChapterDraft | null | undefined;
    await act(async () => {
      saved = await editorRef.current?.save();
    });
    expect(saved).toBeNull();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
