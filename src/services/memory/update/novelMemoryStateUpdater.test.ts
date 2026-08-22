import assert from 'node:assert/strict';
import test from 'node:test';
import { NovelMemoryStateUpdater } from './novelMemoryStateUpdater';
import { novelMemoryManager } from '../novelMemoryManager';
import type { MemoryStateDelta } from '../../../types/novelMemory';

test('NovelMemoryStateUpdater updates character dynamic states and increments version', async () => {
  const updater = new NovelMemoryStateUpdater();
  updater.reset('novel-state-01');

  const s1 = await updater.updateCharacterState('novel-state-01', 'char-lin', {
    characterName: '林清玄',
    currentEmotion: '平静',
    currentGoal: '打坐修炼',
    faction: '青云宗',
  });

  assert.equal(s1.characterId, 'char-lin');
  assert.equal(s1.characterName, '林清玄');
  assert.equal(s1.currentEmotion, '平静');
  assert.equal(s1.stateVersion, 1);

  const s2 = await updater.updateCharacterState('novel-state-01', 'char-lin', {
    currentEmotion: '震惊，心绪大乱',
    injuries: ['气血逆流三成'],
  });

  assert.equal(s2.currentEmotion, '震惊，心绪大乱');
  assert.equal(s2.currentGoal, '打坐修炼'); // 保持原有目标
  assert.equal(s2.faction, '青云宗'); // 保持原有阵营
  assert.deepEqual(s2.injuries, ['气血逆流三成']);
  assert.equal(s2.stateVersion, 2);

  updater.reset('novel-state-01');
});

test('NovelMemoryStateUpdater updates world state and tracks events', async () => {
  const updater = new NovelMemoryStateUpdater();
  updater.reset('novel-state-02');

  const w1 = await updater.updateWorldSnapshot('novel-state-02', {
    timelinePosition: '天元历 328 年·春',
    worldRules: ['金丹修士不可干涉凡俗战事'],
    activeEvents: ['青云宗十年一度招徒大典'],
  });

  assert.equal(w1.snapshotVersion, 1);
  assert.equal(w1.timelinePosition, '天元历 328 年·春');

  const w2 = await updater.updateWorldSnapshot('novel-state-02', {
    timelinePosition: '天元历 328 年·夏',
    activeEvents: ['青云宗招徒大典落幕', '魔宗小队潜入边陲'],
  });

  assert.equal(w2.snapshotVersion, 2);
  assert.equal(w2.timelinePosition, '天元历 328 年·夏');
  assert.equal(w2.activeEvents?.length, 2);

  updater.reset('novel-state-02');
});

test('NovelMemoryStateUpdater applies structured state deltas and creates immutable version snapshot', async () => {
  const updater = new NovelMemoryStateUpdater();
  updater.reset('novel-state-03');

  // 初始化主角
  await updater.updateCharacterState('novel-state-03', 'char-lin', {
    characterName: '林清玄',
    currentEmotion: '戒备',
    faction: '青云宗',
  });

  // 模拟 Scene 生成结束后的 State Deltas
  const deltas: MemoryStateDelta[] = [
    {
      entityId: 'char-lin',
      entityType: 'character',
      changes: {
        currentEmotion: '大喜过望',
        currentGoal: '连夜炼化上品筑基丹',
        injuries: ['微弱内伤'],
        currentRelationship: { 'char-yue': '敌意加深' },
      },
      sourceScene: 'chap-08/scene-03',
      confidence: 0.95,
    },
    {
      entityId: 'world-main',
      entityType: 'world',
      changes: {
        timelinePosition: '天元历 328 年·秋·子夜',
        activeEvents: ['丹阁失窃案爆发'],
        factionStatus: { 戒律堂: '全山封锁搜查' },
      },
      sourceScene: 'chap-08/scene-03',
      confidence: 1.0,
    },
  ];

  const result = await updater.applyStateDelta(
    'novel-state-03',
    deltas,
    '第8章第3场生成后状态提交',
  );

  assert.equal(result.appliedDeltas, 2);
  assert.deepEqual(result.updatedCharacters, ['char-lin']);
  assert.equal(result.worldUpdated, true);
  assert.equal(result.versionSnapshot.versionNumber, 1);
  assert.equal(result.versionSnapshot.description, '第8章第3场生成后状态提交');

  // 验证当前状态已被修改
  const charLin = updater.getCharacterState('novel-state-03', 'char-lin');
  assert.equal(charLin?.currentEmotion, '大喜过望');
  assert.equal(charLin?.currentGoal, '连夜炼化上品筑基丹');
  assert.deepEqual(charLin?.currentRelationship, { 'char-yue': '敌意加深' });

  const world = updater.getWorldState('novel-state-03');
  assert.equal(world?.timelinePosition, '天元历 328 年·秋·子夜');
  assert.deepEqual(world?.activeEvents, ['丹阁失窃案爆发']);
  assert.deepEqual(world?.factionStatus, { 戒律堂: '全山封锁搜查' });

  updater.reset('novel-state-03');
});

