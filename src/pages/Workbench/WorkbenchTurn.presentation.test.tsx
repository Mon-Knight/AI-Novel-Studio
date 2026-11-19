import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TaskConversationBundle, TaskRun } from '../../types/conversation';
import { WorkbenchMessageStream } from './WorkbenchMessageStream';

const time = (second: number) => new Date(Date.UTC(2026, 8, 10, 0, 0, second)).toISOString();
const run: TaskRun = {
  runId: 'run-public',
  conversationId: 'conversation-public',
  turnId: 'user-public',
  status: 'failed',
  workerId: 'worker-public',
  createdAt: time(1),
  updatedAt: time(10),
  finishedAt: time(10),
  error: '本次工具失败',
  modelSnapshot: {
    providerId: 'mock',
    modelId: 'Mock',
    runtimeMode: 'mock',
    capabilities: [],
    options: {},
    capturedAt: time(1),
  },
};

test('rendered explanation, tool, error and candidate nodes retain ownership in replay order without duplicate user or error text', () => {
  const bundle: TaskConversationBundle = {
    conversation: {
      conversationId: run.conversationId,
      novelId: 'novel-public',
      title: '呈现顺序',
      status: 'failed',
      createdAt: time(0),
      updatedAt: time(10),
    },
    turns: [
      {
        turnId: run.turnId,
        conversationId: run.conversationId,
        role: 'user',
        sequence: 1,
        content: '原始要求只显示一次',
        createdAt: time(0),
      },
      Object.assign(
        {
          turnId: 'assistant-before',
          conversationId: run.conversationId,
          role: 'assistant' as const,
          sequence: 2,
          runId: run.runId,
          content: '先检查小说上下文',
          createdAt: time(2),
        },
        { reasoning: '不应显示的推理' },
      ),
      {
        turnId: 'assistant-after',
        conversationId: run.conversationId,
        role: 'assistant',
        sequence: 3,
        runId: run.runId,
        content: '已经保留这次候选',
        createdAt: time(8),
      },
    ],
    runs: [run],
    toolEvents: [
      {
        eventId: 'tool-public',
        runId: run.runId,
        sequence: 1,
        toolName: 'generate_chapter',
        argumentsSummary: {},
        status: 'failed',
        createdAt: time(3),
        finishedAt: time(6),
        error: '本次工具失败',
      },
    ],
    artifacts: [
      {
        cardId: 'card-public',
        conversationId: run.conversationId,
        turnId: run.turnId,
        runId: run.runId,
        artifactId: 'artifact-public',
        artifactType: 'chapter_text',
        title: '本次章节候选',
        summary: '候选已保留',
        status: 'candidate',
        createdAt: time(7),
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
  assert.deepEqual(
    [...html.matchAll(/data-presentation-id="([^"]+)"/g)].map((match) => match[1]),
    [
      'turn:user-public',
      'run:run-public',
      'turn:assistant-before',
      'tool:tool-public',
      'tool-error:tool-public',
      'artifact:card-public',
      'turn:assistant-after',
      'run-end:run-public',
    ],
  );
  assert.equal(html.split('原始要求只显示一次').length - 1, 1);
  assert.equal(html.split('本次工具失败').length - 1, 1);
  assert.doesNotMatch(html, /不应显示的推理/);
  assert.match(
    html,
    /data-presentation-id="artifact:card-public"[^>]*data-turn-id="user-public"[^>]*data-run-id="run-public"[^>]*data-run-attempt="1"/,
  );
  assert.match(html, /data-card-id="card-public"/);
  assert.match(html, /data-artifact-id="artifact-public"/);
});
