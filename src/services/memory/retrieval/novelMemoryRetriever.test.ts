import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatSceneMemoryForCompilation,
  NovelMemoryRetriever,
} from './novelMemoryRetriever';
import { novelMemoryManager } from '../novelMemoryManager';
import type {
  CharacterDynamicState,
  MemoryFragment,
  MemoryRetrievalQuery,
} from '../../../types/novelMemory';

test('NovelMemoryRetriever retrieves POV and active characters with dynamic states', () => {
  const retriever = new NovelMemoryRetriever();

  const fragments: MemoryFragment[] = [
    {
      id: 'mem-1',
      tier: 'long_term',
      type: 'world_rule',
      importance: 5,
      source: 'world',
      content: '天元大陆灵气衰退，金丹修士百年难得一见。',
      relatedEntities: [],
      createdAt: '2026-08-23T00:00:00Z',
    },
    {
      id: 'mem-2',
      tier: 'mid_term',
      type: 'character_state',
      importance: 4,
      source: 'char-lin',
      content: '林清玄暗中炼化了噬魂幡，对正道心生芥蒂。',
      relatedEntities: ['char-lin'],
      createdAt: '2026-08-23T00:00:00Z',
    },
  ];

  const characterStates = new Map<string, CharacterDynamicState>([
    [
      'char-lin',
      {
        characterId: 'char-lin',
        characterName: '林清玄',
        currentEmotion: '表面温和，眼底杀机隐现',
        currentGoal: '刺探丹阁守卫换防规律',
        injuries: ['右臂经脉闭塞'],
        faction: '青云宗内门',
        stateVersion: 3,
        updatedAt: '2026-08-23T00:00:00Z',
      },
    ],
    [
      'char-yue',
      {
        characterId: 'char-yue',
        characterName: '岳凌峰',
        currentEmotion: '心烦气躁',
        currentGoal: '追查失窃的筑基丹',
        faction: '戒律堂',
        stateVersion: 1,
        updatedAt: '2026-08-23T00:00:00Z',
      },
    ],
  ]);

  const query: MemoryRetrievalQuery = {
    novelId: 'novel-001',
    chapterId: 'chap-05',
    sceneId: 'scene-002',
    povCharacterId: 'char-lin',
    activeCharacterIds: ['char-lin', 'char-yue'],
    scenePlotGoal: '林清玄在月下小径偶遇岳凌峰并巧妙周旋',
    maxMemoryTokens: 1000,
  };

  const context = retriever.retrieve(query, {
    fragments,
    characterStates,
    previousSceneSummary: '林清玄刚刚销毁了现场残留的符灰。',
    constraints: ['不可在此处暴露魔功痕迹'],
  });

  assert.equal(context.novelId, 'novel-001');
  assert.equal(context.sceneId, 'scene-002');
  assert.equal(context.povCharacter?.name, '林清玄');
  assert.equal(context.povCharacter?.dynamicState?.currentEmotion, '表面温和，眼底杀机隐现');
  assert.equal(context.activeCharacters.length, 2);
  assert.equal(context.activeCharacters[1].name, '岳凌峰');
  assert.equal(context.activeCharacters[1].dynamicState?.faction, '戒律堂');
  assert.equal(context.longTermMemories.length, 1);
  assert.equal(context.midTermMemories.length, 1);
  assert.equal(context.previousSceneSummary, '林清玄刚刚销毁了现场残留的符灰。');
  assert.equal(context.currentConflict, '林清玄在月下小径偶遇岳凌峰并巧妙周旋');
  assert.deepEqual(context.constraints, ['不可在此处暴露魔功痕迹']);
});

test('NovelMemoryRetriever filters out irrelevant low-importance memories', () => {
  const retriever = new NovelMemoryRetriever();

  const fragments: MemoryFragment[] = [
    {
      id: 'mem-relevant-entity',
      tier: 'mid_term',
      type: 'character_state',
      importance: 2,
      source: 'char-lin',
      content: '林清玄借了王师兄三枚下品灵石。',
      relatedEntities: ['char-lin'],
      createdAt: '2026-08-23T00:00:00Z',
    },
    {
      id: 'mem-high-importance-global',
      tier: 'long_term',
      type: 'world_rule',
      importance: 5,
      source: 'rules',
      content: '宗门夜间禁止私斗，违者废去修为。',
      relatedEntities: [],
      createdAt: '2026-08-23T00:00:00Z',
    },
    {
      id: 'mem-irrelevant-low',
      tier: 'mid_term',
      type: 'custom',
      importance: 2,
      source: 'char-passerby',
      content: '落日镇的铁匠换了一把新锤子。',
      relatedEntities: ['char-blacksmith'],
      createdAt: '2026-08-23T00:00:00Z',
    },
  ];

  const characterStates = new Map<string, CharacterDynamicState>();

  const query: MemoryRetrievalQuery = {
    novelId: 'novel-001',
    sceneId: 'scene-002',
    povCharacterId: 'char-lin',
    maxMemoryTokens: 1000,
  };

  const context = retriever.retrieve(query, {
    fragments,
    characterStates,
  });

  // 关联实体或重要度高的被保留
  const allIds = [
    ...context.longTermMemories,
    ...context.midTermMemories,
    ...context.shortTermMemories,
  ].map((f) => f.id);

  assert.ok(allIds.includes('mem-relevant-entity'), '实体相关的记忆应该被召回');
  assert.ok(allIds.includes('mem-high-importance-global'), '重要度5的全局规则应该被召回');
  assert.ok(!allIds.includes('mem-irrelevant-low'), '低重要度且无实体关联的碎片应该被过滤');
});

