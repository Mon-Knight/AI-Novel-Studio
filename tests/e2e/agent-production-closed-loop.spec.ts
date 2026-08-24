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
  turns: Array<{ turnId: string; conversationId: string; role: string; runId?: string }>;
  runs: Array<{ runId: string; conversationId: string; status: string }>;
  toolEvents: Array<{ runId: string; toolName: string; status: string; error?: string }>;
  artifacts: Array<{
    cardId: string;
    conversationId: string;
    runId?: string;
    artifactId?: string;
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

    // 作品 B：包含 2 个独立章节 B1, B2
    await navigateHash('#/novels');
    const projectBId = await createProjectThroughUi('E2E Closed Loop Novel B');
    await openWorkspace(projectBId);
    const volumeBId = await createVolumeThroughUi('第一卷 星渊起航');
    const chapterB1Id = await createChapterThroughUi('第一章 深空跃迁', volumeBId);
    const chapterB2Id = await createChapterThroughUi('第二章 引擎危机', volumeBId);

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

      // 创建独立任务会话
      await clickTestId('workbench-create-task');
      const taskHeader = await waitForTestId('workbench-task-header');
      const conversationId = (await taskHeader.getAttribute('data-conversation-id'))!;
      expect(conversationId).toBeTruthy();

      // 切换/绑定目标章节
      const chapterSelect = await waitForTestId('workbench-chapter-select');
      await chapterSelect.selectByAttribute('value', task.chapterId);
      expect(await chapterSelect.getValue()).toBe(task.chapterId);

      // --- 第 1 步：生成初版 ---
      await fillTestId('workbench-composer-input', task.generatePrompt);
      const sendBtn = await waitForTestId('workbench-send-task');
      await sendBtn.waitForEnabled({ timeout: 30000 });
      await sendBtn.click();

      await browser.waitUntil(
        async () => {
          const cards = await browser.$$('[data-testid="workbench-artifact-card"]');
          return cards.length >= 1;
        },
        { timeout: 60000, timeoutMsg: '未能生成第一版章节候选卡片' },
      );
      await waitForTestIdAttribute(
        'workbench-conversation-status',
        'data-status',
        'completed',
        60000,
      );

      const genCards = (await browser.$$(
        '[data-testid="workbench-artifact-card"]',
      )) as unknown as Array<WebdriverIO.Element>;
      expect(genCards.length).toBeGreaterThanOrEqual(1);

      const firstCard = genCards[genCards.length - 1];
      const initialArtifactId = (await firstCard.getAttribute('data-artifact-id'))?.trim();
      expect(initialArtifactId).toBeTruthy();

      // --- 第 2 步：修改生成第二版 ---
      await fillTestId('workbench-composer-input', task.revisionPrompt);
      const secondSendBtn = await waitForTestId('workbench-send-task');
      await secondSendBtn.waitForEnabled({ timeout: 30000 });
      await secondSendBtn.click();

      await browser.waitUntil(
        async () => {
          const cards = await browser.$$('[data-testid="workbench-artifact-card"]');
          return cards.length >= 2;
        },
        { timeout: 60000, timeoutMsg: '未能生成修改后的第二版章节候选卡片' },
      );
      await waitForTestIdAttribute(
        'workbench-conversation-status',
        'data-status',
        'completed',
        60000,
      );

      const revCards = (await browser.$$(
        '[data-testid="workbench-artifact-card"]',
      )) as unknown as Array<WebdriverIO.Element>;
      expect(revCards.length).toBeGreaterThanOrEqual(2);

      const latestCard = revCards[revCards.length - 1];
      const revisedArtifactId = (await latestCard.getAttribute('data-artifact-id'))?.trim();
      expect(revisedArtifactId).toBeTruthy();
      expect(revisedArtifactId).not.toBe(initialArtifactId);

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
      expect(revisedArtifact.rawContent).toContain(initialArtifact.rawContent);

      const activeBundle = await bridgeCall<TaskConversationBundle | null>(
        'get_task_conversation',
        { conversationId },
      );
      expect(activeBundle?.runs).toHaveLength(2);
      const generateRunId = activeBundle?.artifacts.find(
        (card) => card.artifactId === initialArtifactId,
      )?.runId;
      const revisionRunId = activeBundle?.artifacts.find(
        (card) => card.artifactId === revisedArtifactId,
      )?.runId;
      expect(generateRunId).toBeTruthy();
      expect(revisionRunId).toBeTruthy();
      expect(generateRunId).not.toBe(revisionRunId);

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

      roundEvidence.push({
        round: task.round,
        novelKey: task.novelKey,
        novelId: task.novelId,
        chapterId: task.chapterId,
        chapterTitle: task.chapterTitle,
        conversationId,
        generateRunId: generateRunId!,
        revisionRunId: revisionRunId!,
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

    const afterState = await bridgeCall<E2eAgentClosedLoopState>('get_e2e_agent_closed_loop_state');
    const afterPid = afterState.processId;
    expect(afterPid).toBeGreaterThan(0);
    expect(afterPid).not.toBe(beforePid);

    const expectedRounds = roundEvidence.length;
    const expectedRuns = expectedRounds * 2;
    expect({ ...afterState, processId: beforePid }).toEqual(beforeState);
    expect(afterState.conversationsCount).toBe(expectedRounds);
    expect(afterState.runsCount).toBe(expectedRuns);
    expect(afterState.resultArtifactsCount).toBe(expectedRuns);
    expect(afterState.artifactDecisionsCount).toBe(expectedRounds);
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
      expect(bundle?.conversation.status).toBe('completed');
      expect(bundle?.runs.map((run) => run.runId).sort()).toEqual(
        [evidence.generateRunId, evidence.revisionRunId].sort(),
      );
      expect(bundle?.runs.every((run) => run.status === 'completed')).toBe(true);
      expect(bundle?.turns.every((turn) => turn.conversationId === evidence.conversationId)).toBe(
        true,
      );
      expect(bundle?.toolEvents.length).toBeGreaterThan(0);
      expect(
        bundle?.toolEvents.every(
          (event) =>
            [evidence.generateRunId, evidence.revisionRunId].includes(event.runId) &&
            event.status === 'succeeded' &&
            !event.error,
        ),
      ).toBe(true);
      expect(bundle?.artifacts.map((card) => card.artifactId).sort()).toEqual(
        [evidence.initialArtifactId, evidence.revisedArtifactId].sort(),
      );
      expect(
        bundle?.artifacts.every((card) => card.conversationId === evidence.conversationId),
      ).toBe(true);

      const decision = bundle?.decisions.find((item) => item.decisionId === evidence.decisionId);
      expect(bundle?.decisions).toHaveLength(1);
      expect(decision?.artifactId).toBe(evidence.revisedArtifactId);
      expect(decision?.conversationId).toBe(evidence.conversationId);
      expect(decision?.decision).toBe('confirm');
      expect(decision?.actor).toBe('user');
      expect(decision?.targetId).toBe(evidence.chapterId);

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
      expect(chapters.find((chapter) => chapter.id === evidence.chapterId)?.adoptedDraftId).toBe(
        evidence.adoptedDraftId,
      );
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
    expect(persistedCards).toBe(afterState.resultArtifactsCount);
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
