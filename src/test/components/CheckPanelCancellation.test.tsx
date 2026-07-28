import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import CheckPanel from '../../components/right-dock/panels/CheckPanel';
import { qualityCheckAiService } from '../../services/ai/qualityCheckAiService';
import { AiRequestCancelledError } from '../../services/ai/aiCancellation';
import { draftVersionService } from '../../services/database/draftVersionService';
import { qualityCheckService } from '../../services/quality/qualityCheckService';
import type { ChapterDraft } from '../../types/ai';
import type { Chapter } from '../../types/chapter';

const content = Array.from({ length: 360 }, (_, index) => `正文${index}`).join('，');
const chapter: Chapter = {
  id: 'chapter-check-cancel',
  novelId: 'novel-check-cancel',
  volumeId: 'volume-check-cancel',
  title: '取消检查章节',
  outline: '主角发现新的线索。',
  goal: '完成一次关键选择。',
  chapterNumber: 1,
  orderIndex: 0,
  sortOrder: 0,
  status: 'editing',
  wordCount: 360,
  currentWords: 360,
  targetWordCount: 2_400,
  targetWords: 2_400,
  drafts: [],
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
};
const draft: ChapterDraft = {
  id: 'draft-check-cancel',
  novelId: chapter.novelId,
  chapterId: chapter.id,
  content,
  source: 'user_edited',
  versionNo: 1,
  wordCount: 360,
  isAdopted: false,
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
};

afterEach(() => {
  vi.restoreAllMocks();
});

test('停止质量检查会中止真实 service signal，且迟到链路不保存报告', async () => {
  vi.spyOn(draftVersionService, 'getLatestByChapterId').mockResolvedValue(draft);
  vi.spyOn(qualityCheckService, 'getChapterIssues').mockResolvedValue({
    report: null,
    items: [],
    statistics: {
      total: 0,
      pending: 0,
      resolved: 0,
      ignored: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
  });
  vi.spyOn(qualityCheckService, 'listReports').mockResolvedValue([]);
  const createReport = vi.spyOn(qualityCheckService, 'createReport');
  let receivedSignal: AbortSignal | undefined;
  vi.spyOn(qualityCheckAiService, 'runCheck').mockImplementation(async (_input, options) => {
    receivedSignal = options?.signal;
    return new Promise((resolve, reject) => {
      const onAbort = () => reject(new AiRequestCancelledError());
      options?.signal?.addEventListener('abort', onAbort, { once: true });
      if (options?.signal?.aborted) onAbort();
      void resolve;
    });
  });

  render(
    <CheckPanel
      novelId={chapter.novelId}
      chapter={chapter}
      currentEditorContent={content}
      currentEditorWordCount={360}
      currentEditorDirty={false}
      currentDraftId={draft.id}
      currentDraftVersion={draft.versionNo}
    />,
  );
  await waitFor(() => expect(draftVersionService.getLatestByChapterId).toHaveBeenCalled());

  fireEvent.click(screen.getByTestId('quality-check-run'));
  await waitFor(() => expect(qualityCheckAiService.runCheck).toHaveBeenCalledTimes(1));
  expect(receivedSignal?.aborted).toBe(false);

  fireEvent.click(screen.getByTestId('quality-operation-stop'));
  expect(receivedSignal?.aborted).toBe(true);
  await waitFor(() => expect(screen.queryByTestId('quality-operation-stop')).toBeNull());
  expect(createReport).not.toHaveBeenCalled();
  expect(screen.queryByTestId('error-notice')).toBeNull();
});
