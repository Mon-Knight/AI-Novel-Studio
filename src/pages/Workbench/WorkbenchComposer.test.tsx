import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorkbenchAssetScopeSummary } from '../../services/conversation/workbenchAssetScopeService';
import type { TaskModelSnapshot } from '../../types/conversation';
import { WorkbenchComposer } from './WorkbenchComposer';

const MODEL: TaskModelSnapshot = {
  providerId: 'mock',
  modelId: 'Mock',
  runtimeMode: 'mock',
  capabilities: ['chat'],
  options: {},
  capturedAt: '2026-08-31T00:00:00.000Z',
};

function renderComposer(
  summary: WorkbenchAssetScopeSummary,
  hasChapter: boolean,
  overrides: Partial<Parameters<typeof WorkbenchComposer>[0]> = {},
): string {
  return renderToStaticMarkup(
    createElement(WorkbenchComposer, {
      templates: [],
      plugins: [],
      pluginsLoading: false,
      pluginsError: '',
      selectedModel: MODEL,
      draft: '',
      composerError: '',
      selectedConversationPreparing: false,
      selectedConversationRunning: false,
      selectedConversationArchived: false,
      hasTask: true,
      taskReady: true,
      hasChapter,
      chaptersLoading: false,
      contextPending: false,
      contextFailed: false,
      assetScope: summary,
      assetScopeLoading: false,
      assetScopeError: '',
      onDraftChange: () => undefined,
      onRetryModels: () => undefined,
      onOpenModelSettings: () => undefined,
      onCreateTaskWithCurrentModel: () => undefined,
      onSend: () => undefined,
      onCancel: () => undefined,
      onRefreshAssetScope: () => undefined,
      onOpenAssetScopePath: () => undefined,
      ...overrides,
    }),
  );
}

function openingTag(html: string, tag: string, testId: string): string {
  const match = html.match(new RegExp(`<${tag}[^>]*data-testid="${testId}"[^>]*>`, 'u'));
  assert.ok(match, `Expected ${tag} with data-testid="${testId}"`);
  return match[0];
}

test('composer keeps a positive 4/4 chapter core summary visible while asset details are folded', () => {
  const summary: WorkbenchAssetScopeSummary = {
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    items: [
      {
        key: 'world',
        group: 'foundation',
        label: '世界',
        value: '作品背景',
        status: 'fallback',
        required: true,
      },
      {
        key: 'rules',
        group: 'foundation',
        label: '规则',
        value: '回声法则',
        status: 'ready',
        required: true,
      },
      {
        key: 'protagonist',
        group: 'foundation',
        label: '主角',
        value: '林澈',
        status: 'ready',
        required: true,
      },
      {
        key: 'master_outline',
        group: 'structure',
        label: '全书大纲',
        value: '总纲',
        status: 'missing',
        required: false,
      },
      {
        key: 'chapter_outline',
        group: 'structure',
        label: '章节大纲',
        value: '第一章',
        status: 'ready',
        required: true,
      },
    ],
    requiredMissingCount: 0,
    unavailableCount: 0,
  };

  const html = renderComposer(summary, true);

  assert.match(html, /data-testid="workbench-core-asset-summary"/u);
  assert.match(html, /data-core-ready="4"/u);
  assert.match(html, /data-core-total="4"/u);
  assert.match(html, /核心 4\/4/u);
  assert.match(html, /workbench-asset-scope-core is-complete/u);
  assert.doesNotMatch(html, /<section[^>]+id="workbench-asset-scope-panel"/u);
});

test('composer preserves the missing badge and uses the project outline for project scope', () => {
  const summary: WorkbenchAssetScopeSummary = {
    novelId: 'novel-1',
    items: [
      {
        key: 'world',
        group: 'foundation',
        label: '世界',
        value: '雾港',
        status: 'ready',
        required: true,
      },
      {
        key: 'rules',
        group: 'foundation',
        label: '规则',
        value: '未准备',
        status: 'missing',
        required: true,
      },
      {
        key: 'protagonist',
        group: 'foundation',
        label: '主角',
        value: '林澈',
        status: 'ready',
        required: true,
      },
      {
        key: 'master_outline',
        group: 'structure',
        label: '全书大纲',
        value: '总纲',
        status: 'ready',
        required: false,
      },
      {
        key: 'chapter_outline',
        group: 'structure',
        label: '章节大纲',
        value: '未准备',
        status: 'missing',
        required: true,
      },
    ],
    requiredMissingCount: 1,
    unavailableCount: 0,
  };

  const html = renderComposer(summary, false);

  assert.match(html, /data-core-ready="3"/u);
  assert.match(html, /核心 3\/4/u);
  assert.match(html, /workbench-asset-scope-count[^>]*>1</u);
});

