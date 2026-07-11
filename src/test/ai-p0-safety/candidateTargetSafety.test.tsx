import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Chapter } from '../../types/chapter';

const mocks = vi.hoisted(() => ({
  getVolume: vi.fn(),
  getChapter: vi.fn(),
  updateChapter: vi.fn(),
  generateChapterOutlines: vi.fn(),
  getEvents: vi.fn(),
  getCharacters: vi.fn(),
  getChapterCharacters: vi.fn(),
  createEvent: vi.fn(),
  suggestEvents: vi.fn(),
  getSummary: vi.fn(),
  createSummary: vi.fn(),
  markSummaryExpired: vi.fn(),
  getDrafts: vi.fn(),
  getLatestDraft: vi.fn(),
  createDraft: vi.fn(),
  adoptExact: vi.fn(),
  summarize: vi.fn(),
  runFix: vi.fn(),
  compareFix: vi.fn(),
  adoptFixRun: vi.fn(),
  saveFixRun: vi.fn(),
  runQualityCheck: vi.fn(),
  getQualityIssues: vi.fn(),
  createQualityReport: vi.fn(),
  saveQualityResult: vi.fn(),
  updateIssueStatus: vi.fn(),
  getContextRecords: vi.fn(),
  updateContextRecord: vi.fn(),
}));

