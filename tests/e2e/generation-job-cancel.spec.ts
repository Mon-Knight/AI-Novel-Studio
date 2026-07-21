import { browser, expect } from '@wdio/globals';
import { E2E_FIXTURES } from './fixtures/data';
import {
  assertCleanDiagnostics,
  bridgeCall,
  callMockGate,
  clickTestId,
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  findTestIdByAttribute,
  goHome,
  openWorkspace,
  waitForTestId,
} from './helpers';

interface GenerationJobView {
  id: string;
  novelId: string;
  chapterId: string;
  status: string;
  currentStep?: string;
  progressPercent: number;
  errorCode?: string;
  finishedAt?: string;
}

interface GenerationStepView {
  id: string;
  jobId: string;
  stepName: string;
  status: string;
}

interface ChapterDraftView {
  id: string;
  chapterId: string;
  source: string;
  aiTaskId?: string;
}

interface AiTaskView {
  id: string;
  novelId?: string;
  chapterId?: string;
  taskType: string;
  status: string;
  finishedAt?: string;
}

interface QualityIssuesView {
  report: { id: string; status: string } | null;
  items: unknown[];
}

async function getJobs(chapterId: string): Promise<GenerationJobView[]> {
  return bridgeCall<GenerationJobView[]>('get_generation_jobs_by_chapter_id', { chapterId });
}

async function getSteps(jobId: string): Promise<GenerationStepView[]> {
  return bridgeCall<GenerationStepView[]>('get_generation_step_results', { jobId });
}

async function getDrafts(chapterId: string): Promise<ChapterDraftView[]> {
  return bridgeCall<ChapterDraftView[]>('get_drafts_by_chapter_id', { chapterId });
}