test('NovelMemoryStateUpdater can rollback to a previous version cleanly', async () => {
  const updater = new NovelMemoryStateUpdater();
  updater.reset('novel-state-04');

  // 初始状态
  await updater.updateCharacterState('novel-state-04', 'char-lin', {
    characterName: '林清玄',
    currentEmotion: '沉稳',
    faction: '青云宗内门',
  });
  await updater.updateWorldSnapshot('novel-state-04', {
    timelinePosition: '初始纪年',
    activeEvents: ['和平时期'],
  });
  const v1 = await updater.createMemoryVersion('novel-state-04', '初始基线版本');

  // 发生剧烈剧情演进
  await updater.applyStateDelta(
    'novel-state-04',
    [
      {
        entityId: 'char-lin',
        entityType: 'character',
        changes: {
          currentEmotion: '濒死发狂',
          faction: '魔道余孽',
          injuries: ['丹田破碎', '金丹碎裂'],
        },
      },
      {
        entityId: 'world',
        entityType: 'world',
        changes: {
          timelinePosition: '灾厄纪年',
          activeEvents: ['宗门覆灭'],
        },
      },
    ],
    '重大剧情崩坏演进',
  );

  // 验证崩坏状态生效
  assert.equal(
    updater.getCharacterState('novel-state-04', 'char-lin')?.currentEmotion,
    '濒死发狂',
  );
  assert.equal(updater.getWorldState('novel-state-04')?.timelinePosition, '灾厄纪年');

  // 执行回滚至 v1
  const rollbackSuccess = await updater.rollbackMemoryVersion('novel-state-04', v1.versionId);
  assert.equal(rollbackSuccess, true);

  // 验证状态已恢复到 v1
  const restoredChar = updater.getCharacterState('novel-state-04', 'char-lin');
  assert.equal(restoredChar?.currentEmotion, '沉稳');
  assert.equal(restoredChar?.faction, '青云宗内门');
  assert.equal(restoredChar?.injuries, undefined);

  const restoredWorld = updater.getWorldState('novel-state-04');
  assert.equal(restoredWorld?.timelinePosition, '初始纪年');
  assert.deepEqual(restoredWorld?.activeEvents, ['和平时期']);

  // 版本历史中应包含回滚快照
  const versions = updater.listMemoryVersions('novel-state-04');
  assert.equal(versions.length, 3); // v1, v2(演进), v3(回滚)

  updater.reset('novel-state-04');
});

test('novelMemoryManager integrates state updates, deltas and snapshots', async () => {
  novelMemoryManager.reset('novel-manager-test');

  await novelMemoryManager.updateCharacterState('novel-manager-test', 'char-001', {
    characterName: '叶凡',
    currentEmotion: '豪情万丈',
  });

  const deltaResult = await novelMemoryManager.applyStateDelta(
    'novel-manager-test',
    [
      {
        entityId: 'char-001',
        entityType: 'character',
        changes: {
          currentGoal: '前往荒古禁地',
        },
      },
    ],
    '叶凡启程',
  );

  assert.equal(deltaResult.appliedDeltas, 1);

  const context = await novelMemoryManager.retrieveContext({
    novelId: 'novel-manager-test',
    sceneId: 'scene-01',
    povCharacterId: 'char-001',
  });

  assert.equal(context.povCharacter?.name, '叶凡');
  assert.equal(context.povCharacter?.dynamicState?.currentEmotion, '豪情万丈');
  assert.equal(context.povCharacter?.dynamicState?.currentGoal, '前往荒古禁地');

  novelMemoryManager.reset('novel-manager-test');
});
