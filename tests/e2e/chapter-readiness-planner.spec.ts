import { browser, expect } from '@wdio/globals';
import {
  assertCleanDiagnostics,
  bridgeCall,
  bridgeDiagnostics,
  clickTestId,
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  findTestIdByAttribute,
  goHome,
  openWorkspace,
  waitForTestId,
  waitForTestIdAttribute,
} from './helpers';

interface PlanRecord {
  planId: string;
  chapterId: string;
  status: string;
  resultJson?: {
    data?: {
      ready?: boolean;
      score?: number;
      missing?: Array<{ code: string; blocking: boolean }>;
    };
  };
}

interface PlanBundle {
  plan: PlanRecord;
  steps: Array<{ stepId: string; status: string; toolIdentity: string }>;
  attempts: Array<{ stepId: string; status: string; attemptNumber: number }>;
  checkpoints: Array<{ sequence: number; eventType: string }>;
}

interface LeaseGrant {
  lease: {
    leaseId: string;
    epoch: number;
    ownerId: string;
  };
  token: string;
}

const REGISTRY_HASH = '82672d8347a8143a716e590014b9cf61fc576c0556c8683027d51528243c5192';

describe('chapter readiness planner runtime', () => {
  it('runs the six local tools once and persists the completed plan without network access', async () => {
    const projectId = await createProjectThroughUi('E2E Chapter Readiness Planner');
    await openWorkspace(projectId);
    const volumeId = await createVolumeThroughUi('E2E Planner Volume');
    const chapterId = await createChapterThroughUi('E2E Planner Chapter', volumeId);

    await clickTestId('chapter-readiness-toggle');
    await waitForTestIdAttribute('chapter-readiness-plan', 'data-plan-status', 'none');
    await clickTestId('chapter-readiness-create');
    const card = await waitForTestIdAttribute(
      'chapter-readiness-plan',
      'data-plan-status',
      'completed',
      60000,
    );
    const planId = await card.getAttribute('data-plan-id');
    expect(planId).toBeTruthy();

    const plans = await bridgeCall<PlanRecord[]>('list_agent_plans_by_chapter', {
      input: { chapterId, limit: 20 },
    });
    expect(plans).toHaveLength(1);
    expect(plans[0].planId).toBe(planId);
    expect(plans[0].status).toBe('completed');

    const bundle = await bridgeCall<PlanBundle>('get_agent_plan', {
      input: { planId },
    });
    expect(bundle.steps).toHaveLength(6);
    expect(bundle.steps.every((step) => step.status === 'completed')).toBe(true);
    expect(bundle.steps.map((step) => step.toolIdentity)).toEqual([
      'novel.read_context@1',
      'chapter.read_outline@1',
      'chapter.read_context@1',
      'style.read_profile@1',
      'style.read_output_control@1',
      'verification.check_readiness@1',
    ]);
    expect(bundle.attempts).toHaveLength(6);
    expect(
      bundle.attempts.every(
        (attempt) => attempt.status === 'succeeded' && attempt.attemptNumber === 1,
      ),
    ).toBe(true);
    expect(bundle.plan.resultJson?.data?.ready).toBe(false);
    expect(
      bundle.plan.resultJson?.data?.missing?.some(
        (item) => item.code === 'chapter_outline' && item.blocking,
      ),
    ).toBe(true);
    expect(bundle.checkpoints.map((checkpoint) => checkpoint.sequence)).toEqual(
      bundle.checkpoints.map((_, index) => index + 1),
    );
    expect(bundle.checkpoints.some((checkpoint) => checkpoint.eventType === 'step_failed')).toBe(
      false,
    );

    const diagnostics = await bridgeDiagnostics();
    expect(diagnostics.counts?.agentPlans).toBe(1);
    expect(diagnostics.counts?.agentPlanSteps).toBe(6);
    expect(diagnostics.counts?.agentPlanAttempts).toBe(6);
    expect(diagnostics.counts?.agentPlanCheckpoints).toBeGreaterThanOrEqual(14);
    await assertCleanDiagnostics();
    expect(await browser.execute(() => window.location.hash)).toContain(projectId);
  });

  it('recovers a claimed step as waiting_retry and only replays it after explicit UI confirmation', async () => {
    await goHome();
    const projectId = await createProjectThroughUi('E2E Interrupted Planner');
    await openWorkspace(projectId);
    const volumeId = await createVolumeThroughUi('E2E Interrupted Volume');
    const chapterId = await createChapterThroughUi('E2E Interrupted Chapter', volumeId);
    const created = await bridgeCall<PlanBundle>('create_agent_plan', {
      input: {
        operationId: 'e2e-interrupted-plan-create',
        novelId: projectId,
        chapterId,
        registryHash: REGISTRY_HASH,
        plannerId: 'chapter_readiness_plan_v1',
        plannerVersion: 1,
      },
    });
    const firstStep = created.steps[0];
    const grant = await bridgeCall<LeaseGrant>('acquire_agent_plan_lease', {
      input: {
        planId: created.plan.planId,
        ownerId: 'e2e-interrupted-owner',
        ttlSeconds: 300,
      },
    });
    await bridgeCall('claim_agent_plan_step', {
      input: {
        planId: created.plan.planId,
        stepId: firstStep.stepId,
        lease: {
          leaseId: grant.lease.leaseId,
          epoch: grant.lease.epoch,
          ownerId: grant.lease.ownerId,
          token: grant.token,
        },
      },
    });
    const running = await bridgeCall<PlanBundle>('get_agent_plan', {
      input: { planId: created.plan.planId },
    });
    expect(running.plan.status).toBe('running');
    expect(running.steps[0].status).toBe('running');
    expect(running.attempts).toHaveLength(1);
    expect(running.attempts[0].status).toBe('running');
    await assertCleanDiagnostics();

    await browser.reloadSession();
    await waitForTestId('app-shell');
    const recovered = await bridgeCall<PlanBundle>('get_agent_plan', {
      input: { planId: created.plan.planId },
    });
    expect(recovered.plan.status).toBe('waiting_retry');
    expect(recovered.steps[0].status).toBe('waiting_retry');
    expect(recovered.attempts).toHaveLength(1);
    expect(recovered.attempts[0].status).toBe('abandoned');
    expect(
      recovered.checkpoints.filter(
        (checkpoint) => checkpoint.eventType === 'interrupted_recovered',
      ),
    ).toHaveLength(1);

    await openWorkspace(projectId);
    const chapter = await findTestIdByAttribute('chapter-item', 'data-chapter-id', chapterId);
    await chapter.click();
    await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);
    await clickTestId('chapter-readiness-toggle');
    await waitForTestIdAttribute('chapter-readiness-plan', 'data-plan-status', 'waiting_retry');
    await clickTestId('chapter-readiness-retry');
    await waitForTestIdAttribute('chapter-readiness-plan', 'data-plan-status', 'completed', 60000);

    const completed = await bridgeCall<PlanBundle>('get_agent_plan', {
      input: { planId: created.plan.planId },
    });
    expect(completed.plan.status).toBe('completed');
    expect(completed.attempts).toHaveLength(7);
    expect(
      completed.attempts
        .filter((attempt) => attempt.stepId === firstStep.stepId)
        .map((attempt) => [attempt.attemptNumber, attempt.status]),
    ).toEqual([
      [1, 'abandoned'],
      [2, 'succeeded'],
    ]);
    expect(
      completed.checkpoints.filter((checkpoint) => checkpoint.eventType === 'retry_authorized'),
    ).toHaveLength(1);
    await assertCleanDiagnostics();

    await browser.reloadSession();
    await waitForTestId('app-shell');
    const afterSecondRestart = await bridgeCall<PlanBundle>('get_agent_plan', {
      input: { planId: created.plan.planId },
    });
    expect(afterSecondRestart.attempts).toEqual(completed.attempts);
    expect(afterSecondRestart.checkpoints).toEqual(completed.checkpoints);
    await assertCleanDiagnostics();
  });
});
