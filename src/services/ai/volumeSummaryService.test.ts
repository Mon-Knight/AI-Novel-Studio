import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChapterSummary } from '../../types/chapterSummary';
import type { Chapter } from '../../types/chapter';
import type { Volume } from '../../types/volume';
const fixture = vi.hoisted(() => ({ summary: undefined as ChapterSummary | undefined }));
vi.mock('../context/chapterSummaryService', () => ({
  chapterSummaryService: { getByChapterId: async () => fixture.summary },
}));
vi.mock('./aiClient', () => ({
  createAiClient: vi.fn(),
  aiSettingsService: { getSettings: vi.fn() },
}));
vi.mock('./aiTaskService', () => ({ aiTaskService: {} }));
vi.mock('./aiTaskCancellation', () => ({
  bindAiTaskCancellation: vi.fn(),
  settleAiTaskError: vi.fn(),
}));
import { checkVolumeCompletion, collectVolumeChapterContexts } from './volumeSummaryService';
const volume = { id: 'volume', status: 'completed' } as Volume;
const chapters = [
  { id: 'chapter', novelId: 'novel', volumeId: 'volume', chapterNumber: 1, title: '第一章' },
] as Chapter[];
beforeEach(() => {
  fixture.summary = {
    id: 'summary',
    novelId: 'novel',
    chapterId: 'chapter',
    adoptedDraftId: 'draft',
    summary: '受控离线上下文',
    enabled: true,
    isExpired: false,
    createdAt: 't',
    updatedAt: 't',
  };
});
describe('volume context summary application eligibility', () => {
  it('never includes blocking character errors even if score and safeToContext are high', async () => {
    fixture.summary!.validationStatus = 'failed';
    fixture.summary!.validationResult = {
      passed: false,
      score: 98,
      safeToContext: true,
      problems: [{ type: 'character_error', message: 'blocking fixture' }],
    };
    expect(await collectVolumeChapterContexts('volume', chapters)).toEqual([]);
    const completion = await checkVolumeCompletion(volume, chapters);
    expect(completion.completed).toBe(false);
    expect(completion.reasons.join(' ')).toContain('应用策略');
  });
  it('keeps compatible manual summaries readable but does not fake semantic validation', async () => {
    const contexts = await collectVolumeChapterContexts('volume', chapters);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].summary).toBe('受控离线上下文');
    expect((await checkVolumeCompletion(volume, chapters)).completed).toBe(true);
    expect(fixture.summary!.validationResult).toBeUndefined();
  });
  it('requires actual human review where policy requests it', async () => {
    fixture.summary!.validationResult = {
      policyVersion: 1,
      passed: true,
      score: 100,
      safeToContext: true,
      problems: [],
      reviewRequirement: 'human_required',
    };
    expect(await collectVolumeChapterContexts('volume', chapters)).toEqual([]);
    fixture.summary!.validationResult.authorReviewed = true;
    expect(await collectVolumeChapterContexts('volume', chapters)).toHaveLength(1);
  });
});
