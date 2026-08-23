import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creativeAgentHarness } from './agentLoop';
import { novelMemoryManager } from '../memory/novelMemoryManager';
import { chapterVersionService } from '../chapters/chapterVersionService';

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

test('CreativeAgentHarness E2E: 端到端自主章节生产全流程 (Observe -> Plan -> Act -> Evaluate -> Report)', async () => {
  const novelId = 'novel-e2e-story-01';
  const chapterId = 'chap-05';
  novelMemoryManager.reset(novelId);

  // 1. 初始化世界观与角色记忆
  await novelMemoryManager.addMemoryFragment(novelId, {
    tier: 'long_term',
    type: 'world_rule',
    importance: 5,
    source: 'world_setting',
    content: '遗迹内部压制神识感知，核心符文封印万古秘密。',
    relatedEntities: ['ruins', 'seal'],
  });

  await novelMemoryManager.updateCharacterState(novelId, 'char-protagonist', {
    characterName: '林清玄',
    currentEmotion: '冷静警惕',
    currentGoal: '探寻遗迹线索',
    faction: '青云门',
    lastKnownLocation: '遗迹入口',
  });

  const initialVersions = novelMemoryManager.listMemoryVersions(novelId);
  const initialVersionCount = initialVersions.length;

  const toolSequence: string[] = [];
  const evaluations: string[] = [];

  // 2. 模拟用户输入端到端创作指令
  const userInstruction = '完成第五章第一节，要求：主角进入遗迹，发现线索，但不能揭露最终秘密';

  const result = await creativeAgentHarness.run(
    userInstruction,
    { novelId, chapterId },
    { maxTurns: 10 },
    {
      onToolEnd: (record) => {
        toolSequence.push(record.toolName);
      },
      onEvaluation: (evalItem) => {
        evaluations.push(evalItem.critique);
      },
    },
  );

  // 3. 验证全生命周期闭环
  assert.equal(result.status, 'completed');
  assert.ok(result.executionRecords.length >= 7);

  // 验证 7 阶段工具链均被自主调用
  assert.ok(toolSequence.includes('query_world_state'), '必须包含查询世界状态');
  assert.ok(toolSequence.includes('query_character_state'), '必须包含查询人物心境');
  assert.ok(toolSequence.includes('generate_scene_plan'), '必须包含分镜规划');
  assert.ok(toolSequence.includes('generate_prose'), '必须包含正文生成');
  assert.ok(toolSequence.includes('quality_check'), '必须包含质量核验');
  assert.ok(toolSequence.includes('update_memory'), '必须包含记忆状态演化');
  assert.ok(toolSequence.includes('save_chapter_version'), '必须包含版本归档存证');

  // 4. 验证 Memory 版本增量与演进
  const updatedVersions = novelMemoryManager.listMemoryVersions(novelId);
  assert.ok(
    updatedVersions.length > initialVersionCount,
    '记忆层必须产生新的不可变版本快照',
  );

  const updatedChar = novelMemoryManager.getCharacterState(novelId, 'char-protagonist');
  assert.ok(updatedChar);
  assert.equal(updatedChar.currentEmotion, '机敏凝重');

  // 5. 验证版本系统（Chapter Version Revisions）
  const revisions = chapterVersionService.listRevisions(chapterId);
  assert.ok(revisions.length >= 1, '章节版本库必须落盘新 Revision');
  const latestRev = revisions[revisions.length - 1];
  assert.ok(latestRev.wordCount > 0, '正文字数必须大于 0');
  assert.equal(latestRev.isAdopted, true);
  assert.equal(latestRev.provenance.author, 'CreativeAgentHarness');

  // 6. 验证最终产物报告
  assert.ok(result.finalResponse.includes('创作任务完成报告'));
  assert.ok(result.finalResponse.includes('工具调度序列'));
  assert.ok(result.finalResponse.includes('模型与提供方'));
  assert.ok(result.finalResponse.includes('记忆层状态演变'));

  novelMemoryManager.reset(novelId);
});