test('NovelMemoryRetriever truncates memories within strict Token budget', () => {
  const retriever = new NovelMemoryRetriever();

  const fragments: MemoryFragment[] = [
    {
      id: 'rule-core',
      tier: 'long_term',
      type: 'world_rule',
      importance: 5,
      source: 'world',
      content: '禁忌一：不可在月圆之夜动用神识。',
      relatedEntities: [],
      estimatedTokens: 30,
      createdAt: '2026-08-23T00:00:00Z',
    },
    {
      id: 'rule-secondary',
      tier: 'long_term',
      type: 'world_rule',
      importance: 3,
      source: 'world',
      content: '宗门后山有三只看门灵兽，喜食赤阳草。' + 'x'.repeat(200),
      relatedEntities: [],
      estimatedTokens: 300,
      createdAt: '2026-08-23T00:00:00Z',
    },
  ];

  const query: MemoryRetrievalQuery = {
    novelId: 'novel-001',
    sceneId: 'scene-001',
    maxMemoryTokens: 200, // 紧凑预算
  };

  const context = retriever.retrieve(query, {
    fragments,
    characterStates: new Map(),
  });

  assert.ok(context.tokenBudget!.totalBudget <= 200);
  assert.equal(context.longTermMemories.length, 1);
  assert.equal(context.longTermMemories[0].id, 'rule-core');
});

test('formatSceneMemoryForCompilation produces structured prompt sections', () => {
  const formatted = formatSceneMemoryForCompilation({
    novelId: 'novel-001',
    sceneId: 'scene-001',
    povCharacter: {
      id: 'char-lin',
      name: '林清玄',
      dynamicState: {
        characterId: 'char-lin',
        characterName: '林清玄',
        currentEmotion: '戒备',
        currentGoal: '脱身',
        injuries: ['气血翻涌'],
        stateVersion: 1,
        updatedAt: '2026-08-23T00:00:00Z',
      },
    },
    activeCharacters: [
      {
        id: 'char-lin',
        name: '林清玄',
      },
      {
        id: 'char-yue',
        name: '岳凌峰',
        dynamicState: {
          characterId: 'char-yue',
          characterName: '岳凌峰',
          currentEmotion: '猜疑',
          faction: '戒律堂',
          stateVersion: 1,
          updatedAt: '2026-08-23T00:00:00Z',
        },
      },
    ],
    longTermMemories: [
      {
        id: 'mem-1',
        tier: 'long_term',
        type: 'world_rule',
        importance: 5,
        source: 'world',
        content: '宗门内严禁杀戮同门。',
        relatedEntities: [],
        createdAt: '2026-08-23T00:00:00Z',
      },
    ],
    midTermMemories: [
      {
        id: 'mem-2',
        tier: 'mid_term',
        type: 'plot_arc',
        importance: 4,
        source: 'vol1',
        content: '第一卷大目标：隐藏身份夺得小比前十。',
        relatedEntities: [],
        createdAt: '2026-08-23T00:00:00Z',
      },
    ],
    shortTermMemories: [
      {
        id: 'mem-3',
        tier: 'short_term',
        type: 'scene_working',
        importance: 3,
        source: 'scene-prev',
        content: '脚步声从竹林西侧逼近。',
        relatedEntities: [],
        createdAt: '2026-08-23T00:00:00Z',
      },
    ],
    previousSceneSummary: '林清玄刚藏匿好染血的夜行衣。',
    currentConflict: '岳凌峰突然出现在竹林小道拦截盘问',
    constraints: ['本场对白必须暗藏交锋，不可直接翻脸'],
  });

  assert.ok(formatted.includes('【出场人物与动态心境】'));
  assert.ok(formatted.includes('林清玄 | 心境: 戒备 | 动机: 脱身 | 状态: 气血翻涌'));
  assert.ok(formatted.includes('岳凌峰 | 情绪: 猜疑 | 阵营: 戒律堂'));
  assert.ok(formatted.includes('【场景剧情冲突与前序衔接】'));
  assert.ok(formatted.includes('岳凌峰突然出现在竹林小道拦截盘问'));
  assert.ok(formatted.includes('【长期记忆与世界规则】'));
  assert.ok(formatted.includes('宗门内严禁杀戮同门'));
  assert.ok(formatted.includes('【中期记忆与阶段态势】'));
  assert.ok(formatted.includes('第一卷大目标'));
  assert.ok(formatted.includes('【短期工作记忆】'));
  assert.ok(formatted.includes('脚步声从竹林西侧逼近'));
  assert.ok(formatted.includes('【场景写作硬约束】'));
  assert.ok(formatted.includes('本场对白必须暗藏交锋，不可直接翻脸'));
});

test('novelMemoryManager delegates retrieveContext to retrieval engine', async () => {
  novelMemoryManager.reset('novel-integration-01');

  await novelMemoryManager.addMemoryFragment('novel-integration-01', {
    tier: 'long_term',
    type: 'world_rule',
    importance: 5,
    source: 'world',
    content: '灵石是修仙界唯一通用货币。',
    relatedEntities: [],
  });

  await novelMemoryManager.updateCharacterState('novel-integration-01', 'char-hero', {
    characterName: '萧炎',
    currentEmotion: '斗志昂扬',
    currentGoal: '三年之约',
  });

  const ctx = await novelMemoryManager.retrieveContext({
    novelId: 'novel-integration-01',
    sceneId: 'scene-01',
    povCharacterId: 'char-hero',
    activeCharacterIds: ['char-hero'],
    maxMemoryTokens: 1200,
  });

  assert.equal(ctx.povCharacter?.name, '萧炎');
  assert.equal(ctx.povCharacter?.dynamicState?.currentGoal, '三年之约');
  assert.equal(ctx.longTermMemories.length, 1);
  assert.equal(ctx.longTermMemories[0].content, '灵石是修仙界唯一通用货币。');

  novelMemoryManager.reset('novel-integration-01');
});
