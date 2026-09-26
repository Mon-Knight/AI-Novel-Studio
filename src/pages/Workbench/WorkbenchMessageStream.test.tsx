import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TaskConversationBundle, TaskRun, ToolCallEvent } from '../../types/conversation';
import { ArtifactCard } from './WorkbenchComponents';
import { WorkbenchMessageStream } from './WorkbenchMessageStream';
import { resolveWorkbenchRevisionLineage } from './workbenchHelpers';
import {
  formatRunActivityAge,
  formatRunDuration,
  resolveWorkbenchRunProgress,
} from './workbenchRunProgress';

const run: TaskRun = {
  runId: 'run-long',
  conversationId: 'conversation-long',
  turnId: 'turn-long',
  status: 'running',
  modelSnapshot: {
    providerId: 'provider-safe',
    modelId: 'model-safe',
    runtimeMode: 'api',
    capabilities: [],
    options: {},
    capturedAt: '2026-08-29T01:00:00.000Z',
  },
  workerId: 'worker-safe',
  createdAt: '2026-08-29T01:00:00.000Z',
  startedAt: '2026-08-29T01:00:00.000Z',
  updatedAt: '2026-08-29T01:01:00.000Z',
};

const events: ToolCallEvent[] = [
  {
    eventId: 'event-read',
    runId: run.runId,
    sequence: 1,
    toolName: 'novel.read_context',
    argumentsSummary: {},
    status: 'succeeded',
    createdAt: '2026-08-29T01:00:05.000Z',
    finishedAt: '2026-08-29T01:00:10.000Z',
  },
  {
    eventId: 'event-generate',
    runId: run.runId,
    sequence: 2,
    toolName: 'generate_chapter',
    argumentsSummary: {},
    status: 'running',
    createdAt: '2026-08-29T01:01:30.000Z',
  },
];

test('run progress advances elapsed and last-activity age while preserving the current tool stage', () => {
  const firstNow = Date.parse('2026-08-29T01:02:00.000Z');
  const nextNow = Date.parse('2026-08-29T01:02:05.000Z');
  const first = resolveWorkbenchRunProgress(run, events, firstNow);
  const next = resolveWorkbenchRunProgress(run, events, nextNow);

  assert.equal(first.active, true);
  assert.equal(first.stage, '生成章节候选');
  assert.equal(formatRunDuration(first.elapsedMs), '2分00秒');
  assert.equal(formatRunActivityAge(first.lastActivityAtMs, firstNow), '30秒前');
  assert.equal(formatRunDuration(next.elapsedMs), '2分05秒');
  assert.equal(formatRunActivityAge(next.lastActivityAtMs, nextNow), '35秒前');
});

test('terminal run progress freezes at finishedAt instead of continuing to grow', () => {
  const completedRun: TaskRun = {
    ...run,
    status: 'completed',
    updatedAt: '2026-08-29T01:03:00.000Z',
    finishedAt: '2026-08-29T01:03:00.000Z',
  };
  const completedEvents = events.map((event) =>
    event.eventId === 'event-generate'
      ? {
          ...event,
          status: 'succeeded' as const,
          finishedAt: '2026-08-29T01:02:40.000Z',
          durationMs: 70_000,
        }
      : event,
  );
  const progress = resolveWorkbenchRunProgress(
    completedRun,
    completedEvents,
    Date.parse('2026-08-29T02:00:00.000Z'),
  );

  assert.equal(progress.active, false);
  assert.equal(progress.stage, '已完成');
  assert.equal(formatRunDuration(progress.elapsedMs), '3分00秒');
  assert.equal(progress.lastActivityAtMs, Date.parse('2026-08-29T01:03:00.000Z'));
});

