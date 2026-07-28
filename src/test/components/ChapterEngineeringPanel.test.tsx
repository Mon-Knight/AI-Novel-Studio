import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import ChapterEngineeringPanel from '../../components/right-dock/panels/ChapterEngineeringPanel';
import { chapterEngineeringService } from '../../services/engineering/chapterEngineeringService';
import { generationContextCompiler } from '../../services/generation/generationContextCompiler';
import { generationJobService } from '../../services/generation/generationJobService';
import { qualityCheckService } from '../../services/quality/qualityCheckService';
import type { Chapter } from '../../types/chapter';

const chapter: Chapter = {
  id: 'chapter-engineering-1',
  novelId: 'novel-1',
  volumeId: 'volume-1',
  title: '第一章',
  outline: '旧城区出现无法解释的记录缺口',
  goal: '让主角决定继续调查',
  chapterNumber: 1,
  orderIndex: 0,
  sortOrder: 0,
  status: 'outline_ready',
  wordCount: 0,
  currentWords: 0,
  targetWordCount: 2_400,
  targetWords: 2_400,
  drafts: [],
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T00:00:00.000Z',
};

beforeEach(() => {
  vi.spyOn(chapterEngineeringService, 'getBundle').mockResolvedValue({
    activeState: undefined,
    latestDraft: undefined,
    states: [],
    hasUnappliedDraft: false,
  });
  vi.spyOn(generationContextCompiler, 'getLatestByChapterId').mockResolvedValue(null);
  vi.spyOn(generationJobService, 'getByChapterId').mockResolvedValue([]);
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
});

test('章节对象仅重建时不重复加载，工程默认值变化时精确刷新', async () => {
  const getBundle = vi.mocked(chapterEngineeringService.getBundle);
  const { rerender } = render(
    <ChapterEngineeringPanel novelId={chapter.novelId} chapter={chapter} />,
  );

  await waitFor(() => expect(getBundle).toHaveBeenCalledTimes(1));

  rerender(<ChapterEngineeringPanel novelId={chapter.novelId} chapter={{ ...chapter }} />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(getBundle).toHaveBeenCalledTimes(1);

  const changed = { ...chapter, goal: '让主角决定公开调查结果' };
  rerender(<ChapterEngineeringPanel novelId={changed.novelId} chapter={changed} />);
  await waitFor(() => expect(getBundle).toHaveBeenCalledTimes(2));
  expect(getBundle.mock.calls[1]).toEqual([
    chapter.id,
    {
      title: chapter.title,
      goal: changed.goal,
      outline: chapter.outline,
      targetWordCount: chapter.targetWordCount,
      targetWords: chapter.targetWords,
    },
  ]);
});