describe('generation job request cancellation', () => {
  it('aborts the paused request and prevents late generation side effects', async () => {
    const fixture = E2E_FIXTURES.generationCancel;
    const projectId = await createProjectThroughUi(fixture.projectTitle);
    await openWorkspace(projectId);
    const volumeId = await createVolumeThroughUi(fixture.volumeTitle);
    const chapterId = await createChapterThroughUi(fixture.chapterTitle, volumeId);

    const initialDrafts = await getDrafts(chapterId);
    expect(initialDrafts).toHaveLength(1);
    expect(initialDrafts[0]).toMatchObject({
      chapterId,
      source: 'manual_placeholder',
    });
    expect(initialDrafts[0].aiTaskId).toBeFalsy();
    await clickTestId('chapter-engineering');
    await waitForTestId('engineering-panel');
    await clickTestId('engineering-tab-jobs');
    await waitForTestId('generation-job-start');

    let gateReleased = false;
    try {
      expect(await callMockGate('pauseMockAi')).toEqual({
        paused: true,
        waitingRequests: 0,
        requestCount: 0,
      });
      await clickTestId('generation-job-start');

      await browser.waitUntil(async () => {
        const [gate, jobs] = await Promise.all([
          callMockGate('getMockAiGateState'),
          getJobs(chapterId),
        ]);
        const latest = jobs[0];
        return gate.paused
          && gate.waitingRequests === 1
          && gate.requestCount === 1
          && latest?.status === 'running'
          && latest.currentStep === 'draft_generation'
          && latest.progressPercent === 72;
      }, {
        timeout: 30000,
        timeoutMsg: 'generation job did not reach the paused draft_generation request',
      });

      const jobsBeforeCancel = await getJobs(chapterId);
      expect(jobsBeforeCancel).toHaveLength(1);
      const runningJob = jobsBeforeCancel[0];
      expect(runningJob).toMatchObject({
        novelId: projectId,
        chapterId,
        status: 'running',
        currentStep: 'draft_generation',
        progressPercent: 72,
      });
      expect(runningJob.finishedAt).toBeFalsy();

      const runningStatus = await findTestIdByAttribute(
        'generation-job-status',
        'data-job-id',
        runningJob.id,
      );
      expect(await runningStatus.getAttribute('data-job-status')).toBe('running');
      expect(await (await waitForTestId('generation-job-cancel')).isEnabled()).toBe(true);

      await clickTestId('generation-job-cancel');
      await browser.waitUntil(async () => {
        const [gate, jobs] = await Promise.all([
          callMockGate('getMockAiGateState'),
          getJobs(chapterId),
        ]);
        const latest = jobs[0];
        return gate.paused
          && gate.waitingRequests === 0
          && gate.requestCount === 1
          && latest?.id === runningJob.id
          && latest.status === 'cancelled'
          && Boolean(latest.finishedAt);
      }, {
        timeout: 5000,
        interval: 50,
        timeoutMsg: 'generation request did not abort and persist cancellation within 5 seconds',
      });

      const jobsAfterCancel = await getJobs(chapterId);
      expect(jobsAfterCancel).toHaveLength(1);
      const cancelledJob = jobsAfterCancel[0];
      expect(cancelledJob).toMatchObject({
        id: runningJob.id,
        novelId: projectId,
        chapterId,
        status: 'cancelled',
        currentStep: 'draft_generation',
        progressPercent: 72,
      });
      expect(cancelledJob.finishedAt).toBeTruthy();
      expect(cancelledJob.errorCode).toBeFalsy();

      const cancelledStatus = await findTestIdByAttribute(
        'generation-job-status',
        'data-job-id',
        cancelledJob.id,
      );
      expect(await cancelledStatus.getAttribute('data-job-status')).toBe('cancelled');
      expect(await (await waitForTestId('generation-job-cancel')).isEnabled()).toBe(false);
      const startButton = await waitForTestId('generation-job-start');
      await browser.waitUntil(() => startButton.isEnabled(), {
        timeout: 5000,
        interval: 50,
        timeoutMsg: 'generation start button did not recover after cancellation',
      });

      const stepsAfterCancel = await getSteps(cancelledJob.id);
      expect(stepsAfterCancel).toHaveLength(3);
      expect(stepsAfterCancel.filter((step) => (
        step.stepName === 'preflight' && step.status === 'succeeded'
      ))).toHaveLength(1);
      expect(stepsAfterCancel.filter((step) => (
        step.stepName === 'compile_context' && step.status === 'succeeded'
      ))).toHaveLength(1);
      const cancelledSteps = stepsAfterCancel.filter((step) => step.status === 'cancelled');
      expect(cancelledSteps).toHaveLength(1);
      expect(cancelledSteps[0]).toMatchObject({
        jobId: cancelledJob.id,
        stepName: 'draft_generation',
      });
      expect(stepsAfterCancel.filter((step) => step.status === 'failed')).toEqual([]);
      expect(stepsAfterCancel.filter((step) => (
        step.status === 'succeeded'
        && ['draft_generation', 'save_version', 'quality_check', 'patch_generation', 'patch_apply']
          .includes(step.stepName)
      ))).toEqual([]);

      const draftsAfterCancel = await getDrafts(chapterId);
      expect(draftsAfterCancel).toEqual(initialDrafts);
      expect(draftsAfterCancel.filter((draft) => draft.aiTaskId === cancelledJob.id)).toEqual([]);
      expect(await callMockGate('getMockAiGateState')).toEqual({
        paused: true,
        waitingRequests: 0,
        requestCount: 1,
      });

      const releaseState = await callMockGate('releaseMockAi');
      gateReleased = true;
      expect(releaseState).toEqual({
        paused: false,
        waitingRequests: 0,
        requestCount: 1,
      });

      const stableUntil = Date.now() + 500;
      await browser.waitUntil(async () => {
        const [jobs, steps, drafts, gate] = await Promise.all([
          getJobs(chapterId),
          getSteps(cancelledJob.id),
          getDrafts(chapterId),
          callMockGate('getMockAiGateState'),
        ]);
        expect(jobs).toEqual(jobsAfterCancel);
        expect(steps).toEqual(stepsAfterCancel);
        expect(drafts).toEqual(draftsAfterCancel);
        expect(gate).toEqual(releaseState);
        return Date.now() >= stableUntil;
      }, {
        timeout: 2000,
        interval: 50,
        timeoutMsg: 'cancelled generation state did not remain stable after releasing the Mock AI gate',
      });

      await assertCleanDiagnostics();
    } finally {
      if (!gateReleased) {
        try {
          await callMockGate('releaseMockAi');
        } catch {
          // The runner still owns and cleans the application process if the session has already failed.
        }
      }
    }
  });

  it('cancels the paused quality request without removing its committed draft', async () => {
    const fixture = E2E_FIXTURES.generationCancel;
    await goHome();
    const projectId = await createProjectThroughUi(`${fixture.projectTitle} Quality`);
    await openWorkspace(projectId);
    const volumeId = await createVolumeThroughUi(`${fixture.volumeTitle} Quality`);
    const chapterId = await createChapterThroughUi(`${fixture.chapterTitle} Quality`, volumeId);
    const initialDrafts = await getDrafts(chapterId);
    const baselineGate = await callMockGate('getMockAiGateState');

    await clickTestId('chapter-engineering');
    await waitForTestId('engineering-panel');
    await clickTestId('engineering-tab-jobs');
    await waitForTestId('generation-job-start');

    let gateReleased = false;
    try {
      expect(await callMockGate('pauseMockAi')).toEqual({
        paused: true,
        waitingRequests: 0,
        requestCount: baselineGate.requestCount,
      });
      await clickTestId('generation-job-start');

      await browser.waitUntil(async () => {
        const [gate, jobs] = await Promise.all([
          callMockGate('getMockAiGateState'),
          getJobs(chapterId),
        ]);
        const latest = jobs[0];
        return gate.paused
          && gate.waitingRequests === 1
          && gate.requestCount === baselineGate.requestCount + 1
          && latest?.status === 'running'
          && latest.currentStep === 'draft_generation';
      }, {
        timeout: 30000,
        timeoutMsg: 'generation job did not reach the first paused request',
      });

      expect(await callMockGate('advanceMockAi')).toEqual({
        paused: true,
        waitingRequests: 0,
        requestCount: baselineGate.requestCount + 1,
      });

      await browser.waitUntil(async () => {
        const [gate, jobs, drafts, tasks] = await Promise.all([
          callMockGate('getMockAiGateState'),
          getJobs(chapterId),
          getDrafts(chapterId),
          bridgeCall<AiTaskView[]>('get_ai_task_records_by_chapter_id', { chapterId }),
        ]);
        const latest = jobs[0];
        const qualityTasks = tasks.filter((task) => task.taskType === 'quality_check');
        return gate.paused
          && gate.waitingRequests === 1
          && gate.requestCount === baselineGate.requestCount + 2
          && latest?.status === 'running'
          && latest.currentStep === 'quality_check'
          && latest.progressPercent === 99
          && drafts.length === initialDrafts.length + 1
          && qualityTasks.length === 1
          && qualityTasks[0].status === 'running';
      }, {
        timeout: 30000,
        timeoutMsg: 'generation job did not reach the paused quality_check request',
      });

      const runningJob = (await getJobs(chapterId))[0];
      const draftsAtQuality = await getDrafts(chapterId);
      const initialDraftIds = new Set(initialDrafts.map((draft) => draft.id));
      const generatedDrafts = draftsAtQuality.filter((draft) => (
        !initialDraftIds.has(draft.id) && draft.source === 'ai_generated'
      ));
      expect(generatedDrafts).toHaveLength(1);
      expect(generatedDrafts[0]).toMatchObject({
        chapterId,
        source: 'ai_generated',
      });
      expect(await bridgeCall<QualityIssuesView>('get_quality_check_issues', { chapterId }))
        .toMatchObject({ report: null, items: [] });

      await clickTestId('generation-job-cancel');
      await browser.waitUntil(async () => {
        const [gate, jobs, tasks] = await Promise.all([
          callMockGate('getMockAiGateState'),
          getJobs(chapterId),
          bridgeCall<AiTaskView[]>('get_ai_task_records_by_chapter_id', { chapterId }),
        ]);
        const qualityTask = tasks.find((task) => task.taskType === 'quality_check');
        return gate.paused
          && gate.waitingRequests === 0
          && gate.requestCount === baselineGate.requestCount + 2
          && jobs[0]?.id === runningJob.id
          && jobs[0].status === 'cancelled'
          && Boolean(jobs[0].finishedAt)
          && qualityTask?.status === 'cancelled'
          && Boolean(qualityTask.finishedAt);
      }, {
        timeout: 5000,
        interval: 50,
        timeoutMsg: 'quality request did not abort and persist cancellation within 5 seconds',
      });

      const cancelledJob = (await getJobs(chapterId))[0];
      expect(cancelledJob).toMatchObject({
        id: runningJob.id,
        novelId: projectId,
        chapterId,
        status: 'cancelled',
        currentStep: 'quality_check',
        progressPercent: 99,
      });
      const stepsAfterCancel = await getSteps(cancelledJob.id);
      expect(stepsAfterCancel.filter((step) => step.status === 'cancelled')).toEqual([
        expect.objectContaining({
          jobId: cancelledJob.id,
          stepName: 'quality_check',
        }),
      ]);
      expect(stepsAfterCancel.filter((step) => (
        step.stepName === 'quality_check' && step.status === 'succeeded'
      ))).toEqual([]);
      expect(stepsAfterCancel.filter((step) => step.status === 'failed')).toEqual([]);
      expect(await getDrafts(chapterId)).toEqual(draftsAtQuality);

      const qualityTasks = (await bridgeCall<AiTaskView[]>(
        'get_ai_task_records_by_chapter_id',
        { chapterId },
      )).filter((task) => task.taskType === 'quality_check');
      expect(qualityTasks).toHaveLength(1);
      expect(qualityTasks[0]).toMatchObject({
        novelId: projectId,
        chapterId,
        status: 'cancelled',
      });
      expect(qualityTasks[0].finishedAt).toBeTruthy();
      expect(await bridgeCall<QualityIssuesView>('get_quality_check_issues', { chapterId }))
        .toMatchObject({ report: null, items: [] });

      const releaseState = await callMockGate('releaseMockAi');
      gateReleased = true;
      expect(releaseState).toEqual({
        paused: false,
        waitingRequests: 0,
        requestCount: baselineGate.requestCount + 2,
      });

      const stableUntil = Date.now() + 500;
      await browser.waitUntil(async () => {
        const [jobs, steps, drafts, tasks, quality] = await Promise.all([
          getJobs(chapterId),
          getSteps(cancelledJob.id),
          getDrafts(chapterId),
          bridgeCall<AiTaskView[]>('get_ai_task_records_by_chapter_id', { chapterId }),
          bridgeCall<QualityIssuesView>('get_quality_check_issues', { chapterId }),
        ]);
        expect(jobs).toEqual([cancelledJob]);
        expect(steps).toEqual(stepsAfterCancel);
        expect(drafts).toEqual(draftsAtQuality);
        expect(tasks.filter((task) => task.taskType === 'quality_check')).toEqual(qualityTasks);
        expect(quality)
          .toMatchObject({ report: null, items: [] });
        return Date.now() >= stableUntil;
      }, {
        timeout: 2000,
        interval: 50,
        timeoutMsg: 'cancelled quality state did not remain stable after releasing the Mock AI gate',
      });

      await assertCleanDiagnostics();
    } finally {
      if (!gateReleased) {
        try {
          await callMockGate('releaseMockAi');
        } catch {
          // The runner still owns and cleans the application process if the session has already failed.
        }
      }
    }
  });
});
