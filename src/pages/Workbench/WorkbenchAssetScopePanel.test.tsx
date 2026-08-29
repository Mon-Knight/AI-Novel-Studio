import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { WorkbenchAssetScopeSummary } from '../../services/conversation/workbenchAssetScopeService';
import { WorkbenchAssetScopePanel } from './WorkbenchAssetScopePanel';

test('asset scope panel renders safe source evidence without asset content or full hashes', () => {
  const summary: WorkbenchAssetScopeSummary = {
    novelId: 'novel-1',
    items: [
      {
        key: 'world',
        group: 'foundation',
        label: '世界',
        value: '雾港旧城',
        status: 'ready',
        required: true,
        evidence: {
          source: '正式世界设定',
          revision: '更新 2026-08-29',
          fingerprint: 'sha256:12345678...cdef',
        },
      },
      {
        key: 'memory_context',
        group: 'continuity',
        label: 'Memory',
        value: '按本轮指令检索',
        status: 'automatic',
        required: false,
      },
    ],
    requiredMissingCount: 0,
    unavailableCount: 0,
  };

  const html = renderToStaticMarkup(
    createElement(WorkbenchAssetScopePanel, {
      summary,
      loading: false,
      error: '',
      onRefresh: () => undefined,
      onOpen: () => undefined,
    }),
  );

  assert.match(html, /正式世界设定 · 更新 2026-08-29 · sha256:12345678\.\.\.cdef/u);
  assert.match(html, /可用创作上下文/u);
  assert.match(html, /核心上下文可用/u);
  assert.match(html, /运行时读取/u);
  assert.doesNotMatch(html, /本轮创作依据/u);
  assert.match(html, /Memory/u);
  assert.match(html, /按本轮指令检索/u);
  assert.doesNotMatch(html, /世界设定正文不应出现在面板/u);
  assert.doesNotMatch(html, /1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef/u);
});