test('composer exposes preparation without locking or replacing the draft', () => {
  const summary: WorkbenchAssetScopeSummary = {
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    items: [],
    requiredMissingCount: 0,
    unavailableCount: 0,
  };
  const draft = '保留这段尚未发送的草稿';
  const html = renderComposer(summary, true, {
    templates: [
      {
        id: 'generate-chapter',
        label: '生成下一章',
        goal: '生成下一章',
        scope: 'chapter',
      },
    ],
    draft,
    selectedConversationPreparing: true,
  });

  assert.match(html, /data-composer-state="preparing"/u);
  assert.match(html, /data-testid="workbench-task-preparing"[^>]*>正在准备任务</u);

  const textarea = openingTag(html, 'textarea', 'workbench-composer-input');
  assert.doesNotMatch(textarea, /\sdisabled(?:=|\s|>)/u);
  assert.match(html, new RegExp(`>${draft}</textarea>`, 'u'));
  assert.match(openingTag(html, 'button', 'workbench-template-generate-chapter'), /\sdisabled/u);
  // Preparing freezes this run, not the task's lifetime; the selector remains visible but disabled.
  const modelSelector = openingTag(html, 'select', 'workbench-model-select');
  assert.match(modelSelector, /data-model-locked="true"/u);
  assert.match(modelSelector, /\sdisabled/u);
  assert.match(openingTag(html, 'button', 'workbench-send-task'), /\sdisabled/u);
  assert.doesNotMatch(html, /data-testid="workbench-stop-task"/u);
});

test('composer keeps Stop as the running-state action', () => {
  const summary: WorkbenchAssetScopeSummary = {
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    items: [],
    requiredMissingCount: 0,
    unavailableCount: 0,
  };
  const html = renderComposer(summary, true, {
    draft: '继续推进',
    selectedConversationRunning: true,
  });

  assert.match(html, /data-composer-state="running"/u);
  assert.match(html, /data-testid="workbench-stop-task"/u);
  assert.doesNotMatch(html, /data-testid="workbench-send-task"/u);
  assert.doesNotMatch(html, /data-testid="workbench-task-preparing"/u);
});

test('composer gives the chapter goal brief its own gutter and ties it to the textarea', () => {
  const summary: WorkbenchAssetScopeSummary = {
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    items: [],
    requiredMissingCount: 0,
    unavailableCount: 0,
  };
  const html = renderComposer(summary, true, {
    draft: '生成下一章',
    wordPreviewContext: {
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      chapterTarget: 3200,
    },
  });

  assert.match(html, /class="workbench-goal-brief"/u);
  assert.match(html, /data-testid="workbench-word-preview"[^>]*>写章目标 3200 字/u);
  assert.match(
    openingTag(html, 'textarea', 'workbench-composer-input'),
    /aria-describedby="workbench-goal-brief"/u,
  );
});

test('composer distinguishes model refresh from a failed model directory', () => {
  const summary: WorkbenchAssetScopeSummary = {
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    items: [],
    requiredMissingCount: 0,
    unavailableCount: 0,
  };
  const refreshing = renderComposer(summary, true, {
    pluginsLoading: true,
  });
  assert.match(refreshing, /data-status="refreshing"/u);
  assert.match(refreshing, /lucide-loader-circle/u);
  assert.doesNotMatch(refreshing, /data-status="unavailable"/u);

  const failed = renderComposer(summary, true, {
    pluginsError: 'Runtime 模型目录刷新失败',
  });
  assert.match(failed, /data-status="unavailable"/u);
  assert.match(failed, /lucide-circle-alert/u);
  assert.match(failed, /role="alert"/u);
  assert.match(failed, /aria-label="重试模型目录"/u);
  assert.match(failed, /aria-label="模型设置"/u);
});
