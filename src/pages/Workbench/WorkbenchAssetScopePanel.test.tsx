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
        key: 'adopted_chapter',
        group: 'continuity',
        label: '前章采用稿',
        value: '《雾门初现》· v2 · 3,200 字',
        status: 'ready',
        required: false,
        evidence: {
          source: '紧邻前章正式采用稿',
          revision: 'v2 · 更新 2026-08-29',
          fingerprint: 'sha256:abcdef12...7890',
        },
      },
      {
        key: 'context_record',
        group: 'continuity',
        label: 'Context',
        value: '前章总结 1 条 · 正式记录 2 条',
        status: 'ready',
        required: false,
        evidence: {
          source: '章节总结 + 正式 ContextRecord',
          revision: '3 条候选来源 · 更新 2026-08-29',
        },
      },
      {
        key: 'memory_context',
        group: 'continuity',
        label: 'Memory',
        value: '活动文档 3 条 · 本轮按指令检索',
        status: 'ready',
        required: false,
        evidence: {
          source: 'SQLite Memory 活动文档索引',
          revision: '3 条活动文档 · 更新 2026-08-29',
        },
      },
      {
        key: 'world_state',
        group: 'continuity',
        label: '世界状态',
        value: '覆盖前序 1 章 · 总结 1 / Context 1',
        status: 'ready',
        required: false,
        evidence: {
          source: '已采用章节总结 + 正式 ContextRecord 投影',
          revision: '最近章节 chapter-0 · 更新 2026-08-29',
        },
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
  assert.match(html, /生成前资产状态/u);
  assert.match(html, /核心上下文可用/u);
  assert.match(html, /发送前预览/u);
  assert.match(html, /不代表本轮已经冻结或注入/u);
  assert.match(html, /data-context-stage="preflight-preview"/u);
  assert.doesNotMatch(html, /本轮创作依据/u);
  assert.match(html, /《雾门初现》· v2 · 3,200 字/u);
  assert.match(html, /前章总结 1 条 · 正式记录 2 条/u);
  assert.match(html, /Memory/u);
  assert.match(html, /活动文档 3 条 · 本轮按指令检索/u);
  assert.match(html, new RegExp('覆盖前序 1 章 · 总结 1 / Context 1', 'u'));
  assert.match(html, /紧邻前章正式采用稿 · v2 · 更新 2026-08-29/u);
  assert.match(html, /SQLite Memory 活动文档索引/u);
  assert.doesNotMatch(html, /生成前核验正式采用状态/u);
  assert.doesNotMatch(html, /按目标章节读取正式记录/u);
  assert.doesNotMatch(html, /由已采用总结与 Context 投影/u);
  assert.doesNotMatch(html, /世界设定正文不应出现在面板/u);
  assert.doesNotMatch(html, /1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef/u);
});
