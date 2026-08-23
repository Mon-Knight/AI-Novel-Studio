import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creativeAgentHarness } from './agentLoop';
import { agentEvaluator } from './agentEvaluator';
import { novelMemoryManager } from '../memory/novelMemoryManager';
import { agentToolRegistry } from './agentToolRegistry';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

test('CreativeAgentHarness Autonomous Runtime: 复合多步骤自主创作与工具链闭环', async () => {
  const novelId = 'novel-auto-01';
  novelMemoryManager.reset(novelId);

  await novelMemoryManager.addMemoryFragment(novelId, {
    tier: 'long_term',
    type: 'world_rule',
    importance: 5,
    source: 'world_setting',
    content: '万剑归宗乃蜀山禁术。',
    relatedEntities: ['shushan'],
  });

  const taskUpdates: number[] = [];
  const evaluations: string[] = [];

  const result = await creativeAgentHarness.run(
    '完成第三章创作',
    { novelId, chapterId: 'chap-03' },
    { maxTurns: 8 },
    {
      onTaskStateUpdate: (state) => {
        taskUpdates.push(state.progressPercentage);
      },
      onEvaluation: (evaluation) => {
        evaluations.push(evaluation.critique);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.ok(result.executionRecords.length >= 3);
  assert.ok(result.taskState);
  assert.equal(result.taskState.goal, '完成第三章创作');
  assert.ok(result.taskState.completedSteps.includes('query_world_state'));
  assert.ok(result.taskState.completedSteps.includes('generate_scene_plan'));
  assert.ok(result.taskState.completedSteps.includes('generate_prose'));
  assert.ok(result.taskState.progressPercentage >= 75);
  assert.ok(evaluations.length >= 3);
  assert.ok(result.finalResponse.includes('完成'));

  novelMemoryManager.reset(novelId);
});

test('AgentEvaluator: 工具执行质量评估与目标反思', async () => {
  const context = {
    novelId: 'novel-eval-01',
    messages: [],
    executionRecords: [],
    status: 'evaluating' as const,
  };

  // 1. 成功生成正文评估
  const proseEval = agentEvaluator.evaluateToolResult(
    {
      callId: 'call-1',
      toolName: 'generate_prose',
      inputArgs: { chapterTitle: '第一章' },
      output: { prose: '夜色苍茫，剑气冲霄，主角拔剑出鞘。' },
      success: true,
      durationMs: 250,
    },
    context,
  );
  assert.equal(proseEval.isSatisfied, true);
  assert.equal(proseEval.needsRetry, false);
  assert.ok(proseEval.score >= 85);

  // 2. 空正文评估 -> 触发重试需求
  const emptyProseEval = agentEvaluator.evaluateToolResult(
    {
      callId: 'call-2',
      toolName: 'generate_prose',
      inputArgs: { chapterTitle: '第一章' },
      output: { prose: '' },
      success: true,
      durationMs: 100,
    },
    context,
  );
  assert.equal(emptyProseEval.isSatisfied, false);
  assert.equal(emptyProseEval.needsRetry, true);

  // 3. 工具报错评估 -> 触发重试需求
  const errorEval = agentEvaluator.evaluateToolResult(
    {
      callId: 'call-3',
      toolName: 'generate_scene_plan',
      inputArgs: {},
      output: null,
      success: false,
      error: '网络超时',
      durationMs: 50,
    },
    context,
  );
  assert.equal(errorEval.isSatisfied, false);
  assert.equal(errorEval.needsRetry, true);
  assert.equal(errorEval.score, 0);
});

test('CreativeAgentHarness Autonomous Runtime: 失败自适应恢复与重试机制', async () => {
  const novelId = 'novel-retry-01';
  let callCount = 0;

  // 临时注册一个首次失败但重试成功的工具
  agentToolRegistry.registerTool({
    descriptor: {
      name: 'flaky_writer_tool',
      description: '首次调用失败、重试后成功的模拟工具',
      parameters: { type: 'object', properties: {} },
    },
    execute: async (args) => {
      callCount += 1;
      if (callCount === 1 && !args.fallbackMode) {
        throw new Error('首次调用偶发故障');
      }
      return { success: true, recovered: true, callCount };
    },
  });

  const result = await creativeAgentHarness.run(
    '使用 flaky_writer_tool 创作',
    { novelId },
    { maxTurns: 4, enableAutoRecovery: true, maxRetries: 2 },
  );

  assert.equal(result.status, 'completed');
  assert.ok(result.executionRecords.length >= 1);
  novelMemoryManager.reset(novelId);
});
