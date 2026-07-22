import { browser, expect } from '@wdio/globals';
import { E2E_FIXTURES } from './fixtures/data';
import {
  assertCleanDiagnostics,
  bridgeCall,
  clickTestId,
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  findTestIdByAttribute,
  openWorkspace,
  waitForTestId,
  waitForTestIdAttribute,
  waitForTestIdMissing,
} from './helpers';

interface GenerationJobView {
  id: string;
  chapterId: string;
  status: string;
  currentStep?: string;
  progressPercent: number;
}

interface QualityReportView {
  id: string;
  novelId: string;
  chapterId: string;
  draftId: string;
  status: string;
  overallScore?: number;
  aiTaskId: string;
  contentHash?: string;
  contentLength?: number;
  checkedAt?: string;
  createdAt: string;
}

interface QualityItemView {
  id: string;
  reportId: string;
  chapterId: string;
  draftId: string;
  issueKey: string;
  severity: string;
  title: string;
  description: string;
  status: string;
  sortOrder: number;
}

interface QualitySnapshotView {
  report: QualityReportView | null;
  items: QualityItemView[];
  statistics: {
    total: number;
    pending: number;
    resolved: number;
    ignored: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

interface AiTaskView {
  id: string;
  taskType: string;
  status: string;
  novelId?: string;
  chapterId?: string;
}

async function getJobs(chapterId: string): Promise<GenerationJobView[]> {
  return bridgeCall<GenerationJobView[]>('get_generation_jobs_by_chapter_id', { chapterId });
}

async function getHistory(chapterId: string): Promise<QualityReportView[]> {
  return bridgeCall<QualityReportView[]>('list_quality_check_reports', { chapterId });
}

async function getSnapshot(reportId: string): Promise<QualitySnapshotView> {
  return bridgeCall<QualitySnapshotView>('get_quality_check_report_snapshot', { reportId });
}

async function runGenerationJob(chapterId: string, expectedCount: number): Promise<GenerationJobView> {
  const start = await waitForTestId('generation-job-start');
  await start.waitForEnabled({ timeout: 30000 });
  await start.click();
  await browser.waitUntil(async () => {
    const jobs = await getJobs(chapterId);
    return jobs.length === expectedCount
      && jobs[0]?.status === 'completed'
      && jobs[0]?.progressPercent === 100;
  }, {
    timeout: 120000,
    interval: 200,
    timeoutMsg: `generation job ${expectedCount} did not complete`,
  });
  return (await getJobs(chapterId))[0];
}

describe('quality history immutable replay', () => {
  it('preserves repeated issue snapshots and replays them after a real application restart', async () => {
    const fixture = E2E_FIXTURES.qualityHistory;
    const projectId = await createProjectThroughUi(fixture.projectTitle);
    await openWorkspace(projectId);
    const volumeId = await createVolumeThroughUi(fixture.volumeTitle);
    const chapterId = await createChapterThroughUi(fixture.chapterTitle, volumeId);

    await clickTestId('chapter-engineering');
    await waitForTestId('engineering-panel');
    await clickTestId('engineering-tab-jobs');
    await waitForTestId('generation-job-start');

    const firstJob = await runGenerationJob(chapterId, 1);
    expect(firstJob).toMatchObject({ chapterId, status: 'completed', progressPercent: 100 });
    const firstHistory = await getHistory(chapterId);
    expect(firstHistory).toHaveLength(1);
    const firstReport = firstHistory[0];
    expect(firstReport).toMatchObject({
      novelId: projectId,
      chapterId,
      status: 'completed',
      overallScore: 78,
    });
    expect(firstReport.aiTaskId).toBeTruthy();
    expect(firstReport.contentHash).toBeTruthy();
    expect(firstReport.contentLength).toBeGreaterThan(0);
    const firstSnapshotBefore = await getSnapshot(firstReport.id);
    expect(firstSnapshotBefore.report).toEqual(firstReport);
    expect(firstSnapshotBefore.items).toHaveLength(5);
    expect(firstSnapshotBefore.statistics.total).toBe(5);
    expect(firstSnapshotBefore.items.every((item) => item.reportId === firstReport.id)).toBe(true);
    expect(firstSnapshotBefore.items.map((item) => item.sortOrder)).toEqual([0, 1, 2, 3, 4]);

    const secondJob = await runGenerationJob(chapterId, 2);
    expect(secondJob.id).not.toBe(firstJob.id);
    const history = await getHistory(chapterId);
    expect(history).toHaveLength(2);
    const secondReport = history[0];
    expect(secondReport.id).not.toBe(firstReport.id);
    expect(secondReport).toMatchObject({
      novelId: projectId,
      chapterId,
      status: 'completed',
      overallScore: 78,
    });
    expect(secondReport.aiTaskId).toBeTruthy();
    expect(secondReport.aiTaskId).not.toBe(firstReport.aiTaskId);

    const [firstSnapshotAfter, secondSnapshot, current, tasks] = await Promise.all([
      getSnapshot(firstReport.id),
      getSnapshot(secondReport.id),
      bridgeCall<QualitySnapshotView>('get_quality_check_issues', { chapterId }),
      bridgeCall<AiTaskView[]>('get_ai_task_records_by_chapter_id', { chapterId }),
    ]);
    expect(firstSnapshotAfter).toEqual(firstSnapshotBefore);
    expect(current.report?.id).toBe(secondReport.id);
    expect(current.statistics.total).toBe(firstSnapshotBefore.statistics.total);
    expect(secondSnapshot.items).toHaveLength(firstSnapshotBefore.items.length);
    expect(secondSnapshot.items.map((item) => item.issueKey)).toEqual(
      firstSnapshotBefore.items.map((item) => item.issueKey),
    );
    const firstItemIds = new Set(firstSnapshotBefore.items.map((item) => item.id));
    expect(secondSnapshot.items.some((item) => firstItemIds.has(item.id))).toBe(false);
    expect(secondSnapshot.items.every((item) => item.reportId === secondReport.id)).toBe(true);
    expect(secondSnapshot.items.map((item) => item.sortOrder)).toEqual([0, 1, 2, 3, 4]);
    const qualityTasks = tasks.filter((task) => task.taskType === 'quality_check');
    expect(qualityTasks.filter((task) => task.status === 'succeeded')).toHaveLength(2);
    expect(qualityTasks.map((task) => task.id)).toContain(firstReport.aiTaskId);
    expect(qualityTasks.map((task) => task.id)).toContain(secondReport.aiTaskId);

    await clickTestId('quality-check');
    await waitForTestIdAttribute('quality-history', 'data-report-id', secondReport.id);
    const issueToResolve = secondSnapshot.items[0];
    const resolveIssue = await findTestIdByAttribute(
      'quality-issue-resolve',
      'data-issue-id',
      issueToResolve.id,
    );
    await resolveIssue.click();
    await waitForTestIdAttribute('quality-issue', 'data-status', 'resolved');
    await browser.waitUntil(async () => {
      const latest = await bridgeCall<QualitySnapshotView>('get_quality_check_issues', { chapterId });
      return latest.statistics.resolved === 1
        && latest.items.find((item) => item.id === issueToResolve.id)?.status === 'resolved';
    }, {
      timeout: 30000,
      interval: 100,
      timeoutMsg: 'quality issue workflow state was not committed',
    });

    const [currentAfterResolve, firstSnapshotAfterResolve, secondSnapshotAfterResolve] = await Promise.all([
      bridgeCall<QualitySnapshotView>('get_quality_check_issues', { chapterId }),
      getSnapshot(firstReport.id),
      getSnapshot(secondReport.id),
    ]);
    expect(currentAfterResolve.report?.id).toBe(secondReport.id);
    expect(currentAfterResolve.statistics.resolved).toBe(1);
    expect(currentAfterResolve.statistics.pending).toBe(currentAfterResolve.statistics.total - 1);
    expect(currentAfterResolve.items.find((item) => item.id === issueToResolve.id)?.status).toBe('resolved');
    expect(firstSnapshotAfterResolve).toEqual(firstSnapshotBefore);
    expect(secondSnapshotAfterResolve).toEqual(secondSnapshot);

    await assertCleanDiagnostics();
    await browser.reloadSession();
    await waitForTestId('app-shell');
    await waitForTestIdMissing('recovery-dialog', 5000);
    await openWorkspace(projectId);
    const chapterItem = await findTestIdByAttribute('chapter-item', 'data-chapter-id', chapterId);
    await chapterItem.click();
    await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);
    await clickTestId('quality-check');
    const historyPanel = await waitForTestIdAttribute(
      'quality-history',
      'data-report-id',
      secondReport.id,
    );
    expect(await historyPanel.getAttribute('data-history-mode')).toBe('current');
    const currentIssue = await findTestIdByAttribute(
      'quality-issue',
      'data-issue-id',
      issueToResolve.id,
    );
    expect(await currentIssue.getAttribute('data-status')).toBe('resolved');

    const historySelect = await waitForTestId('quality-history-select');
    await historySelect.selectByAttribute('value', firstReport.id);
    const historicalPanel = await waitForTestIdAttribute(
      'quality-history',
      'data-report-id',
      firstReport.id,
    );
    expect(await historicalPanel.getAttribute('data-history-mode')).toBe('snapshot');
    await waitForTestId('quality-history-readonly');
    await waitForTestIdAttribute('quality-report', 'data-report-id', firstReport.id);
    const visibleIssues = await browser.$$('[data-testid="quality-issue"]');
    expect(visibleIssues).toHaveLength(firstSnapshotBefore.items.length);
    const historicalIssue = await findTestIdByAttribute(
      'quality-issue',
      'data-issue-id',
      firstSnapshotBefore.items[0].id,
    );
    expect(await historicalIssue.getAttribute('data-status')).toBe('pending');
    expect(await browser.$$('[data-testid="quality-issue-resolve"]')).toHaveLength(0);
    expect(await getSnapshot(firstReport.id)).toEqual(firstSnapshotBefore);
    await assertCleanDiagnostics();
  });
});
