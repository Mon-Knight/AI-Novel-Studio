import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creativeAgentHarness } from './agentLoop';
import { agentToolExecutor } from './agentToolExecutor';
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

test('CreativeAgentHarness: 自然语言意图理解与工具自主选择', async () => {
  const novelId = 'novel-agent-intent-01';
  novelMemoryManager.reset(novelId);

  await novelMemoryManager.addMemoryFragment(novelId, {
    tier: 'long_term',
    type: 'world_rule',
    importance: 5,
    source: 'world_setting',
    content: '青云门严禁私斗。',
    relatedEntities: ['qingyun'],
  });

  const result = await creativeAgentHarness.run(
    '请查询当前小说的世界观规则与世界状态',
    { novelId },
  );

  assert.equal(result.status, 'completed');
  assert.ok(result.executionRecords.length >= 1);
  const worldRecord = result.executionRecords.find((r) => r.toolName === 'query_world_state');
  assert.ok(worldRecord);
  assert.equal(worldRecord.success, true);
  assert.ok(JSON.stringify(worldRecord.output).includes('青云门严禁私斗'));

  novelMemoryManager.reset(novelId);
});

test('CreativeAgentHarness: 角色动态心境查询与自主调度', async () => {
  const novelId = 'novel-agent-char-01';
  novelMemoryManager.reset(novelId);

  await novelMemoryManager.updateCharacterState(novelId, 'char-protagonist', {
    characterName: '林清玄',
    currentEmotion: '沉稳警惕',
    currentGoal: '破除封印',
  });

  const result = await creativeAgentHarness.run(
    '请查询主角当前的动态心境与伤势状态',
    { novelId },
  );

  assert.equal(result.status, 'completed');
  const charRecord = result.executionRecords.find((r) => r.toolName === 'query_character_state');
  assert.ok(charRecord);
  assert.equal(charRecord.success, true);
  const out = charRecord.output as Record<string, unknown>;
  assert.equal(out.characterName, '林清玄');
  assert.equal(out.currentEmotion, '沉稳警惕');

  novelMemoryManager.reset(novelId);
});

test('CreativeAgentHarness: 多步骤创作规划与工具链执行 (Scene -> Prose -> Quality Check)', async () => {
  const novelId = 'novel-agent-multistep-01';
  const chapterId = 'chap-agent-01';
  novelMemoryManager.reset(novelId);

  const thoughts: string[] = [];
  const toolStarts: string[] = [];

  const result = await creativeAgentHarness.run(
    '为第一章规划分镜并完成正文创作与质检',
    { novelId, chapterId },
    { maxTurns: 6 },
    {
      onThought: (t) => thoughts.push(t),
      onToolStart: (c) => toolStarts.push(c.name),
    },
  );

  assert.equal(result.status, 'completed');
  assert.ok(result.turns >= 2);
  assert.ok(result.executionRecords.length >= 2);
  assert.ok(toolStarts.includes('generate_scene_plan'));
  assert.ok(toolStarts.includes('generate_prose'));
  assert.ok(thoughts.length >= 2);
  assert.ok(result.finalResponse.length > 0);

  novelMemoryManager.reset(novelId);
});

test('CreativeAgentHarness: 工具执行失败时的自愈与安全恢复机制', async () => {
  const fakeToolCall = {
    id: 'call-err-01',
    name: 'non_existent_tool',
    arguments: { invalid: true },
  };

  const context = {
    messages: [],
    executionRecords: [],
    status: 'idle' as const,
  };

  const record = await agentToolExecutor.execute(fakeToolCall, context);
  assert.equal(record.success, false);
  assert.ok(record.error?.includes('not found in AgentToolRegistry'));

  const result = await creativeAgentHarness.run('执行不存在的指令并进行自愈测试');
  assert.equal(result.status, 'completed');
  assert.ok(result.finalResponse.length > 0);
});
