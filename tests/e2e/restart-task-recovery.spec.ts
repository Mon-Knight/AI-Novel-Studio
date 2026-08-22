import { browser, expect } from '@wdio/globals';
import {
  assertCleanDiagnostics,
  bridgeCall,
  callMockGate,
  clickTestId,
  createFirstChapterThroughUi,
  createProjectThroughUi,
  findTestIdByAttribute,
  openWorkspace,
  waitForTestId,
  waitForTestIdAttribute,
  waitForTestIdMissing,
} from './helpers';

const RESTART_ERROR_CODE = 'APP_RESTART_INTERRUPTED';

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
  outputJson?: string;
  createdAt: string;
}

async function getJobs(chapterId: string): Promise<GenerationJobView[]> {
  return bridgeCall<GenerationJobView[]>('get_generation_jobs_by_chapter_id', { chapterId });
}

async function getSteps(jobId: string): Promise<GenerationStepView[]> {
  return bridgeCall<GenerationStepView[]>('get_generation_step_results', { jobId });
}

function parseStepOutput(step: GenerationStepView): Record<string, unknown> | undefined {
  if (!step.outputJson) return undefined;
  const parsed = JSON.parse(step.outputJson) as unknown;
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
}

function recoverySteps(steps: GenerationStepView[]): GenerationStepView[] {
  return steps.filter(
    (step) =>
      step.status === 'failed' && parseStepOutput(step)?.recoveryReason === RESTART_ERROR_CODE,
  );
}