vi.mock('../../services/database/volumeRepository', () => ({
  volumeRepository: { getById: mocks.getVolume },
}));
vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: { getById: mocks.getChapter, update: mocks.updateChapter },
}));
vi.mock('../../services/ai/outlineGenerateService', () => ({
  outlineGenerateService: {
    generateNovelOutline: vi.fn(),
    generateVolumeOutline: vi.fn(),
    generateChapterOutlines: mocks.generateChapterOutlines,
  },
}));
vi.mock('../../services/prompt/chapterOutlineDraftCache', () => ({
  clearCachedChapterOutlineDraft: vi.fn(),
  setCachedChapterOutlineDraft: vi.fn(),
}));
vi.mock('../../services/characters/characterService', () => ({
  characterService: { getByNovelId: mocks.getCharacters },
}));
vi.mock('../../services/characters/chapterCharacterService', () => ({
  chapterCharacterService: { getByChapterId: mocks.getChapterCharacters },
}));
vi.mock('../../services/characters/chapterEventService', () => ({
  chapterEventService: {
    getByChapterId: mocks.getEvents,
    create: mocks.createEvent,
    setStatus: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock('../../services/ai/eventSuggestService', () => ({
  eventSuggestService: { suggestEvents: mocks.suggestEvents },
}));
vi.mock('../../services/context/chapterSummaryService', () => ({
  chapterSummaryService: {
    getByChapterId: mocks.getSummary,
    create: mocks.createSummary,
    markExpired: mocks.markSummaryExpired,
    setEnabled: vi.fn(),
  },
}));
vi.mock('../../services/database/draftVersionService', () => ({
  draftVersionService: {
    getByChapterId: mocks.getDrafts,
    getLatestByChapterId: mocks.getLatestDraft,
    create: mocks.createDraft,
    adoptExact: mocks.adoptExact,
  },
}));
vi.mock('../../services/ai/chapterSummarizeService', () => ({
  chapterSummarizeService: { summarize: mocks.summarize },
}));
vi.mock('../../services/ai/summaryValidator', () => ({
  validateSummary: () => ({ passed: true, score: 100, problems: [], safeToContext: true }),
  hashContent: (value: string) => `hash:${value}`,
}));
vi.mock('../../services/ai/aiClient', () => ({
  aiSettingsService: { getSettings: () => ({ runtimeMode: 'mock', modelName: 'Mock', apiKey: '' }) },
}));
vi.mock('../../services/ai/qualityFixService', () => ({
  qualityFixService: {
    runFix: mocks.runFix,
    compareResults: mocks.compareFix,
    adoptFixRun: mocks.adoptFixRun,
    revertFixRun: vi.fn(),
  },
}));
vi.mock('../../services/ai/fixRunStore', () => ({
  fixRunStore: { save: mocks.saveFixRun },
}));
vi.mock('../../services/ai/qualityCheckAiService', () => ({
  qualityCheckAiService: { runCheck: mocks.runQualityCheck },
}));
vi.mock('../../services/quality/qualityCheckService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/quality/qualityCheckService')>();
  return {
    ...actual,
    qualityCheckService: {
      getChapterIssues: mocks.getQualityIssues,
      createReport: mocks.createQualityReport,
      saveResult: mocks.saveQualityResult,
      updateIssueStatus: mocks.updateIssueStatus,
    },
  };
});
vi.mock('../../services/prompt/contextReaderService', () => ({
  getContextForChapterTask: vi.fn().mockResolvedValue({
    chapterSummaries: [], volumeContexts: [], chapterContexts: [], warnings: [],
  }),
  buildContextPromptSection: vi.fn(() => ''),
}));
vi.mock('../../services/context/contextRecordService', () => ({
  contextRecordService: {
    getByNovelId: mocks.getContextRecords,
    update: mocks.updateContextRecord,
  },
}));
vi.mock('../../utils/nativeDialog', () => ({ confirmInfo: vi.fn().mockResolvedValue(true) }));

import OutlinePanel from '../../components/right-dock/panels/OutlinePanel';
import EventsPanel from '../../components/right-dock/panels/EventsPanel';
import ChapterSummaryPanel from '../../components/right-dock/panels/ChapterSummaryPanel';
import CheckPanel from '../../components/right-dock/panels/CheckPanel';

function chapter(id: string): Chapter {
  return {
    id,
    novelId: 'novel-a',
    volumeId: 'volume-a',
    title: `Chapter ${id}`,
    chapterNumber: id === 'chapter-a' ? 1 : 2,
    orderIndex: 0,
    sortOrder: 0,
    status: 'adopted',
    adoptedDraftId: `draft-${id}`,
    wordCount: 20,
    currentWords: 20,
    targetWords: 1000,
    drafts: [],
    createdAt: '2026-07-12T00:00:00.000Z',
    updatedAt: '2026-07-12T00:00:00.000Z',
  };
}

describe('P0 generated candidate target binding', () => {
  it('keeps an outline candidate bound to the chapter that generated it', async () => {
    mocks.getVolume.mockResolvedValue({ id: 'volume-a', title: 'Volume A' });
    mocks.generateChapterOutlines.mockResolvedValue([
      { title: 'Candidate A', outline: 'Outline A', goal: 'Goal A' },
    ]);
    const view = render(<OutlinePanel novelId="novel-a" chapter={chapter('chapter-a')} />);
    fireEvent.click(screen.getByRole('button', { name: /生成章节大纲/ }));
    const apply = await screen.findByRole('button', { name: /应用到当前章节/ });
    expect((apply as HTMLButtonElement).disabled).toBe(false);

    view.rerender(<OutlinePanel novelId="novel-a" chapter={chapter('chapter-b')} />);
    expect(await screen.findByText(/候选仍可查看，但不能写入当前章节/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /应用到当前章节/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.updateChapter).not.toHaveBeenCalled();
  });

  it('keeps an event suggestion bound to the chapter that generated it', async () => {
    mocks.getEvents.mockResolvedValue([]);
    mocks.getCharacters.mockResolvedValue([]);
    mocks.getChapterCharacters.mockResolvedValue([]);
    mocks.suggestEvents.mockResolvedValue([{ title: 'Event A', description: 'Description A' }]);
    const view = render(<EventsPanel novelId="novel-a" chapter={chapter('chapter-a')} />);
    await waitFor(() => expect(mocks.getEvents).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /生成本章事件建议/ }));
    expect((await screen.findByRole('button', { name: /采用建议/ }) as HTMLButtonElement).disabled).toBe(false);

    view.rerender(<EventsPanel novelId="novel-a" chapter={chapter('chapter-b')} />);
    expect(await screen.findByText(/候选仍可查看，但不能写入当前章节/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /采用建议/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });

  it('keeps a chapter summary bound to its adopted draft after switching chapters', async () => {
    mocks.getSummary.mockResolvedValue(null);
    mocks.getDrafts.mockImplementation(async (chapterId: string) => [{
      id: `draft-${chapterId}`,
      novelId: 'novel-a',
      chapterId,
      content: `Adopted content for ${chapterId}`,
      source: 'user_edit',
      versionNo: 3,
      wordCount: 20,
      isAdopted: true,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    }]);
    mocks.summarize.mockResolvedValue({
      summary: 'Summary A',
      keyEvents: [],
      characterChanges: [],
      relationshipChanges: [],
      newForeshadows: [],
      resolvedForeshadows: [],
      nextChapterHints: '',
      contextRecords: [],
    });
    const view = render(<ChapterSummaryPanel novelId="novel-a" chapter={chapter('chapter-a')} />);
    fireEvent.click(await screen.findByRole('button', { name: /生成章节上下文/ }));
    expect((await screen.findByRole('button', { name: /确认保存/ }) as HTMLButtonElement).disabled).toBe(false);

    view.rerender(<ChapterSummaryPanel novelId="novel-a" chapter={chapter('chapter-b')} />);
    expect(await screen.findByText(/该总结候选不能保存到当前章节/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /确认保存/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.createSummary).not.toHaveBeenCalled();
  });

  it('saves only the summary and defers derived context, character, and chapter writes', async () => {
    const chapterA = chapter('chapter-a');
    const adopted = {
      id: 'draft-chapter-a', novelId: 'novel-a', chapterId: 'chapter-a',
      content: 'Adopted content for chapter A', source: 'user_edit', versionNo: 3,
      wordCount: 20, isAdopted: true,
      createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
    };
    mocks.getSummary.mockResolvedValue(null);
    mocks.getDrafts.mockResolvedValue([adopted]);
    mocks.getChapter.mockResolvedValue(chapterA);
    mocks.summarize.mockResolvedValue({
      summary: 'Summary A', keyEvents: [], characterChanges: [], relationshipChanges: [],
      newForeshadows: [], resolvedForeshadows: [], nextChapterHints: '', contextRecords: [],
    });
    mocks.createSummary.mockResolvedValue({
      id: 'summary-a', novelId: 'novel-a', chapterId: 'chapter-a', volumeId: 'volume-a',
      adoptedDraftId: adopted.id, summary: 'Summary A', enabled: true, isExpired: false,
      createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
    });
    render(<ChapterSummaryPanel novelId="novel-a" chapter={chapterA} />);
    fireEvent.click(await screen.findByRole('button', { name: /生成章节上下文/ }));
    fireEvent.click(await screen.findByRole('button', { name: /确认保存/ }));

    await waitFor(() => expect(mocks.createSummary).toHaveBeenCalledOnce());
    expect(mocks.updateChapter).not.toHaveBeenCalled();
  });

  it('keeps quality-fix effects deferred until the user confirms the candidate', async () => {
    const sourceDraft = {
      id: 'draft-source',
      novelId: 'novel-a',
      chapterId: 'chapter-a',
      content: 'Source draft content long enough for a quality fix.',
      source: 'user_edit',
      versionNo: 3,
      wordCount: 20,
      isAdopted: true,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    };
    const candidateDraft = {
      ...sourceDraft,
      id: 'draft-candidate',
      content: 'Revised candidate content.',
      versionNo: 4,
      isAdopted: false,
    };
    const report = {
      id: 'report-before',
      novelId: 'novel-a',
      chapterId: 'chapter-a',
      draftId: 'draft-source',
      scope: 'current_draft',
      status: 'completed',
      overallScore: 60,
      summary: 'Needs work',
      contentHash: 'hash-source',
      draftVersion: 3,
      isExpired: false,
      createdAt: '2026-07-12T00:00:00.000Z',
      updatedAt: '2026-07-12T00:00:00.000Z',
    } as any;
    const issue = {
      id: 'issue-a', reportId: 'report-before', novelId: 'novel-a', chapterId: 'chapter-a',
      draftId: 'draft-source', issueType: 'logic', severity: 'high', title: 'Issue',
      description: 'Issue description', issueKey: 'issue-key-a', status: 'pending',
      createdAt: '2026-07-12T00:00:00.000Z', updatedAt: '2026-07-12T00:00:00.000Z',
    } as any;
    mocks.getLatestDraft.mockResolvedValue(sourceDraft);
    mocks.runFix.mockResolvedValue({
      fixResult: { revisedContent: candidateDraft.content, fixedIssueKeys: ['issue-key-a'] },
      fixRun: {
        id: 'fix-run-a', status: 'success', beforeScore: 60, beforePendingCount: 1,
        beforeSeriousCount: 0, fixedIssueIds: [], newIssueIds: [],
      },
      scopeValidation: { passed: true, warnings: [] },
    });
    mocks.createDraft.mockResolvedValue(candidateDraft);
    mocks.runQualityCheck.mockResolvedValue({ overallScore: 90, summary: 'Better', items: [] });
    mocks.compareFix.mockReturnValue({
      isBetter: true, isWorse: false, beforeScore: 60, afterScore: 90,
      beforePendingCount: 1, afterPendingCount: 0, beforeSeriousCount: 0,
      afterSeriousCount: 0, fixedIssueCount: 1,
    });
    mocks.createQualityReport.mockResolvedValue({ ...report, id: 'report-after', draftId: 'draft-candidate' });
    mocks.saveQualityResult.mockResolvedValue({
      report: { ...report, id: 'report-after', draftId: 'draft-candidate' }, items: [],
      statistics: { total: 0, pending: 0, resolved: 0, ignored: 0, critical: 0, high: 0, medium: 0, low: 0 },
    });
    mocks.saveFixRun.mockResolvedValue(undefined);
    mocks.getContextRecords.mockResolvedValue([]);

    const onGenerated = vi.fn();
    render(
      <CheckPanel
        novelId="novel-a"
        chapter={chapter('chapter-a')}
        qcReport={report}
        qcItems={[issue]}
        currentEditorContent={sourceDraft.content}
        currentEditorWordCount={20}
        currentEditorDirty={false}
        currentContentHash="hash-source"
        currentDraftId="draft-source"
        currentDraftVersion={3}
        onGenerated={onGenerated}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /AI 修复并复检/ }));
    const confirm = await screen.findByRole('button', { name: /确认采用/ });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));

    expect(mocks.adoptExact).not.toHaveBeenCalled();
    expect(mocks.adoptFixRun).not.toHaveBeenCalled();
    expect(mocks.updateIssueStatus).not.toHaveBeenCalled();
    expect(mocks.markSummaryExpired).not.toHaveBeenCalled();
    expect(mocks.updateContextRecord).not.toHaveBeenCalled();
    expect(onGenerated).not.toHaveBeenCalled();
  });
});
