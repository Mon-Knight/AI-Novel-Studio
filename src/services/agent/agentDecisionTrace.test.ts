import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creativeAgentHarness } from './agentLoop';
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

test('AgentDecisionTrace: 决策质量追踪与工具选择理由记录', async () => {
  const novelId = 'novel-decision-01';
  novelMemoryManager.reset(novelId);

  await novelMemoryManager.updateCharacterState(novelId, 'char-protagonist', {
    characterName: '林清玄',
    currentEmotion: '沉稳警惕',
    currentGoal: '探查禁地线索',
  });

  const capturedTraces: unknown[] = [];

  const result = await creativeAgentHarness.run(
    '请查询主角的心境与目标',
    { novelId },
    { maxTurns: 4 },
    {
      onDecisionTrace: (trace) => {
        capturedTraces.push(trace);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.ok(result.decisionTraces.length >= 1, '必须生成 Decision Trace 记录');
  assert.equal(capturedTraces.length, result.decisionTraces.length);

  const firstTrace = result.decisionTraces[0];
  assert.equal(firstTrace.turn, 1);
  assert.equal(firstTrace.selectedTool, 'query_character_state');
  assert.ok(firstTrace.selectedToolReason, '必须包含工具选择原因');
  assert.ok(
    firstTrace.selectedToolReason.includes('心理') ||
      firstTrace.selectedToolReason.includes('角色') ||
      firstTrace.selectedToolReason.includes('主角'),
    '选择理由应包含角色心理或状态说明',
  );
  assert.ok(firstTrace.expectedOutcome, '必须包含预期产出');
  assert.ok(typeof firstTrace.confidenceScore === 'number' && firstTrace.confidenceScore > 0.8);
  assert.ok(firstTrace.toolSuccess === true, '工具执行状态必须被记录');
  assert.ok(firstTrace.toolResult, '工具执行结果必须被记录');
  assert.ok(firstTrace.nextAdjustment, '必须记录下一步调整');

  novelMemoryManager.reset(novelId);
});

test('AgentDecisionTrace: 多轮复合任务决策链与自适应调整审计', async () => {
  const novelId = 'novel-decision-multi-01';
  novelMemoryManager.reset(novelId);

  const result = await creativeAgentHarness.run(
    '完成第五章第一节',
    { novelId, chapterId: 'chap-05' },
    { maxTurns: 10 },
  );

  assert.equal(result.status, 'completed');
  assert.ok(result.decisionTraces.length >= 7, '全流程 7 步必须产生完整的决策追踪链条');

  // 验证第 1 轮感知决策
  const trace1 = result.decisionTraces[0];
  assert.equal(trace1.selectedTool, 'query_world_state');
  assert.ok(trace1.selectedToolReason?.includes('世界规则') || trace1.selectedToolReason?.includes('设定'));

  // 验证第 2 轮人物决策
  const trace2 = result.decisionTraces[1];
  assert.equal(trace2.selectedTool, 'query_character_state');
  assert.ok(trace2.selectedToolReason?.includes('心理状态') || trace2.selectedToolReason?.includes('主角'));

  // 验证第 3 轮分镜决策
  const trace3 = result.decisionTraces[2];
  assert.equal(trace3.selectedTool, 'generate_scene_plan');
  assert.ok(trace3.selectedToolReason?.includes('冲突') || trace3.selectedToolReason?.includes('分镜'));

  // 验证第 4 轮正文决策
  const trace4 = result.decisionTraces[3];
  assert.equal(trace4.selectedTool, 'generate_prose');
  assert.ok(trace4.selectedToolReason?.includes('正文'));

  // 验证第 5 轮质检决策
  const trace5 = result.decisionTraces[4];
  assert.equal(trace5.selectedTool, 'quality_check');
  assert.ok(trace5.selectedToolReason?.includes('检验') || trace5.selectedToolReason?.includes('质量'));

  // 验证置信度均符合高质量阈值
  for (const trace of result.decisionTraces) {
    if (trace.selectedTool) {
      assert.ok(trace.confidenceScore && trace.confidenceScore >= 0.85);
    }
  }

  novelMemoryManager.reset(novelId);
});

test('AgentDecisionTrace: 失败重试时的决策原因与参数自愈调整记录', async () => {
  let callCount = 0;
  agentToolRegistry.registerTool({
    descriptor: {
      name: 'flaky_decision_tool',
      description: '测试失败恢复的决策工具',
      parameters: {
        type: 'object',
        properties: {
          novelId: { type: 'string', description: '作品 ID' },
        },
      },
    },
    execute: async (args) => {
      callCount += 1;
      if (callCount === 1) {
        throw new Error('网络波动或超时');
      }
      return { success: true, retryWorked: Boolean(args.fallbackMode) };
    },
  });

  const result = await creativeAgentHarness.run(
    '使用 flaky_writer_tool 创作',
    { novelId: 'novel-retry-trace-01' },
    { maxTurns: 5, maxRetries: 2 },
  );

  assert.equal(result.status, 'completed');
  assert.ok(result.decisionTraces.length >= 2, '必须记录失败与自适应重试的决策追踪');

  const failedTrace = result.decisionTraces.find((t) => t.toolSuccess === false);
  assert.ok(failedTrace, '必须捕获工具失败的决策 Trace');
  assert.ok(
    failedTrace.nextAdjustment?.includes('重试') || failedTrace.nextAdjustment?.includes('调整'),
    '失败 Trace 必须记录重试或调整建议',
  );

  agentToolRegistry.unregisterTool('flaky_decision_tool');
});
