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

describe('tracked Provider pipeline', () => {
  it('persists one Mock setting-candidate Task and does not apply candidates automatically', async () => {
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
    expect(await browser.$$('[data-testid="setting-suggestion-adopt"]')).toHaveLength(3);

    const diagnostics = await bridgeDiagnostics();
    expect(diagnostics.counts?.executionTasks).toBe(1);
    expect(diagnostics.counts?.resultArtifacts).toBe(1);
  });
});
