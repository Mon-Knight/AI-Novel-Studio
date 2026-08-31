/// <reference types="@wdio/globals/types" />
import { browser, expect } from '@wdio/globals';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  assertCleanDiagnostics,
  bridgeCall,
  clickTestId,
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  fillTestId,
  fillTextareaTestId,
  findTestIdByAttribute,
  navigateHash,
  openWorkspace,
  seedChapterCoreAssetsForE2e,
  waitForTestId,
  waitForTestIdAttribute,
} from './helpers';

interface DraftSummary {
  id: string;
  chapterId: string;
  novelId: string;
  content: string;
  source: string;
  isAdopted: boolean;
  versionNo: number;
}

interface ChapterRecord {
  id: string;
  novelId: string;
  title: string;
  status: string;
  adoptedDraftId?: string;
}

interface E2eAgentClosedLoopState {
  processId: number;
  conversationsCount: number;
  turnsCount: number;
  runsCount: number;
  toolEventsCount: number;
  resultArtifactsCount: number;
  artifactDecisionsCount: number;
  reviewAuthorizationsCount: number;
  consumedAuthorizationsCount: number;
  draftsCount: number;
  chaptersCount: number;
  adoptedDraftsCount: number;
}

interface ReviewAuthorizationRecord {
  authorizationId: string;
  decisionId: string;
  artifactId: string;
  novelId: string;
  chapterId: string;
  status: string;
  issuedAt: string;
  consumedAt?: string;
  consumedByDraftId?: string;
}

interface ResultArtifactBundle {
  artifact: {
    artifactId: string;
    artifactType: string;
    sourceNovelId: string;
    sourceChapterId?: string;
    contentHash: string;
    processingStatus: string;
  };
  rawContent: string;
}

interface TaskConversationBundle {
  conversation: {
    conversationId: string;
    novelId: string;
    status: string;
  };
  turns: Array<{
    turnId: string;
    conversationId: string;
    sequence: number;
    role: string;
    content?: string;
    runId?: string;
  }>;
  runs: Array<{
    runId: string;
    conversationId: string;
    turnId: string;
    status: string;
  }>;
  toolEvents: Array<{ runId: string; toolName: string; status: string; error?: string }>;
  artifacts: Array<{
    cardId: string;
    conversationId: string;
    runId?: string;
    artifactId?: string;
    artifactType: string;
    status: string;
  }>;
  decisions: Array<{
    decisionId: string;
    artifactId: string;
    conversationId: string;
    decision: string;
    actor: string;
    targetId: string;
  }>;
  authorizations: ReviewAuthorizationRecord[];
}

