import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CheckPanel from '../../components/right-dock/panels/CheckPanel';
import { CheckPanelView } from '../../components/right-dock/panels/CheckPanelView';
import { qualityCheckAiService } from '../../services/ai/qualityCheckAiService';
import { aiSettingsService } from '../../services/ai/aiClient';
import { draftVersionService } from '../../services/database/draftVersionService';
import { computeStatistics, qualityCheckService } from '../../services/quality/qualityCheckService';
import type { AiSettings, ChapterDraft } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type { QualityCheckItem, QualityCheckReport } from '../../types/qualityCheck';

const timestamp = '2026-07-28T00:00:00.000Z';
const content = Array.from({ length: 360 }, (_, index) => `正文${index}`).join('，');
const chapter: Chapter = {
  id: 'chapter-1',
  novelId: 'novel-1',
  volumeId: 'volume-1',
  title: '第一章',
  outline: '主角发现线索',
  goal: '推进调查',
  chapterNumber: 1,
  orderIndex: 1,
  sortOrder: 1,
  status: 'editing',
  wordCount: 360,
  currentWords: 360,
  targetWords: 2_400,
  drafts: [],
  createdAt: timestamp,
  updatedAt: timestamp,
};
const draft: ChapterDraft = {
  id: 'draft-1',
  novelId: 'novel-1',
  chapterId: 'chapter-1',
  content,
  source: 'user_edited',
  versionNo: 1,
  wordCount: 360,
  isAdopted: false,
  createdAt: timestamp,
  updatedAt: timestamp,
};
const report: QualityCheckReport = {
  id: 'report-1',
  novelId: 'novel-1',
  chapterId: 'chapter-1',
  draftId: 'draft-1',
  scope: 'current_draft',
  status: 'completed',
  overallScore: 72,
  summary: '存在若干可修复问题。',
  draftVersion: 1,
  contentHash: 'content-hash',
  contentLength: content.length,
  checkedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
};

