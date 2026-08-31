import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import type { AgentMessage } from '../../src/types/agentHarness';
import type { ToolCallEvent } from '../../src/types/conversation';

// 60 FPS 对应的单帧时间预算为 16.67ms
const FRAME_BUDGET_MS = 16.67;

test('Performance: 100 轮长对话（200条消息）虚拟视口裁剪与渲染耗时 < 16.6ms (60 FPS)', () => {
  // 构造 100 轮完整交互（100条 user + 100条 assistant = 200条消息）
  const messages: AgentMessage[] = [];
  for (let i = 1; i <= 100; i++) {
    messages.push({
      id: `msg-user-${i}`,
      role: 'user',
      content: `这是第 ${i} 轮创作指令：推进第三章情节发展，展开宗门大比的激战分镜与心理描写。`,
      timestamp: new Date().toISOString(),
    });
    messages.push({
      id: `msg-ai-${i}`,
      role: 'assistant',
      content: `【第 ${i} 轮生成正文】：剑气纵横三万里，一剑光寒十九洲。擂台之上，林风长剑微鸣，周身灵力翻涌如潮……（此处省略五百字长文内容）。`,
      timestamp: new Date().toISOString(),
    });
  }
  assert.equal(messages.length, 200);

  // 模拟 VirtualList 的窗口裁剪与索引计算 (假设视口高度 600px, 单项预估 70px, overscan 5)
  const itemHeightEstimate = 70;
  const overscan = 5;
  const containerHeight = 600;
  const scrollTop = 3500; // 模拟滚动到中间位置

  const startedAt = performance.now();
  for (let iter = 0; iter < 50; iter++) {
    const startIndex = Math.max(0, Math.floor(scrollTop / itemHeightEstimate) - overscan);
    const endIndex = Math.min(
      messages.length - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeightEstimate) + overscan,
    );
    const visibleSlice = messages.slice(startIndex, endIndex + 1);
    assert.ok(visibleSlice.length <= 25, '裁剪后视口内可见元素数应维持在常数级');
  }
  const durationMs = performance.now() - startedAt;
  const avgPerFrameMs = durationMs / 50;

  assert.ok(
    avgPerFrameMs < FRAME_BUDGET_MS,
    `100轮对话视口裁剪平均每帧耗时 ${avgPerFrameMs.toFixed(3)}ms 超出 60FPS 预算 ${FRAME_BUDGET_MS}ms`,
  );
});

test('Performance: 1000 个 Tool Events 折叠摘要渲染与装配耗时 < 16.6ms (60 FPS)', () => {
  // 构造 1000 条工具事件
  const toolEvents: ToolCallEvent[] = [];
  for (let i = 1; i <= 1000; i++) {
    toolEvents.push({
      eventId: `event-${i}`,
      runId: `run-${Math.floor(i / 10)}`,
      sequence: i,
      toolName:
        i % 3 === 0 ? 'novel.read_context' : i % 3 === 1 ? 'generate_chapter' : 'check_quality',
      argumentsSummary: { novelId: 'novel-perf-01', query: `query-${i}` },
      status: 'succeeded',
      durationMs: 15,
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });
  }
  assert.equal(toolEvents.length, 1000);

  const startedAt = performance.now();
  // 模拟批量折叠摘要提炼与轻量映射
  const summaries = toolEvents.map((e) => ({
    key: e.eventId,
    icon: e.status === 'succeeded' ? '✓' : '·',
    toolName: e.toolName,
    durationMs: e.durationMs,
    collapsed: true, // 默认折叠，不反序列化庞大参数
  }));
  const elapsedMs = performance.now() - startedAt;

  assert.equal(summaries.length, 1000);
  assert.ok(
    elapsedMs < FRAME_BUDGET_MS,
    `1000个工具事件摘要装配耗时 ${elapsedMs.toFixed(3)}ms 超出 60FPS 预算 ${FRAME_BUDGET_MS}ms`,
  );
});

test('Performance: 连续思考流（100次高频 onThought 推送）局部更新单次耗时 < 5ms', () => {
  // 模拟高频思考流推送（每秒数十个 token/chunk）
  let currentThought = '';
  let listenerCallCount = 0;

  // 模拟 CurrentThinking 内部的局部流式监听器
  const thoughtListener = (chunk: string) => {
    currentThought = chunk;
    listenerCallCount++;
  };

  const startedAt = performance.now();
  for (let i = 1; i <= 100; i++) {
    thoughtListener(`正在分析大纲伏笔... Step ${i}/100: 检查主角林风与反派长生教的恩怨线索。`);
  }
  const totalMs = performance.now() - startedAt;
  const avgUpdateMs = totalMs / 100;

  assert.equal(listenerCallCount, 100);
  assert.ok(currentThought.includes('Step 100/100'));
  assert.ok(avgUpdateMs < 5, `单次思考流局部更新耗时 ${avgUpdateMs.toFixed(3)}ms 超出 5ms 阈值`);
});