interface ClosedLoopRoundEvidence {
  round: number;
  novelKey: 'A' | 'B';
  novelId: string;
  chapterId: string;
  chapterTitle: string;
  conversationId: string;
  generateRunId: string;
  revisionRunId: string;
  summaryTurnId: string;
  initialArtifactId: string;
  revisedArtifactId: string;
  decisionId: string;
  authorizationId: string;
  draftId: string;
  adoptedDraftId: string;
  initialArtifactHash: string;
  revisedArtifactHash: string;
  adoptedContentHash: string;
  restartVerified: boolean;
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function assertChapterArtifact(
  bundle: ResultArtifactBundle,
  expected: { artifactId: string; novelId: string; chapterId: string },
): void {
  expect(bundle.artifact.artifactId).toBe(expected.artifactId);
  expect(bundle.artifact.artifactType).toBe('chapter_text');
  expect(bundle.artifact.sourceNovelId).toBe(expected.novelId);
  expect(bundle.artifact.sourceChapterId).toBe(expected.chapterId);
  expect(['valid', 'valid_with_warnings']).toContain(bundle.artifact.processingStatus);
  expect(bundle.rawContent.length).toBeGreaterThan(20);
  expect(sha256(bundle.rawContent)).toBe(bundle.artifact.contentHash);
}

describe('Agent production closed loop & restart verification', () => {
  it('executes 5-round multi-novel generation, revision, review authorization, adoption & survives restart', async () => {
    const roundEvidence: ClosedLoopRoundEvidence[] = [];
    const seenConversationIds = new Set<string>();

    await waitForTestId('app-shell');
    await browser.execute(() => {
      window.localStorage.setItem('ai_novel_studio_e2e_workbench_model', 'enabled');
    });

    // =========================================================================
    // 1. 初始化两本作品与五个目标章节
    // =========================================================================
    // 作品 A：包含 3 个独立章节 A1, A2, A3
    const projectAId = await createProjectThroughUi('E2E Closed Loop Novel A');
    await openWorkspace(projectAId);
    const volumeAId = await createVolumeThroughUi('第一卷 仙门初入');
    const chapterA1Id = await createChapterThroughUi('第一章 苍穹惊变', volumeAId);
    const chapterA2Id = await createChapterThroughUi('第二章 试剑石前', volumeAId);
    const chapterA3Id = await createChapterThroughUi('第三章 风云际会', volumeAId);
    const readinessA = await seedChapterCoreAssetsForE2e({
      novelId: projectAId,
      worldSetting: {
        title: '仙门演武世界',
        content: '宗门以演武、试剑和长老议事维持秩序，天地异象会留下可追踪的影响。',
      },
      ruleSystem: {
        title: '修行与宗门规则',
        content: '修行能力必须付出体力与心神代价，公开比试受宗门戒律约束。',
        forbiddenRules: '不得无代价突破既定境界，不得抹除已经发生的公开事件。',
      },
      protagonist: {
        name: '沈砚',
        identity: '初入宗门的年轻弟子',
        personality: '沉静、克制，在压力下先观察再行动',
        goal: '查清自身异象与宗门暗流的关系',
      },
      chapters: [
        {
          chapterId: chapterA1Id,
          title: '第一章 苍穹惊变',
          outline: '演武场冲突升级，风雨与天象同时异变，主角被迫显露异常。',
          targetWordCount: 600,
        },
        {
          chapterId: chapterA2Id,
          title: '第二章 试剑石前',
          outline: '众弟子聚集试剑石前，嘲讽与期待交错，主角平静接受测试。',
          targetWordCount: 600,
        },
        {
          chapterId: chapterA3Id,
          title: '第三章 风云际会',
          outline: '剑芒触发宗门警戒，长老现身探查，明暗势力开始关注主角。',
          targetWordCount: 600,
        },
      ],
    });
    expect(readinessA.storageMode).toBe('sqlite');
    expect(readinessA.novelId).toBe(projectAId);
    expect(readinessA.chapterOutlineIds).toHaveLength(3);
    expect(readinessA.readiness).toEqual([
      { chapterId: chapterA1Id, ready: true, missingAssets: [] },
      { chapterId: chapterA2Id, ready: true, missingAssets: [] },
      { chapterId: chapterA3Id, ready: true, missingAssets: [] },
    ]);

    // 作品 B：包含 2 个独立章节 B1, B2
    await navigateHash('#/novels');
    const projectBId = await createProjectThroughUi('E2E Closed Loop Novel B');
    await openWorkspace(projectBId);
    const volumeBId = await createVolumeThroughUi('第一卷 星渊起航');
    const chapterB1Id = await createChapterThroughUi('第一章 深空跃迁', volumeBId);
    const chapterB2Id = await createChapterThroughUi('第二章 引擎危机', volumeBId);
    const readinessB = await seedChapterCoreAssetsForE2e({
      novelId: projectBId,
      worldSetting: {
        title: '星际航行环境',
        content: '远航舰在深空依赖跃迁与冷却系统，舱内资源和通信均受严格限制。',
      },
      ruleSystem: {
        title: '舰船工程规则',
        content: '跃迁、供能和散热遵守守恒约束，任何抢修都需要承担时间与辐射风险。',
        forbiddenRules: '不得凭空恢复设备，不得忽略真空、微重力和辐射造成的后果。',
      },
      protagonist: {
        name: '林序',
        identity: '远航舰动力工程师',
        personality: '理性、坚韧，危机中优先保护同伴',
        goal: '修复跃迁系统并带领舰队抵达安全航道',
      },
      chapters: [
        {
          chapterId: chapterB1Id,
          title: '第一章 深空跃迁',
          outline: '跃迁引擎过载，主控舱连续告警，主角判断故障正在向动力舱蔓延。',
          targetWordCount: 600,
        },
        {
          chapterId: chapterB2Id,
          title: '第二章 引擎危机',
          outline: '主角进入微重力动力舱，冒着辐射风险焊接并恢复冷却回路。',
          targetWordCount: 600,
        },
      ],
    });
    expect(readinessB.storageMode).toBe('sqlite');
    expect(readinessB.novelId).toBe(projectBId);
    expect(readinessB.chapterOutlineIds).toHaveLength(2);
    expect(readinessB.readiness).toEqual([
      { chapterId: chapterB1Id, ready: true, missingAssets: [] },
      { chapterId: chapterB2Id, ready: true, missingAssets: [] },
    ]);

    const chapterTasks = [
      {
        round: 1,
        novelKey: 'A' as const,
        novelId: projectAId,
        chapterId: chapterA1Id,
        chapterTitle: '第一章 苍穹惊变',
        generatePrompt: '生成第一章正文，2000字，描写演武场激战与天生异象',
        revisionPrompt: '重新修改这一版正文，节奏放慢，着重渲染风雨交加与心理压迫感',
      },
      {
        round: 2,
        novelKey: 'A' as const,
        novelId: projectAId,
        chapterId: chapterA2Id,
        chapterTitle: '第二章 试剑石前',
        generatePrompt: '生成第二章正文，2000字，主角走近试剑石，全场屏息以待',
        revisionPrompt: '重新修改第二章，强化众弟子的嘲讽与主角的平静反差',
      },
      {
        round: 3,
        novelKey: 'A' as const,
        novelId: projectAId,
        chapterId: chapterA3Id,
        chapterTitle: '第三章 风云际会',
        generatePrompt: '生成第三章正文，2000字，剑芒惊天，宗门长老现身探寻',
        revisionPrompt: '重新修改第三章，增加长老神识探查的细节与暗流涌动',
      },
      {
        round: 4,
        novelKey: 'B' as const,
        novelId: projectBId,
        chapterId: chapterB1Id,
        chapterTitle: '第一章 深空跃迁',
        generatePrompt: '生成第一章正文，2000字，跃迁引擎过载，主控舱警报大作',
        revisionPrompt: '重新修改第一章，强化太空中无声爆炸的视觉冲击与副官的绝望',
      },
      {
        round: 5,
        novelKey: 'B' as const,
        novelId: projectBId,
        chapterId: chapterB2Id,
        chapterTitle: '第二章 引擎危机',
        generatePrompt: '生成第二章正文，2000字，主角深入动力舱手动检修冷却回路',
        revisionPrompt: '重新修改第二章，突出微重力环境下焊接与辐射危险的细节',
      },
    ];

    // =========================================================================
    // 2. 逐一执行 5 轮完整闭环
    // =========================================================================
    for (const task of chapterTasks) {
      await navigateHash('#/');
      await waitForTestId('creative-workbench');

      // 选中当前作品
      const projectRow = await findTestIdByAttribute(
        'workbench-project',
        'data-novel-id',
        task.novelId,
      );
      await projectRow.click();
      await browser.waitUntil(
        async () => (await projectRow.getAttribute('data-selected')) === 'true',
        { timeout: 30000, timeoutMsg: `作品 ${task.novelId} 未成为当前工作台项目` },
      );

      // 原子创建独立任务会话，并由创建动作启动首个 Run
      await clickTestId('workbench-create-task');
      await waitForTestId('workbench-task-creator');
      await fillTestId('workbench-new-task-goal', task.generatePrompt);
      const newTaskChapter = await waitForTestId('workbench-new-task-chapter');
      await newTaskChapter.selectByAttribute('value', task.chapterId);
      expect(await newTaskChapter.getValue()).toBe(task.chapterId);
      const createAndStart = await waitForTestId('workbench-create-and-start');
      await createAndStart.waitForEnabled({ timeout: 30000 });
      await createAndStart.click();

      const taskHeader = await waitForTestId('workbench-task-header');
      await browser.waitUntil(
        async () => {
          const candidateId = (await taskHeader.getAttribute('data-conversation-id'))?.trim();
          return Boolean(candidateId && !seenConversationIds.has(candidateId));
        },
        {
          timeout: 30000,
          timeoutMsg: `Round ${task.round} 未切换到新建任务会话`,
        },
      );
      const conversationId = (await taskHeader.getAttribute('data-conversation-id'))!.trim();
      expect(conversationId).toBeTruthy();
      seenConversationIds.add(conversationId);

      // 切换/绑定目标章节
      const chapterSelect = await waitForTestId('workbench-chapter-select');
      await chapterSelect.selectByAttribute('value', task.chapterId);
      expect(await chapterSelect.getValue()).toBe(task.chapterId);

      // --- 第 1 步：等待原子创建启动的首版生成 ---
      await browser.waitUntil(
        async () => {
          const candidate = await bridgeCall<TaskConversationBundle | null>(
            'get_task_conversation',
            { conversationId },
          );
          return (
            candidate?.conversation.status === 'waiting_user' &&
            candidate.artifacts.filter((card) => card.artifactType === 'chapter_text').length === 1
          );
        },
        { timeout: 60000, timeoutMsg: '未能持久化第一版章节候选卡片' },
      );
      await waitForTestIdAttribute(
        'workbench-conversation-status',
        'data-status',
        'waiting_user',
        60000,
      );

      const initialBundle = await bridgeCall<TaskConversationBundle | null>(
        'get_task_conversation',
        { conversationId },
      );
      const initialArtifactId = initialBundle?.artifacts.find(
        (card) => card.artifactType === 'chapter_text',
      )?.artifactId;
      expect(initialArtifactId).toBeTruthy();
      const firstCard = await findTestIdByAttribute(
        'workbench-artifact-card',
        'data-artifact-id',
        initialArtifactId!,
      );

      // --- 第 2 步：显式要求修改初版，再生成第二版 ---
      const reviseButton = await firstCard.$('[data-testid="workbench-artifact-revise"]');
      expect(await reviseButton.isExisting()).toBe(true);
      await reviseButton.click();
      await waitForTestIdAttribute(
        'workbench-artifact-card',
        'data-decision',
        'request_revision',
        30000,
      );
      await waitForTestIdAttribute('workbench-conversation-status', 'data-status', 'idle', 30000);

      await fillTestId('workbench-composer-input', task.revisionPrompt);
      const secondSendBtn = await waitForTestId('workbench-send-task');
      await secondSendBtn.waitForEnabled({ timeout: 30000 });
      await secondSendBtn.click();

      await browser.waitUntil(
        async () => {
          const candidate = await bridgeCall<TaskConversationBundle | null>(
            'get_task_conversation',
            { conversationId },
          );
          return (
            candidate?.conversation.status === 'waiting_user' &&
            candidate.artifacts.filter((card) => card.artifactType === 'chapter_text').length === 2
          );
        },
        { timeout: 60000, timeoutMsg: '未能持久化修改后的第二版章节候选卡片' },
      );
      await waitForTestIdAttribute(
        'workbench-conversation-status',
        'data-status',
        'waiting_user',
        60000,
      );

      const revisedBundle = await bridgeCall<TaskConversationBundle | null>(
        'get_task_conversation',
        { conversationId },
      );
      const revisedArtifactId = revisedBundle?.artifacts.find(
        (card) => card.artifactType === 'chapter_text' && card.artifactId !== initialArtifactId,
      )?.artifactId;
      expect(revisedArtifactId).toBeTruthy();
      expect(revisedArtifactId).not.toBe(initialArtifactId);
      const latestCard = await findTestIdByAttribute(
        'workbench-artifact-card',
        'data-artifact-id',
        revisedArtifactId!,
      );

      const initialArtifact = await bridgeCall<ResultArtifactBundle>('get_result_artifact', {
        input: { artifactId: initialArtifactId },
      });
      const revisedArtifact = await bridgeCall<ResultArtifactBundle>('get_result_artifact', {
        input: { artifactId: revisedArtifactId },
      });
      assertChapterArtifact(initialArtifact, {
        artifactId: initialArtifactId!,
        novelId: task.novelId,
        chapterId: task.chapterId,
      });
      assertChapterArtifact(revisedArtifact, {
        artifactId: revisedArtifactId!,
        novelId: task.novelId,
        chapterId: task.chapterId,
      });
      expect(revisedArtifact.artifact.contentHash).not.toBe(initialArtifact.artifact.contentHash);

      const activeBundle = await bridgeCall<TaskConversationBundle | null>(
        'get_task_conversation',
        { conversationId },
      );
      const activeChapterTextCards = activeBundle?.artifacts.filter(
        (card) => card.artifactType === 'chapter_text',
      );
      expect(activeChapterTextCards).toHaveLength(2);
      const generateRunId = activeChapterTextCards?.find(
        (card) => card.artifactId === initialArtifactId,
      )?.runId;
      const revisionRunId = activeChapterTextCards?.find(
        (card) => card.artifactId === revisedArtifactId,
      )?.runId;
      expect(generateRunId).toBeTruthy();
      expect(revisionRunId).toBeTruthy();
      expect(generateRunId).not.toBe(revisionRunId);
      const activeChapterTextRunIds = new Set([generateRunId, revisionRunId]);
      const activeChapterTextRuns = activeBundle?.runs.filter((run) =>
        activeChapterTextRunIds.has(run.runId),
      );
      expect(activeChapterTextRuns).toHaveLength(2);
      expect(activeChapterTextRuns?.every((run) => run.status === 'completed')).toBe(true);

      // --- 第 3 步：强制确认进入审阅 ---
      const confirmButton = await latestCard.$('[data-testid="workbench-artifact-confirm-review"]');
      expect(await confirmButton.isExisting()).toBe(true);
      await confirmButton.click();

      // --- 第 4 步：断言跳转到带授权的审阅工作台 ---
      await browser.waitUntil(
        async () => {
          const hash = await browser.execute(() => window.location.hash);
          return (
            hash.includes(`/novels/${task.novelId}/workspace`) &&
            hash.includes('authorizationId=') &&
            hash.includes(`chapterId=${task.chapterId}`)
          );
        },
        { timeout: 30000, timeoutMsg: '未能自动跳转到携带 authorizationId 的审阅工作台' },
      );

      const currentHash = (await browser.execute(() => window.location.hash)) as string;
      const hashParams = new URLSearchParams(currentHash.split('?')[1] || '');
      const authorizationId = hashParams.get('authorizationId')!;
      expect(authorizationId).toBeTruthy();

      // --- 第 5 步：审阅工作台初始只读与解锁编辑 ---
      await waitForTestId('chapter-review-lock');
      const editor = await waitForTestIdAttribute(
        'chapter-editor',
        'data-chapter-id',
        task.chapterId,
      );
      expect(await editor.getAttribute('data-review-locked')).toBe('true');

      // 点击进入编辑
      await clickTestId('chapter-review-unlock');
      expect(await editor.getAttribute('data-review-locked')).toBe('false');

      const loadedCandidateText = await editor.getValue();
      expect(loadedCandidateText).toBeTruthy();
      expect(loadedCandidateText.length).toBeGreaterThan(20);
      expect(loadedCandidateText).toBe(revisedArtifact.rawContent);
      expect(sha256(loadedCandidateText)).toBe(revisedArtifact.artifact.contentHash);

      const uniqueReviewMarker = `\n\n【E2E 审阅确认标记：Round ${task.round} - Chapter ${task.chapterId} - ${Date.now()}】`;
      const modifiedText = loadedCandidateText + uniqueReviewMarker;

      const canonicalModifiedText = await fillTextareaTestId('chapter-editor', modifiedText);
      expect(canonicalModifiedText).toBe(modifiedText);
      expect(await editor.getAttribute('data-dirty')).toBe('true');

      // --- 第 6 步：保存草稿 ---
      await clickTestId('chapter-save');
      await browser.waitUntil(
        async () =>
          (await (await browser.$('[data-testid="chapter-editor"]')).getAttribute('data-dirty')) ===
          'false',
        { timeout: 30000, timeoutMsg: '草稿保存超时' },
      );

      const savedDraftId = (await editor.getAttribute('data-draft-id'))!;
      expect(savedDraftId).toBeTruthy();
      expect(savedDraftId.startsWith('candidate-')).toBe(false);

      // --- 第 7 步：点击采用草稿 ---
      await clickTestId('chapter-adopt');
      await waitForTestId('apply-confirm');
      await clickTestId('dialog-confirm');

      await browser.waitUntil(
        async () =>
          (await (
            await browser.$('[data-testid="chapter-editor"]')
          ).getAttribute('data-adopted')) === 'true',
        { timeout: 30000, timeoutMsg: '草稿采用未变为已采用状态' },
      );

      const summaryTurnId = `summary-generation-${authorizationId}`;
      const pendingSummaryBundle = await bridgeCall<TaskConversationBundle | null>(
        'get_task_conversation',
        { conversationId },
      );
      expect(pendingSummaryBundle?.conversation.status).toBe('idle');
      const pendingSummaryTurns = pendingSummaryBundle?.turns.filter(
        (turn) => turn.turnId === summaryTurnId,
      );
      expect(pendingSummaryTurns).toHaveLength(1);
      expect(pendingSummaryTurns?.[0].role).toBe('user');
      expect(pendingSummaryTurns?.[0].content).toContain('总结本章');
      expect(pendingSummaryBundle?.runs.filter((run) => run.turnId === summaryTurnId)).toHaveLength(
        0,
      );
      expect(
        pendingSummaryBundle?.artifacts.filter((card) => card.artifactType === 'chapter_summary'),
      ).toHaveLength(0);
      const adoptedChapterTextCards = pendingSummaryBundle?.artifacts.filter(
        (card) => card.artifactType === 'chapter_text',
      );
      expect(adoptedChapterTextCards?.map((card) => card.artifactId).sort()).toEqual(
        [initialArtifactId, revisedArtifactId].sort(),
      );

      // --- 第 8 步：核实数据库与授权状态 ---
      const chaptersInDb = await bridgeCall<ChapterRecord[]>('get_chapters_by_novel_id', {
        novelId: task.novelId,
      });
      const chapterInDb = chaptersInDb.find((c) => c.id === task.chapterId);
      expect(chapterInDb?.adoptedDraftId).toBe(savedDraftId);

      const authRecord = await bridgeCall<ReviewAuthorizationRecord | null>(
        'get_review_authorization',
        { authorizationId },
      );
      expect(authRecord).toBeTruthy();
      expect(authRecord?.status).toBe('consumed');
      expect(authRecord?.consumedByDraftId).toBe(savedDraftId);
      expect(authRecord?.artifactId).toBe(revisedArtifactId);
      expect(authRecord?.novelId).toBe(task.novelId);
      expect(authRecord?.chapterId).toBe(task.chapterId);
      expect(authRecord?.decisionId).toBeTruthy();

      const draftsAfterAdoption = await bridgeCall<DraftSummary[]>('get_drafts_by_chapter_id', {
        chapterId: task.chapterId,
      });
      const adoptedDraft = draftsAfterAdoption.find((draft) => draft.id === savedDraftId);
      const placeholderDrafts = draftsAfterAdoption.filter(
        (draft) => draft.source === 'manual_placeholder',
      );
      expect(draftsAfterAdoption).toHaveLength(2);
      expect(placeholderDrafts).toHaveLength(1);
      expect(placeholderDrafts[0].content).toBe('');
      expect(placeholderDrafts[0].isAdopted).toBe(false);
      expect(adoptedDraft).toBeTruthy();
      expect(adoptedDraft?.novelId).toBe(task.novelId);
      expect(adoptedDraft?.chapterId).toBe(task.chapterId);
      expect(adoptedDraft?.isAdopted).toBe(true);
      expect(adoptedDraft?.content).toBe(modifiedText);
      expect(adoptedDraft?.versionNo).toBeGreaterThan(0);

      // --- 第 9 步：返回创作工作台，验证 Mock 总结在创建 Run 前显式失败 ---
      await navigateHash('#/');
      await waitForTestId('creative-workbench');
      const summaryProjectRow = await findTestIdByAttribute(
        'workbench-project',
        'data-novel-id',
        task.novelId,
      );
      await summaryProjectRow.click();
      const summaryTaskRow = await findTestIdByAttribute(
        'workbench-task',
        'data-conversation-id',
        conversationId,
      );
      await summaryTaskRow.click();
      await waitForTestIdAttribute('workbench-task-header', 'data-conversation-id', conversationId);

      const summaryChapterSelect = await waitForTestId('workbench-chapter-select');
      if ((await summaryChapterSelect.getValue()) !== task.chapterId) {
        await summaryChapterSelect.selectByAttribute('value', task.chapterId);
      }
      expect(await summaryChapterSelect.getValue()).toBe(task.chapterId);

      const summaryFailureSelector =
        '[data-testid="workbench-summary-orchestration"][data-phase="failed"]';
      const composerFailureSelector = '[data-testid="workbench-composer-error"]';
      await browser.waitUntil(
        async () => {
          const orchestration = await browser.$(summaryFailureSelector);
          if (await orchestration.isExisting()) return true;
          const composerFailure = await browser.$(composerFailureSelector);
          return (
            (await composerFailure.isExisting()) &&
            (await composerFailure.getText()).includes('冻结模型快照 runtimeMode 必须是 api')
          );
        },
        {
          timeout: 30000,
          interval: 200,
          timeoutMsg: `Round ${task.round} 未显式呈现 Mock 总结的 pre-Run 失败`,
        },
      );
      const failureSignals: string[] = [];
      const summaryFailure = await browser.$(summaryFailureSelector);
      if (await summaryFailure.isExisting()) failureSignals.push(await summaryFailure.getText());
      const composerFailure = await browser.$(composerFailureSelector);
      if (await composerFailure.isExisting()) failureSignals.push(await composerFailure.getText());
      expect(failureSignals.join('\n')).toMatch(
        /章节总结启动失败，请重试|冻结模型快照 runtimeMode 必须是 api/,
      );

      const finalBundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
        conversationId,
      });
      expect(finalBundle?.conversation.status).toBe('idle');
      const finalSummaryTurns = finalBundle?.turns.filter((turn) => turn.turnId === summaryTurnId);
      expect(finalSummaryTurns).toHaveLength(1);
      expect(finalSummaryTurns?.[0].role).toBe('user');
      expect(finalSummaryTurns?.[0].content).toContain('总结本章');
      expect(finalBundle?.runs.map((run) => run.runId).sort()).toEqual(
        [generateRunId, revisionRunId].sort(),
      );
      expect(finalBundle?.runs.filter((run) => run.turnId === summaryTurnId)).toHaveLength(0);
      const finalChapterTextCards = finalBundle?.artifacts.filter(
        (card) => card.artifactType === 'chapter_text',
      );
      expect(finalChapterTextCards?.map((card) => card.artifactId).sort()).toEqual(
        [initialArtifactId, revisedArtifactId].sort(),
      );
      expect(
        finalBundle?.artifacts.filter((card) => card.artifactType === 'chapter_summary'),
      ).toHaveLength(0);
      expect(finalBundle?.artifacts).toHaveLength(2);
      expect(finalBundle?.decisions).toHaveLength(2);

      const formalSummary = await bridgeCall<unknown | null>('get_chapter_summary', {
        chapterId: task.chapterId,
      });
      expect(formalSummary).toBeNull();

      const chaptersAfterFailure = await bridgeCall<ChapterRecord[]>('get_chapters_by_novel_id', {
        novelId: task.novelId,
      });
      expect(chaptersAfterFailure.find((chapter) => chapter.id === task.chapterId)?.status).toBe(
        'adopted',
      );

      roundEvidence.push({
        round: task.round,
        novelKey: task.novelKey,
        novelId: task.novelId,
        chapterId: task.chapterId,
        chapterTitle: task.chapterTitle,
        conversationId,
        generateRunId: generateRunId!,
        revisionRunId: revisionRunId!,
        summaryTurnId,
        initialArtifactId: initialArtifactId!,
        revisedArtifactId: revisedArtifactId!,
        decisionId: authRecord!.decisionId,
        authorizationId,
        draftId: savedDraftId,
        adoptedDraftId: chapterInDb!.adoptedDraftId!,
        initialArtifactHash: initialArtifact.artifact.contentHash,
        revisedArtifactHash: revisedArtifact.artifact.contentHash,
        adoptedContentHash: sha256(modifiedText),
        restartVerified: false,
      });
    }

    expect(roundEvidence.length).toBe(5);

    // =========================================================================
    // 3. 进程完全重启与重启后一致性断言 (Process Restart Verification)
    // =========================================================================
    await assertCleanDiagnostics();
    const beforeState = await bridgeCall<E2eAgentClosedLoopState>(
      'get_e2e_agent_closed_loop_state',
    );
    const beforePid = beforeState.processId;
    expect(beforePid).toBeGreaterThan(0);

    await browser.reloadSession();
    await waitForTestId('app-shell');
    await waitForTestId('creative-workbench');

    const restartTarget = roundEvidence[roundEvidence.length - 1];
    const restartProjectRow = await findTestIdByAttribute(
      'workbench-project',
      'data-novel-id',
      restartTarget.novelId,
    );
    await restartProjectRow.click();
    const restartTaskRow = await findTestIdByAttribute(
      'workbench-task',
      'data-conversation-id',
      restartTarget.conversationId,
    );
    await restartTaskRow.click();
    await waitForTestIdAttribute(
      'workbench-task-header',
      'data-conversation-id',
      restartTarget.conversationId,
    );
    await browser.waitUntil(
      async () => {
        const orchestration = await browser.$(
          '[data-testid="workbench-summary-orchestration"][data-phase="failed"]',
        );
        if (await orchestration.isExisting()) return true;
        const composerFailure = await browser.$('[data-testid="workbench-composer-error"]');
        return (
          (await composerFailure.isExisting()) &&
          (await composerFailure.getText()).includes('冻结模型快照 runtimeMode 必须是 api')
        );
      },
      {
        timeout: 30000,
        interval: 200,
        timeoutMsg: '应用重启后未恢复 Mock 总结的 pre-Run 失败状态',
      },
    );

    const afterState = await bridgeCall<E2eAgentClosedLoopState>('get_e2e_agent_closed_loop_state');
    const afterPid = afterState.processId;
    expect(afterPid).toBeGreaterThan(0);
    expect(afterPid).not.toBe(beforePid);

    const expectedRounds = roundEvidence.length;
    const expectedRuns = expectedRounds * 2;
    // A cross-chapter revision may trigger one bounded integrity repair. The immutable
    // pre-repair artifact remains auditable without becoming a conversation card.
    const maximumRetainedRepairArtifacts = 1;
    expect({ ...afterState, processId: beforePid }).toEqual(beforeState);
    expect(afterState.conversationsCount).toBe(expectedRounds);
    expect(afterState.runsCount).toBe(expectedRuns);
    expect(afterState.resultArtifactsCount).toBeGreaterThanOrEqual(expectedRuns);
    expect(afterState.resultArtifactsCount).toBeLessThanOrEqual(
      expectedRuns + maximumRetainedRepairArtifacts,
    );
    expect(afterState.artifactDecisionsCount).toBe(expectedRounds * 2);
    expect(afterState.reviewAuthorizationsCount).toBe(expectedRounds);
    expect(afterState.consumedAuthorizationsCount).toBe(expectedRounds);
    expect(afterState.draftsCount).toBe(expectedRounds * 2);
    expect(afterState.chaptersCount).toBe(expectedRounds);
    expect(afterState.adoptedDraftsCount).toBe(expectedRounds);

    let persistedTurns = 0;
    let persistedRuns = 0;
    let persistedToolEvents = 0;
    let persistedCards = 0;
    let persistedDecisions = 0;
    let persistedAuthorizations = 0;

    for (const evidence of roundEvidence) {
      const bundle = await bridgeCall<TaskConversationBundle | null>('get_task_conversation', {
        conversationId: evidence.conversationId,
      });
      expect(bundle).toBeTruthy();
      expect(bundle?.conversation.conversationId).toBe(evidence.conversationId);
      expect(bundle?.conversation.novelId).toBe(evidence.novelId);
      expect(bundle?.conversation.status).toBe('idle');
      expect(bundle?.runs.map((run) => run.runId).sort()).toEqual(
        [evidence.generateRunId, evidence.revisionRunId].sort(),
      );
      expect(bundle?.runs.every((run) => run.status === 'completed')).toBe(true);
      expect(bundle?.turns.every((turn) => turn.conversationId === evidence.conversationId)).toBe(
        true,
      );
      const persistedSummaryTurns = bundle?.turns.filter(
        (turn) => turn.turnId === evidence.summaryTurnId,
      );
      expect(persistedSummaryTurns).toHaveLength(1);
      expect(persistedSummaryTurns?.[0].role).toBe('user');
      expect(persistedSummaryTurns?.[0].content).toContain('总结本章');
      expect(bundle?.runs.filter((run) => run.turnId === evidence.summaryTurnId)).toHaveLength(0);
      expect(bundle?.toolEvents.length).toBeGreaterThan(0);
      expect(
        bundle?.toolEvents.every(
          (event) =>
            [evidence.generateRunId, evidence.revisionRunId].includes(event.runId) &&
            event.status === 'succeeded' &&
            !event.error,
        ),
      ).toBe(true);
      const persistedChapterTextCards = bundle?.artifacts.filter(
        (card) => card.artifactType === 'chapter_text',
      );
      expect(persistedChapterTextCards?.map((card) => card.artifactId).sort()).toEqual(
        [evidence.initialArtifactId, evidence.revisedArtifactId].sort(),
      );
      const persistedChapterTextRunIds = new Set(
        persistedChapterTextCards?.map((card) => card.runId).filter(Boolean),
      );
      expect(
        bundle?.runs
          .filter((run) => persistedChapterTextRunIds.has(run.runId))
          .map((run) => run.runId)
          .sort(),
      ).toEqual([evidence.generateRunId, evidence.revisionRunId].sort());
      const persistedSummaryCards = bundle?.artifacts.filter(
        (card) => card.artifactType === 'chapter_summary',
      );
      expect(persistedSummaryCards).toHaveLength(0);
      expect(bundle?.artifacts).toHaveLength(2);
      expect(
        bundle?.artifacts.every((card) => card.conversationId === evidence.conversationId),
      ).toBe(true);

      const revisionDecision = bundle?.decisions.find(
        (item) =>
          item.artifactId === evidence.initialArtifactId && item.decision === 'request_revision',
      );
      const confirmationDecision = bundle?.decisions.find(
        (item) => item.decisionId === evidence.decisionId,
      );
      expect(bundle?.decisions).toHaveLength(2);
      expect(revisionDecision?.conversationId).toBe(evidence.conversationId);
      expect(revisionDecision?.actor).toBe('user');
      expect(revisionDecision?.targetId).toBe(evidence.chapterId);
      expect(confirmationDecision?.artifactId).toBe(evidence.revisedArtifactId);
      expect(confirmationDecision?.conversationId).toBe(evidence.conversationId);
      expect(confirmationDecision?.decision).toBe('confirm');
      expect(confirmationDecision?.actor).toBe('user');
      expect(confirmationDecision?.targetId).toBe(evidence.chapterId);

      const authorization = bundle?.authorizations.find(
        (item) => item.authorizationId === evidence.authorizationId,
      );
      expect(bundle?.authorizations).toHaveLength(1);
      expect(authorization?.decisionId).toBe(evidence.decisionId);
      expect(authorization?.artifactId).toBe(evidence.revisedArtifactId);
      expect(authorization?.novelId).toBe(evidence.novelId);
      expect(authorization?.chapterId).toBe(evidence.chapterId);
      expect(authorization?.status).toBe('consumed');
      expect(authorization?.consumedByDraftId).toBe(evidence.draftId);

      const initialArtifact = await bridgeCall<ResultArtifactBundle>('get_result_artifact', {
        input: { artifactId: evidence.initialArtifactId },
      });
      const revisedArtifact = await bridgeCall<ResultArtifactBundle>('get_result_artifact', {
        input: { artifactId: evidence.revisedArtifactId },
      });
      assertChapterArtifact(initialArtifact, {
        artifactId: evidence.initialArtifactId,
        novelId: evidence.novelId,
        chapterId: evidence.chapterId,
      });
      assertChapterArtifact(revisedArtifact, {
        artifactId: evidence.revisedArtifactId,
        novelId: evidence.novelId,
        chapterId: evidence.chapterId,
      });
      expect(initialArtifact.artifact.contentHash).toBe(evidence.initialArtifactHash);
      expect(revisedArtifact.artifact.contentHash).toBe(evidence.revisedArtifactHash);

      const chapters = await bridgeCall<ChapterRecord[]>('get_chapters_by_novel_id', {
        novelId: evidence.novelId,
      });
      const persistedChapter = chapters.find((chapter) => chapter.id === evidence.chapterId);
      expect(persistedChapter?.adoptedDraftId).toBe(evidence.adoptedDraftId);
      expect(persistedChapter?.status).toBe('adopted');
      const drafts = await bridgeCall<DraftSummary[]>('get_drafts_by_chapter_id', {
        chapterId: evidence.chapterId,
      });
      const adoptedDraft = drafts.find((draft) => draft.id === evidence.draftId);
      const placeholderDrafts = drafts.filter((draft) => draft.source === 'manual_placeholder');
      expect(drafts).toHaveLength(2);
      expect(placeholderDrafts).toHaveLength(1);
      expect(placeholderDrafts[0].novelId).toBe(evidence.novelId);
      expect(placeholderDrafts[0].chapterId).toBe(evidence.chapterId);
      expect(placeholderDrafts[0].content).toBe('');
      expect(placeholderDrafts[0].isAdopted).toBe(false);
      expect(adoptedDraft).toBeTruthy();
      expect(adoptedDraft?.novelId).toBe(evidence.novelId);
      expect(adoptedDraft?.chapterId).toBe(evidence.chapterId);
      expect(adoptedDraft?.source).toBe('user_edited');
      expect(adoptedDraft?.isAdopted).toBe(true);
      expect(sha256(adoptedDraft!.content)).toBe(evidence.adoptedContentHash);

      const persistedSummary = await bridgeCall<unknown | null>('get_chapter_summary', {
        chapterId: evidence.chapterId,
      });
      expect(persistedSummary).toBeNull();

      persistedTurns += bundle!.turns.length;
      persistedRuns += bundle!.runs.length;
      persistedToolEvents += bundle!.toolEvents.length;
      persistedCards += bundle!.artifacts.length;
      persistedDecisions += bundle!.decisions.length;
      persistedAuthorizations += bundle!.authorizations.length;
    }

    expect(persistedTurns).toBe(afterState.turnsCount);
    expect(persistedRuns).toBe(afterState.runsCount);
    expect(persistedToolEvents).toBe(afterState.toolEventsCount);
    expect(persistedCards).toBe(expectedRuns);
    expect(afterState.resultArtifactsCount - persistedCards).toBeLessThanOrEqual(
      maximumRetainedRepairArtifacts,
    );
    expect(persistedDecisions).toBe(afterState.artifactDecisionsCount);
    expect(persistedAuthorizations).toBe(afterState.reviewAuthorizationsCount);

    // 验证作品 A 的 3 个章节
    await openWorkspace(projectAId);
    for (const task of chapterTasks.filter((t) => t.novelKey === 'A')) {
      const chapterItem = await findTestIdByAttribute(
        'chapter-item',
        'data-chapter-id',
        task.chapterId,
      );
      await chapterItem.click();
      const ed = await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', task.chapterId);
      const text = await ed.getValue();
      expect(text).toContain(`Round ${task.round}`);
      expect(await ed.getAttribute('data-adopted')).toBe('true');

      const evidenceItem = roundEvidence.find((e) => e.chapterId === task.chapterId);
      if (evidenceItem) {
        evidenceItem.restartVerified = true;
      }
    }

    // 验证作品 B 的 2 个章节
    await openWorkspace(projectBId);
    for (const task of chapterTasks.filter((t) => t.novelKey === 'B')) {
      const chapterItem = await findTestIdByAttribute(
        'chapter-item',
        'data-chapter-id',
        task.chapterId,
      );
      await chapterItem.click();
      const ed = await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', task.chapterId);
      const text = await ed.getValue();
      expect(text).toContain(`Round ${task.round}`);
      expect(await ed.getAttribute('data-adopted')).toBe('true');

      const evidenceItem = roundEvidence.find((e) => e.chapterId === task.chapterId);
      if (evidenceItem) {
        evidenceItem.restartVerified = true;
      }
    }

    // 验证全部 5 轮跨重启验证通过
    expect(roundEvidence.every((e) => e.restartVerified)).toBe(true);

    // 写入机器证据文件
    const customArtifactsDir = process.env.AI_NOVEL_STUDIO_E2E_ARTIFACTS?.trim();
    if (!customArtifactsDir) {
      throw new Error('AI_NOVEL_STUDIO_E2E_ARTIFACTS is required for closed-loop evidence');
    }
    const evidenceDir = path.resolve(customArtifactsDir);
    if (!fs.existsSync(evidenceDir)) {
      fs.mkdirSync(evidenceDir, { recursive: true });
    }
    const evidenceFilePath = path.join(evidenceDir, 'closed-loop-evidence.json');
    fs.writeFileSync(
      evidenceFilePath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          plannerToolSelection: 'deterministic orchestration',
          externalLlmDecision: 'NOT RUN',
          beforeProcessId: beforePid,
          afterProcessId: afterPid,
          totalRounds: roundEvidence.length,
          adoptedChapters: roundEvidence.filter((round) => round.restartVerified).length,
          closedLoopState: {
            conversationCount: afterState.conversationsCount,
            turnCount: afterState.turnsCount,
            runCount: afterState.runsCount,
            toolEventCount: afterState.toolEventsCount,
            resultArtifactCount: afterState.resultArtifactsCount,
            artifactDecisionCount: afterState.artifactDecisionsCount,
            reviewGrantCount: afterState.reviewAuthorizationsCount,
            consumedReviewGrantCount: afterState.consumedAuthorizationsCount,
            draftCount: afterState.draftsCount,
            chapterCount: afterState.chaptersCount,
            adoptedDraftCount: afterState.adoptedDraftsCount,
          },
          rounds: roundEvidence.map(({ authorizationId, ...round }) => ({
            ...round,
            reviewGrantFingerprint: sha256(authorizationId),
          })),
        },
        null,
        2,
      ),
      'utf-8',
    );

    await assertCleanDiagnostics();
  });
});