function item(
  id: string,
  status: QualityCheckItem['status'],
  severity: QualityCheckItem['severity'],
): QualityCheckItem {
  return {
    id,
    reportId: report.id,
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    draftId: 'draft-1',
    issueType: 'logic',
    severity,
    title: `问题 ${id}`,
    description: '前后逻辑需要补充。',
    category: '逻辑',
    evidence: '原文证据',
    quote: '引用片段',
    suggestion: '补充因果关系',
    startOffset: 3,
    endOffset: 8,
    paragraphIndex: 1,
    issueKey: `key-${id}`,
    status,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const items = [
  item('pending-critical', 'pending', 'critical'),
  item('resolved-high', 'resolved', 'high'),
  item('ignored-medium', 'ignored', 'medium'),
  item('pending-low', 'pending', 'low'),
];

const settings: AiSettings = {
  runtimeMode: 'api',
  provider: 'openai_compatible',
  baseUrl: 'https://fixture.invalid',
  apiKey: '',
  modelName: '',
  mockMode: false,
};

beforeEach(() => {
  vi.spyOn(aiSettingsService, 'getSettings').mockReturnValue(settings);
});

describe('CheckPanelView', () => {
  it('renders full report state and dispatches every quality workflow action', () => {
    const callbacks = {
      onRunCheck: vi.fn(),
      onStopOperation: vi.fn(),
      onAiFix: vi.fn(),
      onHistoryChange: vi.fn(),
      onFilterChange: vi.fn(),
      onLocate: vi.fn(),
      onStatusChange: vi.fn(),
      onRevertFix: vi.fn(),
      onConfirmFix: vi.fn(),
    };
    const props: React.ComponentProps<typeof CheckPanelView> = {
      chapter,
      aiSettings: settings,
      currentDraft: draft,
      loading: false,
      operationPhase: 'idle',
      activeReport: report,
      viewingHistory: false,
      statistics: computeStatistics(items),
      fixLoading: false,
      fixStage: '修复完成',
      fixProgress: 75,
      fixError: '修复提示',
      error: '检查提示',
      historyReports: [report, { ...report, id: 'report-old', overallScore: undefined }],
      selectedReportId: report.id,
      historyLoading: false,
      reportOutdated: true,
      fixComparison: {
        beforeScore: 60,
        afterScore: 86,
        beforeTotalIssues: 4,
        afterTotalIssues: 2,
        beforePendingCount: 4,
        afterPendingCount: 1,
        beforeSeriousCount: 2,
        afterSeriousCount: 0,
        beforeHighCount: 1,
        afterHighCount: 0,
        newIssueCount: 1,
        fixedIssueCount: 3,
        isBetter: true,
        isWorse: false,
        summary: '质量提升',
      },
      fixScopeValidation: {
        passed: true,
        riskLevel: 'low',
        changedParagraphCount: 2,
        totalParagraphCount: 10,
        unrelatedChangedCount: 0,
        warnings: ['检查提示'],
      },
      activeItems: items,
      filter: 'all',
      locateMessage: '定位提示',
      filteredItems: items,
      ...callbacks,
    };
    const view = render(<CheckPanelView {...props} />);

    fireEvent.click(screen.getByTestId('quality-check-run'));
    fireEvent.click(screen.getByTestId('quality-fix-run'));
    view.rerender(<CheckPanelView {...props} operationPhase="available" />);
    fireEvent.click(screen.getByTestId('quality-operation-stop'));
    fireEvent.change(screen.getByTestId('quality-history-select'), {
      target: { value: 'report-old' },
    });
    screen.getAllByRole('button', { name: /定位/ }).forEach((button) => fireEvent.click(button));
    fireEvent.click(screen.getAllByTestId('quality-issue-resolve')[0]);
    fireEvent.click(screen.getAllByTestId('quality-issue-ignore')[0]);
    screen.getAllByTestId('quality-issue-reopen').forEach((button) => fireEvent.click(button));
    fireEvent.click(screen.getByRole('button', { name: /回退原版本/ }));
    fireEvent.click(screen.getByRole('button', { name: /确认采用/ }));
    ['全部', '待处理', '已处理', '已忽略'].forEach((label) => {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}（`) }));
    });

    expect(callbacks.onRunCheck).toHaveBeenCalledOnce();
    expect(callbacks.onStopOperation).toHaveBeenCalledOnce();
    expect(callbacks.onAiFix).toHaveBeenCalledOnce();
    expect(callbacks.onHistoryChange).toHaveBeenCalledWith('report-old');
    expect(callbacks.onLocate).toHaveBeenCalledTimes(4);
    expect(callbacks.onStatusChange).toHaveBeenCalled();
    expect(callbacks.onRevertFix).toHaveBeenCalledOnce();
    expect(callbacks.onConfirmFix).toHaveBeenCalledOnce();

    view.rerender(
      <CheckPanelView
        {...props}
        aiSettings={{ ...settings, runtimeMode: 'mock', mockMode: true }}
        operationPhase="committing"
        viewingHistory
        fixComparison={{ ...props.fixComparison!, isBetter: false, isWorse: true }}
        fixScopeValidation={{ ...props.fixScopeValidation!, passed: false, warnings: [] }}
        filter="resolved"
        filteredItems={[]}
      />,
    );
    expect(screen.getByTestId('quality-history-readonly')).not.toBeNull();
    expect(screen.getByText('当前筛选条件下没有匹配的问题')).not.toBeNull();
  });

  it('renders loading, cancelling and empty report branches', () => {
    const noop = vi.fn();
    const base: React.ComponentProps<typeof CheckPanelView> = {
      chapter,
      aiSettings: { ...settings, apiKey: 'fixture', modelName: 'fixture-model' },
      currentDraft: null,
      loading: true,
      operationPhase: 'cancelling',
      activeReport: null,
      viewingHistory: false,
      statistics: computeStatistics([]),
      fixLoading: true,
      fixStage: '',
      fixProgress: 25,
      fixError: '',
      error: '',
      historyReports: [],
      selectedReportId: '',
      historyLoading: true,
      reportOutdated: false,
      fixComparison: null,
      fixScopeValidation: null,
      activeItems: [],
      filter: 'all',
      locateMessage: '',
      filteredItems: [],
      onRunCheck: noop,
      onStopOperation: noop,
      onAiFix: noop,
      onHistoryChange: noop,
      onFilterChange: noop,
      onLocate: noop,
      onStatusChange: noop,
      onRevertFix: noop,
      onConfirmFix: noop,
    };
    const view = render(<CheckPanelView {...base} />);
    expect(screen.getByText(/检查中/)).not.toBeNull();
    expect(screen.getByText('正在停止...')).not.toBeNull();
    view.rerender(<CheckPanelView {...base} loading={false} operationPhase="idle" />);
    expect(screen.getByText('点击上方按钮对当前草稿进行质量检查')).not.toBeNull();
  });
});

describe('CheckPanel controller', () => {
  it('persists a successful check, changes status, locates text and loads history', async () => {
    const savedItem = item('saved-issue', 'pending', 'high');
    const oldReport = { ...report, id: 'report-old', checkedAt: '2026-07-27T00:00:00.000Z' };
    vi.spyOn(draftVersionService, 'getLatestByChapterId').mockResolvedValue(draft);
    vi.spyOn(qualityCheckService, 'getChapterIssues').mockResolvedValue({
      report,
      items,
      statistics: computeStatistics(items),
    });
    vi.spyOn(qualityCheckService, 'listReports')
      .mockResolvedValueOnce([report, oldReport])
      .mockResolvedValue([report, oldReport]);
    vi.spyOn(qualityCheckService, 'getReportSnapshot').mockResolvedValue({
      report: oldReport,
      items: [savedItem],
      statistics: computeStatistics([savedItem]),
    });
    vi.spyOn(qualityCheckService, 'createReport').mockResolvedValue({
      ...report,
      status: 'pending',
    });
    vi.spyOn(qualityCheckService, 'saveResult').mockResolvedValue({
      report,
      items: [savedItem],
      statistics: computeStatistics([savedItem]),
    });
    vi.spyOn(qualityCheckAiService, 'runCheck').mockImplementation(async (_input, _options) => ({
      overallScore: 72,
      summary: '检查完成',
      aiTaskId: 'quality-task-1',
      items: [
        {
          issueType: 'logic',
          severity: 'high',
          title: '逻辑问题',
          description: '需要补充因果。',
        },
      ],
    }));
    const updateStatus = vi.spyOn(qualityCheckService, 'updateIssueStatus').mockResolvedValue(null);
    const onQcChange = vi.fn();
    const onLocateText = vi.fn();
    const hideAiModal = vi.fn();

    render(
      <CheckPanel
        novelId="novel-1"
        chapter={chapter}
        currentEditorContent={content}
        currentEditorWordCount={360}
        currentEditorDirty={false}
        currentContentHash="content-hash"
        currentDraftId="draft-1"
        currentDraftVersion={1}
        onQcChange={onQcChange}
        onLocateText={onLocateText}
        showAiModal={vi.fn()}
        updateAiModal={vi.fn()}
        hideAiModal={hideAiModal}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('quality-history-select')).not.toBeNull());
    fireEvent.change(screen.getByTestId('quality-history-select'), {
      target: { value: 'report-old' },
    });
    await waitFor(() =>
      expect(qualityCheckService.getReportSnapshot).toHaveBeenCalledWith('report-old'),
    );
    fireEvent.change(screen.getByTestId('quality-history-select'), {
      target: { value: 'report-1' },
    });
    await waitFor(() => expect(qualityCheckService.getChapterIssues).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByTestId('quality-check-run'));
    await waitFor(() => expect(qualityCheckService.saveResult).toHaveBeenCalledTimes(1), {
      timeout: 2_000,
    });
    await waitFor(() => expect(screen.queryByTestId('quality-operation-stop')).toBeNull(), {
      timeout: 2_000,
    });
    const issue = await screen.findByTestId('quality-issue-resolve');
    fireEvent.click(issue);
    await waitFor(() => expect(updateStatus).toHaveBeenCalledWith('saved-issue', 'resolved'));
    fireEvent.click(screen.getByRole('button', { name: /定位/ }));
    expect(onLocateText).toHaveBeenCalledWith(3, 8, '引用片段', 1);
    expect(onQcChange).toHaveBeenCalled();
    expect(hideAiModal).toHaveBeenCalled();
  });

  it('rejects short content, handles missing locate support and no selected chapter', async () => {
    vi.spyOn(draftVersionService, 'getLatestByChapterId').mockResolvedValue(draft);
    vi.spyOn(qualityCheckService, 'getChapterIssues').mockResolvedValue({
      report,
      items: [items[0]],
      statistics: computeStatistics([items[0]]),
    });
    vi.spyOn(qualityCheckService, 'listReports').mockResolvedValue([report]);
    const view = render(
      <CheckPanel
        novelId="novel-1"
        chapter={chapter}
        currentEditorContent="短文"
        currentEditorWordCount={2}
      />,
    );
    await screen.findByTestId('quality-issue');
    fireEvent.click(screen.getByTestId('quality-check-run'));
    expect(await screen.findByText('正文过短，请先生成或编辑正文')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /定位/ }));
    expect(await screen.findByText('定位功能需要正文编辑器支持')).not.toBeNull();

    view.rerender(<CheckPanel novelId="novel-1" />);
    expect(screen.getByText('请先选择章节')).not.toBeNull();
  });
});