test('message stream renders compact progress beside the run without creating another timeline', () => {
  const bundle: TaskConversationBundle = {
    conversation: {
      conversationId: run.conversationId,
      novelId: 'novel-safe',
      title: '长运行测试',
      status: 'running',
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
    turns: [
      {
        turnId: run.turnId,
        conversationId: run.conversationId,
        sequence: 1,
        role: 'user',
        content: '生成下一章',
        createdAt: run.createdAt,
      },
    ],
    runs: [run],
    toolEvents: events,
    artifacts: [],
  };
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-08-29T01:02:00.000Z');
  try {
    const html = renderToStaticMarkup(
      createElement(WorkbenchMessageStream, {
        bundle,
        compressionCandidate: null,
        compressionBusy: false,
        decisionBusyCardId: '',
        assetRecovery: null,
        assetReadinessBusy: false,
        selectedConversationRunning: true,
        chapterSummaryOrchestration: { phase: 'none' },
        onDismissCompression: () => undefined,
        onDecideArtifact: () => undefined,
        onRetry: () => undefined,
        onGenerateMissingAsset: () => undefined,
        onEditMissingAsset: () => undefined,
        onRefreshAssetReadiness: () => undefined,
        onResumeChapterGoal: () => undefined,
        onDismissAssetReadiness: () => undefined,
      }),
    );

    assert.match(html, /data-testid="workbench-run-progress"/);
    assert.match(html, /role="timer"/);
    assert.match(html, /当前阶段/);
    assert.match(html, /生成章节候选/);
    assert.match(html, /已用时 2分00秒/);
    assert.match(html, /最后活动 30秒前/);
    assert.match(html, /原始输入/);
    assert.doesNotMatch(html, /时间线/);
  } finally {
    Date.now = originalNow;
  }
});

test('message stream renders persisted artifacts that are not attached to a run', () => {
  const bundle: TaskConversationBundle = {
    conversation: {
      conversationId: run.conversationId,
      novelId: 'novel-safe',
      title: '上下文整理测试',
      status: 'idle',
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
    turns: [
      {
        turnId: 'turn-assistant-without-run',
        conversationId: run.conversationId,
        sequence: 1,
        role: 'assistant',
        content: '上下文整理候选已经生成。',
        createdAt: run.createdAt,
      },
    ],
    runs: [],
    toolEvents: [],
    artifacts: [
      {
        cardId: 'card-compression',
        conversationId: run.conversationId,
        artifactId: 'artifact-compression',
        artifactType: 'generic_json',
        title: '小说上下文压缩候选',
        summary: '保留人物、剧情和世界规则。',
        content: JSON.stringify({
          providerId: 'ans.novel-context.extractive-v1',
          version: '1.1.0',
          config: { tokenBudget: 4000 },
          novelId: 'novel-safe',
          sourceRevision: 'rev-1234abcd-2',
          compressedText: '压缩',
          coverage: {
            characters: { required: [], present: [], missing: [] },
            plot: { required: [], present: [], missing: [] },
            foreshadow: { required: [], present: [], missing: [] },
            timeline: { required: [], present: [], missing: [] },
            world: { required: [], present: [], missing: [] },
            rules: { required: [], present: [], missing: [] },
            outlines: { required: [], present: [], missing: [] },
            style: { required: [], present: [], missing: [] },
            output: { required: [], present: [], missing: [] },
            tokens: { budget: 4000, used: 2, withinBudget: true },
          },
          valid: true,
        }),
        status: 'candidate',
        createdAt: run.createdAt,
        artifactEvidence: {
          sourceNovelId: 'novel-safe',
          derivationType: 'context_compression',
          processingStatus: 'valid',
          validationIssues: [],
        },
      },
    ],
  };

  const html = renderToStaticMarkup(
    createElement(WorkbenchMessageStream, {
      bundle,
      compressionCandidate: null,
      compressionBusy: false,
      decisionBusyCardId: '',
      assetRecovery: null,
      assetReadinessBusy: false,
      selectedConversationRunning: false,
      chapterSummaryOrchestration: { phase: 'none' },
      onDismissCompression: () => undefined,
      onDecideArtifact: () => undefined,
      onRetry: () => undefined,
      onGenerateMissingAsset: () => undefined,
      onEditMissingAsset: () => undefined,
      onRefreshAssetReadiness: () => undefined,
      onResumeChapterGoal: () => undefined,
      onDismissAssetReadiness: () => undefined,
    }),
  );

  assert.match(html, /data-card-id="card-compression"/);
  assert.match(html, /小说上下文压缩候选/);
  assert.match(html, /保留人物、剧情和世界规则/);
  assert.match(html, /确定性小说上下文压缩/);
  assert.match(html, /本地确定性提取 · 不使用当前任务的冻结模型/);
  assert.match(html, /data-derivation-mode="deterministic-local"/);
  assert.match(html, /查看候选内容/);
  assert.doesNotMatch(html, />压缩</);
});

test('quality and style reports close as acknowledged decisions without domain apply', () => {
  for (const artifactType of ['quality_report', 'style_analysis'] as const) {
    const html = renderToStaticMarkup(
      createElement(ArtifactCard, {
        artifact: {
          cardId: `card-${artifactType}`,
          conversationId: run.conversationId,
          artifactId: `artifact-${artifactType}`,
          artifactType,
          title: artifactType === 'quality_report' ? '质量检查报告' : '风格分析报告',
          summary: '报告已经完成。',
          status: 'candidate',
          createdAt: run.createdAt,
        },
        onDecide: () => undefined,
      }),
    );

    assert.match(html, /data-testid="workbench-artifact-acknowledge"/);
    assert.match(html, /data-decision-kind="confirm"/);
    assert.match(html, />标记已阅</);
    assert.match(html, /仅记录报告已阅，不应用到小说正式事实/);
    assert.doesNotMatch(html, /data-testid="workbench-artifact-apply"/);
    assert.doesNotMatch(html, />应用到作品</);
  }
});

test('acknowledged quality report projects a neutral terminal state', () => {
  const html = renderToStaticMarkup(
    createElement(ArtifactCard, {
      artifact: {
        cardId: 'card-quality-acknowledged',
        conversationId: run.conversationId,
        artifactId: 'artifact-quality-acknowledged',
        artifactType: 'quality_report',
        title: '质量检查报告',
        summary: '报告已经阅读。',
        status: 'confirmed',
        createdAt: run.createdAt,
        latestDecision: {
          decisionId: 'decision-quality-acknowledged',
          artifactId: 'artifact-quality-acknowledged',
          artifactHash: 'hash-quality-acknowledged',
          cardId: 'card-quality-acknowledged',
          conversationId: run.conversationId,
          decision: 'confirm',
          idempotencyKey: 'card-quality-acknowledged:confirm',
          actor: 'user',
          targetType: 'asset',
          targetId: 'novel-safe',
          createdAt: run.createdAt,
        },
      },
      onDecide: () => undefined,
    }),
  );

  assert.match(html, /data-decision="confirm"/);
  assert.match(html, /workbench-artifact-status">已阅</);
  assert.doesNotMatch(html, /workbench-artifact-actions/);
});

test('artifact card defers failed content details until the disclosure is opened', () => {
  const html = renderToStaticMarkup(
    createElement(ArtifactCard, {
      artifact: {
        cardId: 'card-load-failed',
        conversationId: run.conversationId,
        artifactId: 'artifact-load-failed',
        artifactType: 'quality_report',
        title: '质量检查报告',
        summary: '报告投影已恢复。',
        contentLoadError: '候选内容读取失败，请重新读取当前任务产物。',
        status: 'candidate',
        createdAt: run.createdAt,
      },
      onReload: () => undefined,
    }),
  );

  assert.match(html, /查看候选内容/);
  assert.match(html, /role="alert"/);
  assert.match(html, /候选内容读取失败/);
  assert.match(html, />重新读取</);
  assert.doesNotMatch(html, /候选内容暂不可用/);
});

test('structured artifact cards separate local review marks from whole-artifact application', () => {
  const html = renderToStaticMarkup(
    createElement(ArtifactCard, {
      artifact: {
        cardId: 'card-characters',
        conversationId: run.conversationId,
        artifactId: 'artifact-characters',
        artifactType: 'character_candidates',
        title: '人物候选',
        summary: '生成了人物候选。',
        content: JSON.stringify({
          characters: [{ name: '林夏', roleType: 'protagonist', goal: '查明真相' }],
        }),
        status: 'candidate',
        createdAt: run.createdAt,
      },
      onDecide: () => undefined,
    }),
  );

  assert.match(html, /林夏/);
  assert.match(html, /查明真相/);
  assert.match(html, /原始数据/);
  assert.match(html, /type="checkbox"/);
  assert.doesNotMatch(html, /\schecked(?:=|\s|>)/);
  assert.match(html, /已审阅/);
  assert.match(html, /填写修订意见/);
  assert.match(html, />要求修改</);
  assert.doesNotMatch(html, /workbench-artifact-candidate-revise/);
  assert.match(html, /整份原始候选的全部内容/);
  assert.doesNotMatch(html, /查看候选内容/);
  assert.doesNotMatch(html, /<pre>/);
});

test('chapter summaries show readable paragraphs and chapter text keeps prose disclosure', () => {
  const summaryHtml = renderToStaticMarkup(
    createElement(ArtifactCard, {
      artifact: {
        cardId: 'card-summary',
        conversationId: run.conversationId,
        artifactId: 'artifact-summary',
        artifactType: 'chapter_summary',
        title: '章节总结候选',
        summary: '总结已生成。',
        content: JSON.stringify({
          summary: '主角在雨夜查明旧案。',
          nextChapterHook: '密信未拆。',
        }),
        status: 'candidate',
        createdAt: run.createdAt,
      },
    }),
  );
  const chapterHtml = renderToStaticMarkup(
    createElement(ArtifactCard, {
      artifact: {
        cardId: 'card-chapter',
        conversationId: run.conversationId,
        artifactId: 'artifact-chapter',
        artifactType: 'chapter_text',
        title: '章节正文候选',
        summary: '正文已生成。',
        content: JSON.stringify({ characters: [{ name: '不应当作候选项' }] }),
        status: 'candidate',
        createdAt: run.createdAt,
      },
    }),
  );

  assert.match(summaryHtml, /章节摘要/);
  assert.match(summaryHtml, /主角在雨夜查明旧案。/);
  assert.match(summaryHtml, /data-mode="paragraphs"/);
  assert.doesNotMatch(summaryHtml, /type="checkbox"/);
  assert.match(chapterHtml, /查看候选内容/);
  assert.doesNotMatch(chapterHtml, /不应当作候选项/);
  assert.doesNotMatch(chapterHtml, /原始数据/);
});

test('message stream groups contiguous successful reads while retaining public tool facts on expansion', () => {
  const readRun: TaskRun = {
    ...run,
    runId: 'run-read-group',
    conversationId: 'conversation-read-group',
    turnId: 'turn-read-group',
    status: 'completed',
    finishedAt: '2026-08-29T01:02:00.000Z',
  };
  const bundle: TaskConversationBundle = {
    conversation: {
      conversationId: 'conversation-read-group',
      novelId: 'novel-safe',
      title: '读取摘要',
      status: 'completed',
      createdAt: readRun.createdAt,
      updatedAt: readRun.updatedAt,
    },
    turns: [
      {
        turnId: readRun.turnId,
        conversationId: readRun.conversationId,
        sequence: 1,
        role: 'user',
        content: '读取上下文',
        createdAt: readRun.createdAt,
      },
    ],
    runs: [readRun],
    toolEvents: [
      {
        eventId: 'read-group-a',
        runId: readRun.runId,
        sequence: 1,
        toolName: 'novel.read_context',
        argumentsSummary: {},
        status: 'succeeded',
        durationMs: 210,
        createdAt: '2026-08-29T01:00:01.000Z',
        finishedAt: '2026-08-29T01:00:02.000Z',
      },
      {
        eventId: 'read-group-b',
        runId: readRun.runId,
        sequence: 2,
        toolName: 'structure.read',
        argumentsSummary: {},
        status: 'succeeded',
        durationMs: 320,
        createdAt: '2026-08-29T01:00:03.000Z',
        finishedAt: '2026-08-29T01:00:04.000Z',
      },
    ],
    artifacts: [],
  };
  const html = renderToStaticMarkup(
    createElement(WorkbenchMessageStream, {
      bundle,
      compressionCandidate: null,
      compressionBusy: false,
      decisionBusyCardId: '',
      assetRecovery: null,
      assetReadinessBusy: false,
      selectedConversationRunning: false,
      chapterSummaryOrchestration: { phase: 'none' },
      onDismissCompression: () => undefined,
      onDecideArtifact: () => undefined,
      onRetry: () => undefined,
      onGenerateMissingAsset: () => undefined,
      onEditMissingAsset: () => undefined,
      onRefreshAssetReadiness: () => undefined,
      onResumeChapterGoal: () => undefined,
      onDismissAssetReadiness: () => undefined,
    }),
  );
  assert.match(html, /data-testid="workbench-completed-read"/);
  assert.match(html, /已读取创作材料 · 2 项/);
  assert.match(html, /data-disclosure-key="completed-read:tool:read-group-a,tool:read-group-b"/);
  assert.match(html, /data-read-event-ids="tool:read-group-a,tool:read-group-b"/);
  assert.match(html, /data-event-id="read-group-a"/);
  assert.match(html, /data-event-id="read-group-b"/);
  assert.match(html, /210 ms/);
  assert.match(html, /320 ms/);
});

test('artifact card exposes identity, next step, load errors, and safe validation details', () => {
  const html = renderToStaticMarkup(
    createElement(ArtifactCard, {
      artifact: {
        cardId: 'card-visible-evidence',
        conversationId: run.conversationId,
        runId: run.runId,
        artifactId: 'artifact-visible-evidence',
        artifactType: 'outline',
        title: '章节大纲候选',
        summary: '候选摘要。',
        contentLoadError: '候选内容读取失败，请重新读取当前任务产物。',
        status: 'candidate',
        createdAt: run.createdAt,
        artifactEvidence: {
          sourceNovelId: 'novel-safe',
          sourceChapterId: 'chapter-safe',
          sourceDraftVersion: 7,
          baseContentHash: 'hash-visible-evidence',
          processingStatus: 'invalid',
          validationIssues: [
            {
              issueId: 'issue-visible-evidence',
              artifactId: 'artifact-visible-evidence',
              validationRunId: 'validation-visible-evidence',
              issueIndex: 0,
              severity: 'error',
              code: 'OUTLINE_SOURCE_MISMATCH',
              message: '章节来源与候选目标不一致。',
              jsonPath: '$.chapterId',
              detailsJson: { secret: 'must not render' },
              validatorVersion: 'test-validator',
              createdAt: run.createdAt,
            },
          ],
        },
      },
      candidateNumber: 3,
      sourceRun: run,
      onReload: () => undefined,
    }),
  );
  assert.match(html, /候选 03/);
  assert.match(html, /data-testid="workbench-artifact-target"[^>]*>目标：作品待恢复 · 章节待恢复</);
  assert.match(html, /data-testid="workbench-artifact-model"[^>]*>来源：model-safe</);
  const identity =
    html.match(/data-testid="workbench-artifact-identity"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.doesNotMatch(identity, /run-long/);
  assert.match(html, /基线：草稿 v7/);
  assert.match(html, /下一步：修复结构或来源问题后再处理/);
  assert.match(html, /role="alert"/);
  assert.match(html, /候选内容读取失败/);
  assert.match(html, /查看全部校验证据（1）/);
  assert.match(html, /OUTLINE_SOURCE_MISMATCH/);
  assert.match(html, /\$\.chapterId/);
  assert.doesNotMatch(html, /must not render/);
});

test('empty workbench introduces the author flow with examples without creating a run', () => {
  const bundle: TaskConversationBundle = {
    conversation: {
      conversationId: 'conversation-empty',
      novelId: 'novel-safe',
      title: '空任务',
      status: 'idle',
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    },
    turns: [],
    runs: [],
    toolEvents: [],
    artifacts: [],
  };
  const html = renderToStaticMarkup(
    createElement(WorkbenchMessageStream, {
      bundle,
      compressionCandidate: null,
      compressionBusy: false,
      decisionBusyCardId: '',
      assetRecovery: null,
      assetReadinessBusy: false,
      selectedConversationRunning: false,
      chapterSummaryOrchestration: { phase: 'none' },
      onDismissCompression: () => undefined,
      onDecideArtifact: () => undefined,
      onRetry: () => undefined,
      onGenerateMissingAsset: () => undefined,
      onEditMissingAsset: () => undefined,
      onRefreshAssetReadiness: () => undefined,
      onResumeChapterGoal: () => undefined,
      onDismissAssetReadiness: () => undefined,
    }),
  );
  assert.match(html, /开始你的创作任务/);
  assert.match(html, /描述方向 → 审阅必要候选 → 逐章采用/);
  assert.match(html, /生成下一章，延续当前悬念/);
  assert.match(html, /审计本章人物一致性/);
  assert.match(html, /完善后续大纲/);
  assert.match(html, /data-testid="workbench-intro-example"/);
  assert.doesNotMatch(html, /data-testid="workbench-run"/);
});

test('artifact header uses matched author names, parent candidate, and applied next step', () => {
  const html = renderToStaticMarkup(
    createElement(ArtifactCard, {
      artifact: {
        cardId: 'card-named',
        conversationId: run.conversationId,
        runId: run.runId,
        artifactId: 'artifact-named',
        artifactType: 'chapter_text',
        title: '修订后的章节',
        summary: '已应用。',
        status: 'confirmed',
        createdAt: run.createdAt,
        latestDecision: {
          decisionId: 'decision-applied',
          artifactId: 'artifact-named',
          artifactHash: 'hash-named',
          cardId: 'card-named',
          conversationId: run.conversationId,
          decision: 'request_apply',
          idempotencyKey: 'card-named:request_apply',
          actor: 'user',
          targetType: 'chapter',
          targetId: 'chapter-rain',
          applyTransactionId: 'tx-applied',
          createdAt: run.createdAt,
        },
        artifactEvidence: {
          sourceNovelId: 'novel-rain',
          sourceChapterId: 'chapter-rain',
          processingStatus: 'valid',
          validationIssues: [
            {
              issueId: 'issue-warning',
              artifactId: 'artifact-named',
              validationRunId: 'validation-named',
              issueIndex: 0,
              severity: 'warning',
              code: 'STYLE_HINT',
              message: '语气可再收一点。',
              validatorVersion: 'test-validator',
              createdAt: run.createdAt,
            },
          ],
        },
      },
      candidateNumber: 4,
      sourceRun: { ...run, chapterId: 'chapter-rain' },
      presentationContext: {
        novelId: 'novel-rain',
        novelTitle: '夜雨江湖',
        chapters: [{ id: 'chapter-rain', title: '第三章 雨夜' }],
      },
      parentCandidateNumber: 2,
      hasRevisionSource: true,
      onDecide: () => undefined,
    }),
  );
  assert.match(html, /候选 04/);
  assert.match(html, /目标：夜雨江湖 · 第三章 雨夜/);
  assert.match(html, /来源：model-safe/);
  assert.match(html, /修订自候选 02/);
  assert.match(html, /下一步：已应用到作品/);
  assert.match(html, /workbench-artifact-status">已应用</);
  assert.match(html, /语气可再收一点/);
  const identity =
    html.match(/data-testid="workbench-artifact-identity"[\s\S]*?<\/div>/)?.[0] ?? '';
  assert.match(identity, /夜雨江湖/);
  assert.doesNotMatch(identity, /novel-rain/);
  assert.doesNotMatch(identity, /run-long/);
  assert.doesNotMatch(html, /workbench-artifact-actions/);
});

test('missing presentation names stay neutral and never borrow the current chapter', () => {
  const html = renderToStaticMarkup(
    createElement(ArtifactCard, {
      artifact: {
        cardId: 'card-foreign',
        conversationId: run.conversationId,
        artifactId: 'artifact-foreign',
        artifactType: 'outline',
        title: '外源大纲',
        summary: '',
        status: 'candidate',
        createdAt: run.createdAt,
        artifactEvidence: {
          sourceNovelId: '11111111-1111-4111-8111-111111111111',
          sourceChapterId: '22222222-2222-4222-8222-222222222222',
          processingStatus: 'valid',
          validationIssues: [],
        },
      },
      candidateNumber: 1,
      presentationContext: {
        novelId: 'novel-safe',
        novelTitle: '当前打开的小说',
        chapters: [{ id: 'chapter-current', title: '当前章节' }],
      },
    }),
  );
  assert.match(html, /目标：作品待恢复 · 章节待恢复/);
  assert.doesNotMatch(html, /当前打开的小说/);
  assert.doesNotMatch(html, /当前章节/);
  assert.doesNotMatch(html, /11111111-1111-4111-8111-111111111111/);
  assert.match(html, /来源：来源模型待恢复/);
});

test('revision parent requires card, artifact and conversation identities to match together', () => {
  const numbers = new Map([
    ['card-parent', 2],
    ['card-other', 9],
  ]);
  const source = {
    conversationId: run.conversationId,
    novelId: 'novel-safe',
    cardId: 'card-parent',
    artifactId: 'artifact-parent',
    artifactHash: 'ab'.repeat(32),
    artifactType: 'chapter_text',
    title: '父候选',
  };
  const turns = [
    {
      turnId: run.turnId,
      conversationId: run.conversationId,
      sequence: 1,
      role: 'user' as const,
      content: '请修订',
      createdAt: run.createdAt,
      revisionSource: source,
    },
  ];
  const parentCard = {
    cardId: 'card-parent',
    conversationId: run.conversationId,
    artifactId: 'artifact-parent',
    artifactType: 'chapter_text' as const,
    title: '父候选',
    summary: '',
    status: 'candidate' as const,
    createdAt: run.createdAt,
  };
  assert.equal(
    resolveWorkbenchRevisionLineage({
      sourceRun: run,
      turns,
      artifacts: [parentCard],
      candidateNumbers: numbers,
    }).parentCandidateNumber,
    2,
  );
  assert.equal(
    resolveWorkbenchRevisionLineage({
      sourceRun: run,
      turns,
      artifacts: [{ ...parentCard, artifactId: 'artifact-other' }],
      candidateNumbers: numbers,
    }).parentCandidateNumber,
    undefined,
  );
  assert.equal(
    resolveWorkbenchRevisionLineage({
      sourceRun: run,
      turns,
      artifacts: [{ ...parentCard, cardId: 'card-other' }],
      candidateNumbers: numbers,
    }).parentCandidateNumber,
    undefined,
  );
  assert.equal(
    resolveWorkbenchRevisionLineage({
      sourceRun: run,
      turns,
      artifacts: [{ ...parentCard, conversationId: 'other-task' }],
      candidateNumbers: numbers,
    }).parentCandidateNumber,
    undefined,
  );
});
