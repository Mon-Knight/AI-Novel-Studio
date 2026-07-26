import { browser, expect } from '@wdio/globals';
import {
  bridgeCall,
  bridgeDiagnostics,
  clickTestId,
  createFirstChapterThroughUi,
  createProjectThroughUi,
  openWorkspace,
  waitForTestId,
} from './helpers';

interface ExecutionTaskView {
  taskId: string;
  taskType: string;
  novelId: string;
  chapterId?: string;
  status: string;
  resultArtifactId?: string;
}

interface ExecutionTaskDetail {
  task: ExecutionTaskView;
  attempts: Array<{
    attemptId: string;
    providerId?: string;
    modelId?: string;
    providerRequestId?: string;
    status: string;
    responseMetadataJson?: Record<string, unknown>;
  }>;
  inputSnapshot: { body: string };
  contextSnapshot: { compiledContext: string };
  constraintSnapshot: {
    providerOptionsJson: Record<string, unknown>;
    promptTemplateBody: string;
  };
}

interface ArtifactBundleView {
  artifact: {
    artifactId: string;
    taskId: string;
    attemptId: string;
    artifactType: string;
    processingStatus: string;
  };
  rawContent: string;
  structuredPayloadJson?: { settings?: Array<{ name?: string }> };
  issues: unknown[];
}

interface WorldSettingView {
  id: string;
  novelId: string;
}

interface PlacementBundleView {
  proposal: {
    proposalId: string;
    artifactId: string;
    candidateIndex: number;
    expectedTargetVersion: number;
    expectedTargetHash: string;
    proposalHash: string;
  };
  plan: {
    planId: string;
    operationId: string;
    planHash: string;
    status: string;
    confirmedBy?: string;
  };
  candidateJson: { name?: string };
}

interface ApplyPlacementResultView {
  plan: PlacementBundleView['plan'];
  link: {
    linkId: string;
    artifactId: string;
    targetId: string;
    targetVersion: number;
    targetHash: string;
  };
  worldSetting: WorldSettingView;
  replayed: boolean;
}

