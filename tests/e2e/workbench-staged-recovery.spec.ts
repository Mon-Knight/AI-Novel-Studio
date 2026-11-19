import { browser, expect } from '@wdio/globals';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertCleanDiagnostics,
  bridgeCall,
  clickTestId,
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  fillTestId,
  findTestIdByAttribute,
  navigateHash,
  openWorkspace,
  seedChapterCoreAssetsForE2e,
  waitForTestId,
  waitForTestIdMissing,
} from './helpers';

interface Bundle {
  conversation: { status: string; novelId: string };
  turns: Array<{ turnId: string; role: string }>;
  runs: Array<{ runId: string; status: string; error?: string | null }>;
  artifacts: Array<{ artifactId: string; artifactType: string; status: string }>;
}
interface Stage {
  stageId: string;
  stageKey: string;
  stageKind: string;
  status: string;
  attempt: number;
  errorCode?: string;
  resultHash?: string | null;
  resultDocumentId?: string | null;
  runId: string;
}
interface ProcessState {
  processId: number;
  resultArtifactsCount: number;
  adoptedDraftsCount: number;
}

const stageQuery = (novelId: string, chapterId: string) => ({
  input: {
    novelId,
    chapterId,
    limit: 200,
  },
});
const listStages = async (novelId: string, chapterId: string) =>
  [
    ...(await bridgeCall<Stage[]>('list_chapter_workflow_stages', stageQuery(novelId, chapterId))),
  ].reverse();

