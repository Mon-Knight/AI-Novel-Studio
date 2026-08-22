import assert from 'node:assert/strict';
import test from 'node:test';
import { novelMemoryManager } from './novelMemoryManager';

test('NovelMemoryManager creates and retrieves layered memory fragments', async () => {
  novelMemoryManager.reset('novel-test-01');

  // 添加长期记忆
  await novelMemoryManager.addMemoryFragment('novel-test-01', {
    tier: 'long_term',
    type: 'world_rule',
    importance: 5,
    source: 'world-rules',
    content: '本修仙界三大禁地之一为坠仙谷，元婴以下修士入内必被蚀骨罡风化去肉身。',
    relatedEntities: ['location-zhui-xian-gu'],
  });

  // 添加中期记忆
  await novelMemoryManager.addMemoryFragment('novel-test-01', {
    tier: 'mid_term',
    type: 'foreshadow',
    importance: 4,
    source: 'plot-arc-vol2',
    content: '主角在宗门大比中隐藏了天灵根资质，只有掌教暗中察觉。',
    relatedEntities: ['char-protagonist', 'char-sect-master'],
  });

  // 添加短期记忆
  await novelMemoryManager.addMemoryFragment('novel-test-01', {
    tier: 'short_term',
    type: 'scene_working',
    importance: 3,
    source: 'scene-011',
    content: '主角刚离开演武场，手中紧握一枚温热的残破玉简。',
    relatedEntities: ['char-protagonist', 'item-broken-jade'],
  });

  // 更新主角动态状态
  await novelMemoryManager.updateCharacterState('novel-test-01', 'char-protagonist', {
    characterName: '林清玄',
    currentEmotion: '表面平静，心神警惕',
    currentGoal: '回洞府参悟残破玉简中的上古功法',
    injuries: ['经脉微涩，灵力消耗四成'],
    lastKnownLocation: '青云宗演武场外小径',
  });

  // 检索场景记忆上下文
  const context = await novelMemoryManager.retrieveContext({
    novelId: 'novel-test-01',
    chapterId: 'chap-12',
    sceneId: 'scene-012',
    povCharacterId: 'char-protagonist',
    activeCharacterIds: ['char-protagonist'],
    maxMemoryTokens: 2000,
  });

  assert.equal(context.novelId, 'novel-test-01');
  assert.equal(context.sceneId, 'scene-012');
  assert.equal(context.povCharacter?.name, '林清玄');
  assert.equal(context.povCharacter?.dynamicState?.currentEmotion, '表面平静，心神警惕');
  assert.equal(context.longTermMemories.length, 1);
  assert.equal(context.longTermMemories[0].importance, 5);
  assert.equal(context.midTermMemories.length, 1);
  assert.equal(context.shortTermMemories.length, 1);
  assert.equal(context.tokenBudget?.totalBudget, 2000);

  novelMemoryManager.reset('novel-test-01');
});

test('NovelMemoryManager updates world state and creates versioned snapshots', async () => {
  novelMemoryManager.reset('novel-test-02');

  const v1 = await novelMemoryManager.updateWorldState('novel-test-02', {
    timelinePosition: '天元历 328 年·秋',
    worldRules: ['天道誓言不可违背'],
    activeEvents: ['魔宗异动'],
    factionStatus: { 天剑宗: '正常' },
  });

  assert.equal(v1.snapshotVersion, 1);
  assert.equal(v1.timelinePosition, '天元历 328 年·秋');

  const v2 = await novelMemoryManager.updateWorldState('novel-test-02', {
    timelinePosition: '天元历 328 年·冬',
    activeEvents: ['魔宗异动', '封山戒严'],
  });

  assert.equal(v2.snapshotVersion, 2);
  assert.equal(v2.timelinePosition, '天元历 328 年·冬');
  assert.equal(v2.activeEvents?.length, 2);

  const snapshot = await novelMemoryManager.createSnapshot('novel-test-02');
  assert.equal(snapshot.snapshotVersion, 2);

  novelMemoryManager.reset('novel-test-02');
});