describe('tracked Provider pipeline', () => {
  it('prepares read-only plans and applies one setting only after explicit confirmation', async () => {
    const projectId = await createProjectThroughUi('E2E Provider Pipeline');
    await openWorkspace(projectId);
    const chapterId = await createFirstChapterThroughUi();
    const settingsBefore = await bridgeCall<WorldSettingView[]>('get_world_settings', {
      novelId: projectId,
    });

    await clickTestId('setting-tool');
    await clickTestId('setting-suggest');
    await waitForTestId('setting-suggestion');
    await browser.waitUntil(async () => (
      await browser.$$('[data-testid="setting-suggestion"]')
    ).length === 3, {
      timeout: 30000,
      timeoutMsg: 'Mock setting candidates were not rendered',
    });

    const tasks = await bridgeCall<ExecutionTaskView[]>('list_ai_tasks', {
      input: { novelId: projectId, limit: 20 },
    });
    const settingTasks = tasks.filter((task) => task.taskType === 'setting_expand');
    expect(settingTasks).toHaveLength(1);
    const trackedTask = settingTasks[0];
    expect(trackedTask.novelId).toBe(projectId);
    expect(trackedTask.chapterId).toBe(chapterId);
    expect(trackedTask.status).toBe('completed');
    expect(trackedTask.resultArtifactId).toBeTruthy();

    const detail = await bridgeCall<ExecutionTaskDetail>('get_ai_task', {
      input: { taskId: trackedTask.taskId },
    });
    expect(detail.attempts).toHaveLength(1);
    expect(detail.attempts[0].status).toBe('succeeded');
    expect(detail.attempts[0].providerId).toBe('mock');
    expect(detail.attempts[0].modelId).toBe('Mock');
    expect(detail.attempts[0].providerRequestId).toBe(detail.attempts[0].attemptId);
    expect(detail.attempts[0].responseMetadataJson?.provider).toBe('mock');
    expect(detail.inputSnapshot.body).toContain('请为本章补充相关设定');
    expect(detail.contextSnapshot.compiledContext).toContain('世界观构建专家');
    expect(detail.constraintSnapshot.promptTemplateBody).toContain('世界观构建专家');
    expect(detail.constraintSnapshot.providerOptionsJson.providerId).toBe('mock');
    expect(detail.inputSnapshot.body).not.toContain('apiKey');
    expect(detail.inputSnapshot.body).not.toContain('baseUrl');

    const artifact = await bridgeCall<ArtifactBundleView>('get_result_artifact', {
      input: { artifactId: trackedTask.resultArtifactId },
    });
    expect(artifact.artifact.taskId).toBe(trackedTask.taskId);
    expect(artifact.artifact.attemptId).toBe(detail.attempts[0].attemptId);
    expect(artifact.artifact.artifactType).toBe('setting_candidates');
    expect(artifact.artifact.processingStatus).toBe('valid');
    expect(artifact.rawContent).toContain('场景：关键地点');
    expect(artifact.structuredPayloadJson?.settings).toHaveLength(3);
    expect(artifact.issues).toHaveLength(0);

    const settingsAfter = await bridgeCall<WorldSettingView[]>('get_world_settings', {
      novelId: projectId,
    });
    expect(settingsAfter).toEqual(settingsBefore);
    const suggestionElements = await browser.$$('[data-testid="setting-suggestion"]');
    const proposalIds: Array<string | null> = [];
    for (let index = 0; index < suggestionElements.length; index += 1) {
      proposalIds.push(await suggestionElements[index].getAttribute('data-proposal-id'));
    }
    expect(proposalIds.every(Boolean)).toBe(true);
    expect(new Set(proposalIds).size).toBe(3);
    const placements = await Promise.all(proposalIds.map((proposalId) => (
      bridgeCall<PlacementBundleView>('get_placement_proposal', {
        input: { proposalId },
      })
    )));
    expect(placements.every((placement) => placement.plan.status === 'awaiting_confirmation')).toBe(true);
    expect(placements.every((placement) => placement.proposal.expectedTargetVersion === 0)).toBe(true);
    expect(placements.every((placement) => placement.proposal.expectedTargetHash.length === 64)).toBe(true);
    expect(placements.every((placement) => placement.proposal.proposalHash.length === 64)).toBe(true);
    expect(await browser.$$('[data-testid="setting-suggestion-adopt"]')).toHaveLength(3);

    const preparedDiagnostics = await bridgeDiagnostics();
    expect(preparedDiagnostics.counts?.executionTasks).toBe(1);
    expect(preparedDiagnostics.counts?.resultArtifacts).toBe(1);
    expect(preparedDiagnostics.counts?.placementProposals).toBe(3);
    expect(preparedDiagnostics.counts?.applyPlans).toBe(3);
    expect(preparedDiagnostics.counts?.artifactTargetLinks).toBe(0);

    const firstPlacement = placements[0];
    const adoptButtons = await browser.$$('[data-testid="setting-suggestion-adopt"]');
    await adoptButtons[0].waitForClickable({ timeout: 30000 });
    await adoptButtons[0].click();
    await browser.waitUntil(async () => {
      const settings = await bridgeCall<WorldSettingView[]>('get_world_settings', {
        novelId: projectId,
      });
      return settings.length === settingsBefore.length + 1;
    }, {
      timeout: 30000,
      timeoutMsg: 'Confirmed placement did not create one world setting',
    });
    await browser.waitUntil(async () => (
      await browser.$$('[data-testid="setting-suggestion"]')
    ).length === 2, {
      timeout: 30000,
      timeoutMsg: 'Applied setting candidate remained in the review list',
    });

    const appliedPlacement = await bridgeCall<PlacementBundleView>('get_placement_proposal', {
      input: { proposalId: firstPlacement.proposal.proposalId },
    });
    expect(appliedPlacement.plan.status).toBe('applied');
    expect(appliedPlacement.plan.confirmedBy).toBe('user');
    const replay = await bridgeCall<ApplyPlacementResultView>('apply_placement_plan', {
      input: {
        planId: firstPlacement.plan.planId,
        operationId: firstPlacement.plan.operationId,
        expectedPlanHash: firstPlacement.plan.planHash,
      },
    });
    expect(replay.replayed).toBe(true);
    expect(replay.link.artifactId).toBe(artifact.artifact.artifactId);
    expect(replay.link.targetVersion).toBe(1);
    expect(replay.link.targetHash).toHaveLength(64);
    const settingsAfterReplay = await bridgeCall<WorldSettingView[]>('get_world_settings', {
      novelId: projectId,
    });
    expect(settingsAfterReplay).toHaveLength(settingsBefore.length + 1);

    const diagnostics = await bridgeDiagnostics();
    expect(diagnostics.counts?.executionTasks).toBe(1);
    expect(diagnostics.counts?.resultArtifacts).toBe(1);
    expect(diagnostics.counts?.placementProposals).toBe(3);
    expect(diagnostics.counts?.applyPlans).toBe(3);
    expect(diagnostics.counts?.artifactTargetLinks).toBe(1);
  });
});