describe('production native Scene/Beat recovery', () => {
  it('reuses durable stages after a real restart and completes only after explicit retry', async function () {
    this.timeout(240000);
    await waitForTestId('app-shell');
    await browser.execute(() =>
      localStorage.setItem('ai_novel_studio_e2e_workbench_model', 'enabled'),
    );
    const novelId = await createProjectThroughUi('E2E 原生阶段恢复');
    await openWorkspace(novelId);
    const volumeId = await createVolumeThroughUi('阶段卷');
    const chapterId = await createChapterThroughUi('第一章 阶段链', volumeId);
    const readiness = await seedChapterCoreAssetsForE2e({
      novelId,
      worldSetting: { title: '旧城', content: '旧城的雨夜街道与钟楼构成可核对的连续现场。' },
      ruleSystem: {
        title: '阶段规则',
        content: '每个动作必须由正文明确记录，计划不能冒充实际结果。',
        forbiddenRules: '不得跳过已发生的状态变化。',
      },
      protagonist: {
        name: '沈岚',
        identity: '记录员',
        personality: '审慎',
        goal: '核对钟楼记录并完成一次连续行动',
      },
      chapters: [
        {
          chapterId,
          title: '第一章 阶段链',
          outline: '沈岚在雨夜沿街道到达钟楼，核对记录后取得一条可定位线索。',
          targetWordCount: 650,
        },
      ],
      appliedScenePlan: {
        chapterId,
        scene: {
          id: 'scene-staged-1',
          sceneNo: 1,
          title: '雨夜钟楼',
          goal: '沈岚核对钟楼记录并取得一条可定位线索。',
          location: '旧城钟楼',
          characters: ['沈岚'],
          conflict: '记录与现场脚印不一致',
          contextCapsule: '尚未进入钟楼，入口状态只有雨夜街道。',
          constraints: ['不把计划写成既成事实'],
          expectedEndState: '取得线索且停在下一步行动前',
          targetCharacters: 650,
          planVersion: 2 as const,
          beats: [],
        },
      },
    });
    expect(readiness.storageMode).toBe('sqlite');
    expect(readiness.appliedEngineeringStateId).toBeTruthy();
    expect(readiness.readiness).toEqual([{ chapterId, ready: true, missingAssets: [] }]);

    const dataDir = process.env.AI_NOVEL_STUDIO_E2E_DATA_DIR!;
    const releaseFile = path.join(dataDir, 'stage-gate');
    const waitingFile = `${releaseFile}.waiting`;
    fs.rmSync(releaseFile, { force: true });
    fs.rmSync(waitingFile, { force: true });

    await navigateHash('#/');
    await waitForTestId('creative-workbench');
    await (await findTestIdByAttribute('workbench-project', 'data-novel-id', novelId)).click();
    await clickTestId('workbench-create-task');
    await fillTestId('workbench-new-task-goal', '生成第一章正文，650字，按已应用场景计划写章');
    await (await waitForTestId('workbench-new-task-chapter')).selectByAttribute('value', chapterId);
    const start = await waitForTestId('workbench-create-and-start');
    await start.waitForEnabled({ timeout: 30000 });
    await start.click();
    const header = await waitForTestId('workbench-task-header');
    const conversationId = (await header.getAttribute('data-conversation-id'))!;

    await browser.waitUntil(async () => fs.existsSync(waitingFile), {
      timeout: 90000,
      timeoutMsg: 'Native beat_state stage did not reach the deterministic pause',
    });
    let stages = await listStages(novelId, chapterId);
    expect(stages.map((stage) => stage.stageKind)).toEqual([
      'scene_plan',
      'beat_plan',
      'beat_write',
      'beat_state',
    ]);
    expect(stages.slice(0, 3).every((stage) => stage.status === 'succeeded')).toBe(true);
    const held = stages[3];
    expect(held.status).toBe('running');
    expect(held.stageKind).toBe('beat_state');
    const successfulBefore = stages
      .filter((stage) => stage.status === 'succeeded')
      .map(({ stageId, stageKey, stageKind, resultHash, attempt }) => ({
        stageId,
        stageKey,
        stageKind,
        resultHash,
        attempt,
      }));
    const beforeState = await bridgeCall<ProcessState>('get_e2e_agent_closed_loop_state');

    // A real process restart interrupts the in-memory root and settles only the
    // running stage; startup must not dispatch another model request.
    await browser.reloadSession();
    await waitForTestId('app-shell');
    await waitForTestId('conversation-recovery-dialog');
    await clickTestId('conversation-recovery-dismiss');
    await waitForTestIdMissing('conversation-recovery-dialog');
    const afterState = await bridgeCall<ProcessState>('get_e2e_agent_closed_loop_state');
    expect(afterState.processId).not.toBe(beforeState.processId);
    stages = await listStages(novelId, chapterId);
    expect(stages).toHaveLength(4);
    expect(stages[3].status).toBe('failed');
    expect(stages[3].errorCode).toBe('WORKFLOW_INTERRUPTED');
    expect(
      stages
        .filter((stage) => stage.status === 'succeeded')
        .map(({ stageId, stageKey, stageKind, resultHash, attempt }) => ({
          stageId,
          stageKey,
          stageKind,
          resultHash,
          attempt,
        })),
    ).toEqual(successfulBefore);
    expect(afterState.resultArtifactsCount).toBe(0);
    expect(afterState.adoptedDraftsCount).toBe(0);

    await navigateHash('#/');
    await waitForTestId('creative-workbench');
    await (await findTestIdByAttribute('workbench-project', 'data-novel-id', novelId)).click();
    await (
      await findTestIdByAttribute('workbench-task', 'data-conversation-id', conversationId)
    ).click();
    const retry = await waitForTestId('workbench-retry-turn');
    await retry.waitForEnabled({ timeout: 30000 });
    await retry.scrollIntoView({ block: 'center', inline: 'nearest' });
    await retry.waitForClickable({ timeout: 30000 });
    const runsBeforeRetry =
      (await bridgeCall<Bundle>('get_task_conversation', { conversationId }))?.runs.length ?? 0;
    fs.writeFileSync(releaseFile, 'release\n', { encoding: 'utf8' });
    await retry.click();

    await browser.waitUntil(
      async () => {
        const bundle = await bridgeCall<Bundle>('get_task_conversation', { conversationId });
        if (
          bundle &&
          bundle.runs.length > runsBeforeRetry &&
          bundle.conversation.status === 'failed'
        ) {
          const latestError = bundle.runs[bundle.runs.length - 1]?.error ?? 'unknown error';
          throw new Error(`Explicit retry failed cleanly in DB: ${latestError}`);
        }
        return (
          bundle?.conversation.status === 'waiting_user' &&
          bundle.artifacts.filter((item) => item.artifactType === 'chapter_text').length === 1
        );
      },
      {
        timeout: 180000,
        timeoutMsg: 'Explicit retry did not assemble the staged chapter candidate',
      },
    );
    stages = await listStages(novelId, chapterId);
    const interruptedAttempt = stages.find((stage) => stage.stageId === held.stageId);
    expect(interruptedAttempt).toMatchObject({
      stageId: held.stageId,
      stageKind: 'beat_state',
      attempt: 1,
      status: 'failed',
      errorCode: 'WORKFLOW_INTERRUPTED',
    });
    const succeededStages = stages.filter((stage) => stage.stageId !== held.stageId);
    expect(succeededStages.every((stage) => stage.status === 'succeeded')).toBe(true);
    const kinds = succeededStages.map((stage) => stage.stageKind);
    expect(kinds).toEqual([
      'scene_plan',
      'beat_plan',
      'beat_write',
      'beat_state',
      'scene_close',
      'chapter_assemble',
    ]);
    expect(succeededStages.find((stage) => stage.stageKind === 'beat_state')?.attempt).toBe(2);
    expect(
      succeededStages.slice(0, 3).map(({ stageId, stageKey, stageKind, resultHash, attempt }) => ({
        stageId,
        stageKey,
        stageKind,
        resultHash,
        attempt,
      })),
    ).toEqual(successfulBefore);
    const finalState = await bridgeCall<ProcessState>('get_e2e_agent_closed_loop_state');
    expect(finalState.resultArtifactsCount).toBe(1);
    expect(finalState.adoptedDraftsCount).toBe(0);

    // A second restart never duplicates the immutable stage chain or candidate.
    const stageIds = stages.map((stage) => stage.stageId).sort();
    await assertCleanDiagnostics();
    await browser.reloadSession();
    await waitForTestId('app-shell');
    const recoveryAfterComplete = await browser.$('[data-testid="conversation-recovery-dialog"]');
    if (await recoveryAfterComplete.isExisting()) {
      await clickTestId('conversation-recovery-dismiss');
      await waitForTestIdMissing('conversation-recovery-dialog');
    }
    const stagesAfterRestart = await listStages(novelId, chapterId);
    expect(stagesAfterRestart.map((stage) => stage.stageId).sort()).toEqual(stageIds);
    const finalAfterRestart = await bridgeCall<ProcessState>('get_e2e_agent_closed_loop_state');
    expect(finalAfterRestart.resultArtifactsCount).toBe(1);
    expect(finalAfterRestart.adoptedDraftsCount).toBe(0);

    const artifactRoot = process.env.AI_NOVEL_STUDIO_E2E_ARTIFACTS!;
    fs.writeFileSync(
      path.join(artifactRoot, 'staged-recovery-evidence.json'),
      JSON.stringify(
        {
          storageMode: 'sqlite',
          provider: 'deterministic-mock',
          ui: 'production',
          pausedStageKind: held.stageKind,
          pausedStageKey: held.stageKey,
          interruptedErrorCode: 'WORKFLOW_INTERRUPTED',
          reusedSuccessfulStages: successfulBefore.length,
          completedStageKinds: kinds,
          explicitRetry: true,
          startupModelReplay: false,
          formalAdoptions: 0,
          restartVerifiedTwice: true,
        },
        null,
        2,
      ),
    );
    await assertCleanDiagnostics();
  });
});