describe('generation task restart recovery', () => {
  it('settles an interrupted persisted job once without replaying Mock AI', async () => {
    const projectId = await createProjectThroughUi();
    await openWorkspace(projectId);
    const chapterId = await createFirstChapterThroughUi();

    await clickTestId('chapter-engineering');
    await waitForTestId('engineering-panel');
    await clickTestId('engineering-tab-jobs');
    await waitForTestId('generation-job-start');

    expect(await callMockGate('pauseMockAi')).toEqual({
      paused: true,
      waitingRequests: 0,
      requestCount: 0,
    });
    await clickTestId('generation-job-start');

    await browser.waitUntil(
      async () => {
        const [gate, jobs] = await Promise.all([
          callMockGate('getMockAiGateState'),
          getJobs(chapterId),
        ]);
        const latest = jobs[0];
        return (
          gate.paused &&
          gate.waitingRequests === 1 &&
          gate.requestCount === 1 &&
          latest?.status === 'running' &&
          latest.currentStep === 'draft_generation'
        );
      },
      {
        timeout: 30000,
        timeoutMsg: 'generation job did not reach the paused draft_generation checkpoint',
      },
    );

    const jobsBeforeRestart = await getJobs(chapterId);
    expect(jobsBeforeRestart).toHaveLength(1);
    const jobBeforeRestart = jobsBeforeRestart[0];
    expect(jobBeforeRestart.novelId).toBe(projectId);
    expect(jobBeforeRestart.chapterId).toBe(chapterId);
    expect(jobBeforeRestart.status).toBe('running');
    expect(jobBeforeRestart.currentStep).toBe('draft_generation');
    expect(jobBeforeRestart.progressPercent).toBe(72);
    expect(jobBeforeRestart.finishedAt).toBeFalsy();

    const statusBeforeRestart = await waitForTestIdAttribute(
      'generation-job-status',
      'data-job-status',
      'running',
    );
    expect(await statusBeforeRestart.getAttribute('data-job-id')).toBe(jobBeforeRestart.id);

    const stepsBeforeRestart = await getSteps(jobBeforeRestart.id);
    const completedStepIds = stepsBeforeRestart
      .filter((step) => step.status === 'succeeded')
      .map((step) => step.id)
      .sort();
    expect(stepsBeforeRestart.map((step) => [step.stepName, step.status])).toEqual([
      ['preflight', 'succeeded'],
      ['compile_context', 'succeeded'],
    ]);
    expect(recoverySteps(stepsBeforeRestart)).toHaveLength(0);
    await assertCleanDiagnostics();

    await browser.reloadSession();
    await waitForTestId('app-shell');
    const recoveryDialog = await waitForTestId('recovery-dialog');
    expect(await recoveryDialog.getAttribute('data-recovered-jobs')).toBe('1');
    expect(await recoveryDialog.getAttribute('data-recovery-status')).toBe('recovered');

    const jobsAfterRecovery = await getJobs(chapterId);
    expect(jobsAfterRecovery).toHaveLength(1);
    const recoveredJob = jobsAfterRecovery[0];
    expect(recoveredJob.id).toBe(jobBeforeRestart.id);
    expect(recoveredJob.status).toBe('failed');
    expect(recoveredJob.errorCode).toBe(RESTART_ERROR_CODE);
    expect(recoveredJob.currentStep).toBe(jobBeforeRestart.currentStep);
    expect(recoveredJob.progressPercent).toBe(jobBeforeRestart.progressPercent);
    expect(recoveredJob.finishedAt).toBeTruthy();

    const stepsAfterRecovery = await getSteps(recoveredJob.id);
    expect(stepsAfterRecovery).toHaveLength(stepsBeforeRestart.length + 1);
    expect(
      stepsAfterRecovery
        .filter((step) => completedStepIds.includes(step.id))
        .map((step) => step.id)
        .sort(),
    ).toEqual(completedStepIds);
    const recoveredSteps = recoverySteps(stepsAfterRecovery);
    expect(recoveredSteps).toHaveLength(1);
    const recoveryStep = recoveredSteps[0];
    expect(recoveryStep.jobId).toBe(recoveredJob.id);
    expect(recoveryStep.stepName).toBe('draft_generation');
    expect(parseStepOutput(recoveryStep)).toMatchObject({
      recoveryReason: RESTART_ERROR_CODE,
      previousStatus: 'running',
      preservedProgressPercent: jobBeforeRestart.progressPercent,
    });
    expect(await callMockGate('getMockAiGateState')).toEqual({
      paused: false,
      waitingRequests: 0,
      requestCount: 0,
    });

    await clickTestId('recovery-dismiss');
    await waitForTestIdMissing('recovery-dialog');
    await openWorkspace(projectId);
    const chapterItem = await findTestIdByAttribute('chapter-item', 'data-chapter-id', chapterId);
    await chapterItem.click();
    await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);
    await clickTestId('chapter-engineering');
    await waitForTestId('engineering-panel');
    await clickTestId('engineering-tab-jobs');

    const recoveredStatus = await findTestIdByAttribute(
      'generation-job-status',
      'data-job-id',
      recoveredJob.id,
    );
    expect(await recoveredStatus.getAttribute('data-job-status')).toBe('failed');
    expect(await recoveredStatus.getAttribute('data-error-code')).toBe(RESTART_ERROR_CODE);
    await waitForTestId('generation-job-recovery');
    const recoveredStepRow = await findTestIdByAttribute(
      'generation-job-step',
      'data-step-id',
      recoveryStep.id,
    );
    expect(await recoveredStepRow.getAttribute('data-step-status')).toBe('failed');
    expect(await (await waitForTestId('generation-job-start')).isEnabled()).toBe(true);
    await assertCleanDiagnostics();

    await browser.reloadSession();
    await waitForTestId('app-shell');
    await waitForTestIdMissing('recovery-dialog', 5000);

    const jobsAfterSecondRestart = await getJobs(chapterId);
    expect(jobsAfterSecondRestart).toEqual(jobsAfterRecovery);
    const stepsAfterSecondRestart = await getSteps(recoveredJob.id);
    expect(stepsAfterSecondRestart).toEqual(stepsAfterRecovery);
    expect(recoverySteps(stepsAfterSecondRestart)).toHaveLength(1);
    expect(await callMockGate('getMockAiGateState')).toEqual({
      paused: false,
      waitingRequests: 0,
      requestCount: 0,
    });
    await assertCleanDiagnostics();
  });
});
