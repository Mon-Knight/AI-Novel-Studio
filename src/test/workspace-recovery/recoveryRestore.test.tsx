import { createRef } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import EditorArea, { type EditorAreaHandle } from '../../components/workspace/EditorArea';
import { draftVersionService } from '../../services/database/draftVersionService';
import type { ChapterDraft } from '../../types/ai';
import type { Chapter } from '../../types/chapter';

describe('T09 - restore a matching recovery snapshot', () => {
  it('restores only into editor memory, marks dirty, and creates no formal draft', async () => {
    const chapter = {
      id: 'chapter-a',
      novelId: 'novel-a',
      title: '第一章',
      chapterNumber: 1,
      orderIndex: 0,
      sortOrder: 0,
      status: 'editing',
      wordCount: 4,
      currentWords: 4,
      targetWords: 2000,
      drafts: [],
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:01:00.000Z',
    } as Chapter;
    const draft: ChapterDraft = {
      id: 'draft-a',
      novelId: 'novel-a',
      chapterId: 'chapter-a',
      content: '当前正文',
      source: 'user_edited',
      versionNo: 2,
      wordCount: 4,
      isAdopted: false,
      contentState: {
        status: 'ready',
        content: '当前正文',
        contentHash: 'base-hash',
        contentLength: 4,
      },
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:01:00.000Z',
    };
    const editorRef = createRef<EditorAreaHandle>();
    const onEditorContentChange = vi.fn();
    const createSpy = vi.spyOn(draftVersionService, 'create');
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
    await waitFor(() => expect((screen.getByRole('textbox') as HTMLTextAreaElement).value)
      .toBe('当前正文'));

    act(() => {
      expect(editorRef.current?.restoreRecovery('异常退出前正文', 1, 3)).toBe(true);
    });

    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('异常退出前正文');
    expect(onEditorContentChange).toHaveBeenLastCalledWith(expect.objectContaining({
      chapterId: 'chapter-a',
      draftId: 'draft-a',
      content: '异常退出前正文',
      isDirty: true,
      contentAvailable: true,
    }));
    expect(createSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });
});
