import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TaskConversationBundle, TaskRun, ToolCallEvent } from '../../types/conversation';
import { ArtifactCard } from './WorkbenchComponents';
import { WorkbenchMessageStream } from './WorkbenchMessageStream';
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
  assert.doesNotMatch(html, /role="alert"/);
  assert.doesNotMatch(html, /候选内容读取失败/);
  assert.doesNotMatch(html, />重新读取</);
  assert.doesNotMatch(html, /候选内容正在载入/);
});
