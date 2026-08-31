import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EditorArea from '../../components/workspace/EditorArea';
import { draftVersionService } from '../../services/database/draftVersionService';
import type { ChapterDraft } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import * as nativeDialog from '../../utils/nativeDialog';

const timestamp = '2026-08-30T00:00:00.000Z';
const chapter: Chapter = {
  id: 'chapter-1',
  novelId: 'novel-1',
  title: '审阅章节',
  chapterNumber: 1,
  orderIndex: 1,
  sortOrder: 1,
  status: 'editing',
  wordCount: 12,
  currentWords: 12,
  targetWords: 3000,
  drafts: [],
  createdAt: timestamp,
  updatedAt: timestamp,
};
const draft: ChapterDraft = {
  id: 'draft-1',
  novelId: 'novel-1',
  chapterId: 'chapter-1',
  content: ' 第一段\n\n\n第二段 ',
  source: 'user_edited',
  versionNo: 2,
  wordCount: 12,
  isAdopted: false,
  createdAt: timestamp,
  updatedAt: timestamp,
};

beforeEach(() => {
  vi.spyOn(draftVersionService, 'create').mockRejectedValue(new Error('不应创建草稿'));
  vi.spyOn(draftVersionService, 'update').mockRejectedValue(new Error('不应更新草稿'));
  vi.spyOn(draftVersionService, 'adopt').mockRejectedValue(new Error('不应重复采用'));
  vi.spyOn(nativeDialog, 'confirmInfo').mockResolvedValue(true);
});

describe('EditorArea review command safety', () => {
  it('keeps formatting inert while review is locked and allows it after explicit editing', async () => {
    const view = render(
      <EditorArea chapter={chapter} novelId="novel-1" currentDraft={draft} reviewLocked />,
    );
    const editor = await screen.findByTestId('chapter-editor');
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe(draft.content));

    view.rerender(
      <EditorArea
        chapter={chapter}
        novelId="novel-1"
        currentDraft={draft}
        reviewLocked
        commandRequest={{ id: 'format-locked', type: 'format' }}
      />,
    );
    expect((editor as HTMLTextAreaElement).value).toBe(draft.content);
    expect(editor.getAttribute('data-dirty')).toBe('false');

    view.rerender(
      <EditorArea
        chapter={chapter}
        novelId="novel-1"
        currentDraft={draft}
        commandRequest={{ id: 'format-unlocked', type: 'format' }}
      />,
    );
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe('第一段\n\n第二段'));
    expect(editor.getAttribute('data-dirty')).toBe('true');
  });

  it('does not persist or re-adopt identical adopted content', async () => {
    const adoptedDraft = { ...draft, isAdopted: true };
    const view = render(
      <EditorArea chapter={chapter} novelId="novel-1" currentDraft={adoptedDraft} />,
    );
    const editor = await screen.findByTestId('chapter-editor');
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe(adoptedDraft.content));

    view.rerender(
      <EditorArea
        chapter={chapter}
        novelId="novel-1"
        currentDraft={adoptedDraft}
        commandRequest={{ id: 'save-adopted', type: 'save' }}
      />,
    );
    await waitFor(() => expect(screen.getByText('当前正文已采用，无需保存')).not.toBeNull());
    expect(draftVersionService.create).not.toHaveBeenCalled();
    expect(draftVersionService.update).not.toHaveBeenCalled();

    view.rerender(
      <EditorArea
        chapter={chapter}
        novelId="novel-1"
        currentDraft={adoptedDraft}
        commandRequest={{ id: 'adopt-adopted', type: 'adopt-current' }}
      />,
    );
    await waitFor(() =>
      expect(screen.getAllByText('当前正文已采用').length).toBeGreaterThanOrEqual(1),
    );
    expect(nativeDialog.confirmInfo).not.toHaveBeenCalled();
    expect(draftVersionService.adopt).not.toHaveBeenCalled();
  });
});
