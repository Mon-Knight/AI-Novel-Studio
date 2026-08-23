import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toolSelectionEvaluator } from './toolSelectionEvaluator';
import { toolUsageMemory } from './toolUsageMemory';
import { creativeAgentHarness } from './agentLoop';
import { novelMemoryManager } from '../memory/novelMemoryManager';

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

test('ToolSelectionEvaluator: 工具选择准确度、冗余度与缺失度评估', () => {
  // 1. 正确匹配工具评估
  const optimalEval = toolSelectionEvaluator.evaluateSelection({
    userGoal: '查询主角林清玄的当前心境',
    selectedTool: 'query_character_state',
  });
  assert.equal(optimalEval.isOptimal, true);
  assert.ok(optimalEval.relevanceScore >= 90);
  assert.equal(optimalEval.unnecessaryToolScore, 0);
  assert.equal(optimalEval.missingToolScore, 0);
  assert.ok(optimalEval.overallScore >= 90);

  // 2. 无效/无关工具惩罚评估
  const irrelevantEval = toolSelectionEvaluator.evaluateSelection({
    userGoal: '查询主角林清玄的当前心境',
    selectedTool: 'generate_outline',
  });
  assert.equal(irrelevantEval.isOptimal, false);
  assert.ok(irrelevantEval.relevanceScore <= 30);
  assert.ok(irrelevantEval.unnecessaryToolScore > 0, '无关工具应产生冗余惩罚');
  assert.ok(irrelevantEval.overallScore < 50);

  // 3. 缺失前置工具时的评估与建议
  const missingPreEval = toolSelectionEvaluator.evaluateSelection({
    userGoal: '完成第五章正文创作',
    selectedTool: 'save_chapter_version',
    completedTools: ['query_world_state'],
  });
  assert.ok(missingPreEval.missingToolScore > 0, '未生成正文直接保存版本应产生缺失惩罚');
  assert.ok(missingPreEval.feedback.includes('generate_prose'), '反馈中应包含缺失前置工具提示');

  // 4. 全流程轨迹质量评估
  const perfectTrajectory = toolSelectionEvaluator.evaluateTrajectory(
    '完成第五章第一节创作',
    [
      'query_world_state',
      'query_character_state',
      'generate_scene_plan',
      'generate_prose',
      'quality_check',
      'update_memory',
      'save_chapter_version',
    ],
  );
  assert.equal(perfectTrajectory.isOptimal, true);
  assert.ok(perfectTrajectory.overallScore >= 90);

  const brokenTrajectory = toolSelectionEvaluator.evaluateTrajectory(
    '完成第五章第一节创作',
    ['query_world_state'],
  );
  assert.equal(brokenTrajectory.isOptimal, false);
  assert.ok(brokenTrajectory.missingToolScore > 50);
});

test('ToolUsageMemory: 成功案例沉淀与相似任务工具链推荐', () => {
  toolUsageMemory.clear();

  // 1. 记录新的成功轨迹
  const customGoal = '优化配角台词风格与性格特征';
  const customTools = ['query_character_state', 'generate_scene_plan', 'update_memory'];
  toolUsageMemory.recordExperience(customGoal, customTools, 96);

  // 2. 检索相似任务推荐
  const matched = toolUsageMemory.findSimilarExperiences('修改配角性格动态');
  assert.ok(matched.length >= 1, '应成功匹配到相似经验');
  assert.deepEqual(matched[0].toolSequence, customTools);

  // 3. 获取推荐工具链路
  const recommended = toolUsageMemory.getRecommendedToolTrajectory('调整人物性格与心境');
  assert.ok(recommended);
  assert.ok(recommended.includes('query_character_state'));
  assert.ok(recommended.includes('update_memory'));

  toolUsageMemory.clear();
});

test('CreativeAgentHarness: 历史经验驱动的人物性格调整闭环', async () => {
  const novelId = 'novel-tool-opt-01';
  novelMemoryManager.reset(novelId);
  toolUsageMemory.clear();

  await novelMemoryManager.updateCharacterState(novelId, 'char-protagonist', {
    characterName: '林清玄',
    currentEmotion: '迷茫犹豫',
    currentGoal: '寻找本心',
  });

  const executedTools: string[] = [];

  // 用户目标：修改人物性格
  const result = await creativeAgentHarness.run(
    '修改人物性格，让主角变得果决坚毅',
    { novelId },
    { maxTurns: 6 },
    {
      onToolEnd: (record) => {
        executedTools.push(record.toolName);
      },
    },
  );

  assert.equal(result.status, 'completed');
  assert.ok(executedTools.length >= 3);
  assert.equal(executedTools[0], 'query_character_state');
  assert.equal(executedTools[1], 'generate_scene_plan');
  assert.equal(executedTools[2], 'update_memory');

  // 验证记忆层角色状态已成功演进
  const char = novelMemoryManager.getCharacterState(novelId, 'char-protagonist');
  assert.ok(char);
  assert.equal(char.currentEmotion, '果决坚毅');

  // 验证决策记录中包含工具选择理由与历史参考
  assert.ok(result.decisionTraces.length >= 3);
  assert.ok(
    result.decisionTraces[0].decision.thought.includes('历史') ||
      result.decisionTraces[0].selectedToolReason?.includes('性格') ||
      result.decisionTraces[0].selectedToolReason?.includes('角色'),
  );

  novelMemoryManager.reset(novelId);
  toolUsageMemory.clear();
});
