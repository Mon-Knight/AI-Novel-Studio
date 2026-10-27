import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeChapterEngineeringState } from '../engineering/chapterEngineeringService';
import {
  assertRequiredCoreAssets,
  assertGenerationRuleCoverage,
  compileGenerationContextSnapshot,
} from './generationContextCompiler';

import {
  buildRuleSystemsProjectionForWriter,
  buildWorldSettingsProjectionForWriter,
} from '../prompt/contextBuilder';
import { buildChapterProviderContextSources } from './chapterProviderContext';

const emptyEngineeringBundle = async () => ({ states: [], hasUnappliedDraft: false });

test('engineering viewpoint known and unknown canaries survive the old section limit into Provider sources', async () => {
  const engineering = normalizeChapterEngineeringState({
    id: 'e',
    novelId: 'n',
    chapterId: 'c',
    status: 'active',
    chapterCard: {
      chapterGoal: 'long-goal-'.repeat(1000),
      viewpointCharacter: 'VIEWPOINT_CANARY',
      knownInformation: ['KNOWN_CANARY'],
      unknownInformation: ['UNKNOWN_CANARY'],
    },
  })!;
  const compiled = await compileGenerationContextSnapshot(
    { novelId: 'n', chapterId: 'c' },
    {
      buildBaseContext: async () => ({ novelTitle: 'n', chapterTitle: 'c' }),
      getEngineeringBundle: async () => ({
        states: [engineering],
        activeState: engineering,
        hasUnappliedDraft: false,
      }),
      loadAssetContext: async () => ({ sources: [], warnings: [] }),
    },
  );
  const section = compiled.compiledContext.sections.find(
    (section) => section.key === 'engineering',
  )!;
  assert.ok(section.content.length > 8000);
  for (const canary of ['VIEWPOINT_CANARY', 'KNOWN_CANARY', 'UNKNOWN_CANARY']) {
    assert.ok(section.content.includes(canary));
    assert.ok(compiled.compiledPromptText.includes(canary));
  }
  const sources = buildChapterProviderContextSources({
    snapshot: compiled,
    requestSourceVersion: compiled.contextHash,
    requestInstruction: '写本章',
  });
  const engineeringSource = sources.find((source) => source.label === section.title)!;
  assert.equal(engineeringSource.required, true);
  assert.equal(engineeringSource.requireFull, true);
  assert.equal(engineeringSource.content, section.content);
});

test('required rule and world coverage rejects missing cross-scope stale and partial projections', async () => {
  const ruleProjection = await buildRuleSystemsProjectionForWriter('n', [
    {
      id: 'r',
      novelId: 'n',
      title: 'Rule',
      content: '规则尾部RULE_TAIL',
      isActive: true,
      createdAt: 't',
      updatedAt: 't',
    },
  ]);
  const worldProjection = await buildWorldSettingsProjectionForWriter('n', [
    {
      id: 'w',
      novelId: 'n',
      title: 'World',
      content: '世界尾部WORLD_TAIL',
      isActive: true,
      createdAt: 't',
      updatedAt: 't',
    },
  ]);
  const base = {
    novelTitle: 'n',
    chapterTitle: 'c',
    chapterOutline: '大纲',
    protagonist: '主角',
    ...ruleProjection,
    ...worldProjection,
  };
  await assertGenerationRuleCoverage('n', base);
  await assert.rejects(assertGenerationRuleCoverage('other', base), /context_incomplete/u);
  await assert.rejects(
    assertGenerationRuleCoverage('n', { ...base, ruleSystemCoverage: undefined }),
    /context_incomplete/u,
  );
  await assert.rejects(
    assertGenerationRuleCoverage('n', { ...base, ruleSystems: '规则被截断' }),
    /context_incomplete/u,
  );
  await assert.rejects(
    assertGenerationRuleCoverage('n', { ...base, worldBackground: '世界被截断' }),
    /context_incomplete/u,
  );
  await assert.rejects(
    assertGenerationRuleCoverage('n', {
      ...base,
      ruleSystemCoverage: { ...base.ruleSystemCoverage, includedCount: 0 },
    }),
    /context_incomplete/u,
  );
  await assert.rejects(
    compileGenerationContextSnapshot(
      { novelId: 'n', chapterId: 'c', requireCoreAssets: true },
      {
        buildBaseContext: async () => ({ ...base, ruleSystemCoverage: undefined }),
        getEngineeringBundle: emptyEngineeringBundle,
        loadAssetContext: async () => ({ sources: [], warnings: [] }),
      },
    ),
    /context_incomplete/u,
  );
});

test('task target is passed into context compilation and frozen with its prompt hash', async () => {
  const engineering = normalizeChapterEngineeringState({
    id: 'engineering-1',
    novelId: 'novel-target',
    chapterId: 'chapter-target',
    status: 'active',
    chapterCard: { targetWordCount: 1000 },
  })!;
  const compile = (targetWordCount: number) =>
    compileGenerationContextSnapshot(
      { novelId: 'novel-target', chapterId: 'chapter-target', targetWordCount },
      {
        buildBaseContext: async (input) => ({
          novelTitle: '字数测试',
          chapterTitle: '第一章',
          targetWordCount: input.targetWordCount,
        }),
        getEngineeringBundle: async () => ({
          states: [engineering],
          activeState: engineering,
          hasUnappliedDraft: false,
        }),
        loadAssetContext: async () => ({ sources: [], warnings: [] }),
      },
    );
  const first = await compile(3200);
  const second = await compile(3000);
  assert.equal(first.compiledContext.baseContext.targetWordCount, 3200);
  assert.match(first.compiledPromptText, /目标字数：3200/u);
  assert.notEqual(first.contextHash, second.contextHash);
  assert.equal(first.compiledContext.activeEngineeringState?.chapterCard.targetWordCount, 1000);
  assert.doesNotMatch(first.compiledPromptText, /目标字数：1000/u);
});

test('writer core-asset gate requires a formal rule system', () => {
  const context = {
    chapterOutline: '主角进入旧钟楼并找到第一条线索。',
    worldBackground: '永夜城依靠中央钟楼维持时间流动。',
    protagonist: '林默',
  } as Parameters<typeof assertRequiredCoreAssets>[0];

  assert.throws(
    () => assertRequiredCoreAssets(context),
    (error: unknown) => {
      const missing = error as { code?: string; missingAssets?: string[]; message?: string };
      assert.equal(missing.code, 'GENERATION_CORE_ASSETS_MISSING');
      assert.deepEqual(missing.missingAssets, ['rule_system']);
      assert.match(missing.message ?? '', /规则体系/u);
      return true;
    },
  );
  assert.doesNotThrow(() =>
    assertRequiredCoreAssets({
      ...context,
      ruleSystems: '时间倒流必须付出等量记忆。',
    }),
  );
});

test('critical aggregate sections keep every child asset before Provider budgeting', async () => {
  const snapshot = await compileGenerationContextSnapshot(
    {
      novelId: 'novel-long-critical-context',
      chapterId: 'chapter-long-critical-context',
    },
    {
      buildBaseContext: async () => ({
        novelTitle: '未命名悬疑小说',
        chapterTitle: '第一章',
        novelDescription: '长简介'.repeat(3_000),
        worldBackground: 'WORLD_CONTEXT_TAIL_CANARY',
        ruleSystems: 'RULE_CONTEXT_TAIL_CANARY',
        protagonist: '主角',
        protagonistsSummary: '长主角资料'.repeat(2_000),
        chapterCharacters: 'CHAPTER_CHARACTER_TAIL_CANARY',
        masterOutline: '长总纲'.repeat(3_000),
        chapterOutline: 'CHAPTER_OUTLINE_TAIL_CANARY',
      }),
      getEngineeringBundle: emptyEngineeringBundle,
      loadAssetContext: async () => ({ sources: [], warnings: [] }),
    },
  );

  const novel = snapshot.compiledContext.sections.find((section) => section.key === 'novel');
  const protagonist = snapshot.compiledContext.sections.find(
    (section) => section.key === 'protagonist',
  );
  const outline = snapshot.compiledContext.sections.find((section) => section.key === 'outline');

  assert.ok(novel && novel.content.length > 8_000);
  assert.match(novel.content, /WORLD_CONTEXT_TAIL_CANARY/);
  assert.match(novel.content, /RULE_CONTEXT_TAIL_CANARY/);
  assert.doesNotMatch(novel.content, /已截断/);
  assert.ok(protagonist && protagonist.content.length > 8_000);
  assert.match(protagonist.content, /CHAPTER_CHARACTER_TAIL_CANARY/);
  assert.doesNotMatch(protagonist.content, /已截断/);
  assert.ok(outline && outline.content.length > 8_000);
  assert.match(outline.content, /CHAPTER_OUTLINE_TAIL_CANARY/);
  assert.doesNotMatch(outline.content, /已截断/);
});

test('cross-chapter continuity contract freezes relative deadlines against one story clock', async () => {
  const snapshot = await compileGenerationContextSnapshot(
    {
      novelId: 'novel-continuity-001',
      chapterId: 'chapter-002',
      adoptedPreviousChapter: {
        chapterId: 'chapter-001',
        draftId: 'draft-adopted-001',
        contentHash: 'a'.repeat(64),
        content:
          'Story Day 1 二十一点五十三分，现场封条写明次日六时开始拆除。林见微用相机拍下卡在门槛里的纸片。',
      },
      retrievedMemoryContext: 'MEMORY_STATE_CANARY：焦黑纸片仍卡在北门门槛，现场没有人移动它。',
    },
    {
      buildBaseContext: async () => ({
        novelTitle: '潮汐旧案',
        chapterTitle: '第二章',
        chapterOutline: 'Story Day 2 早上八点十六分，林见微前往档案馆核查记录。',
        previousContext:
          'CONTEXT_DEADLINE_CANARY：拆除 deadline 是 Story Day 2 六时，不能随章节切换重置。',
        characterStates: 'CHARACTER_INJURY_CANARY：林见微左手腕擦伤，尚未处理，握持重物时疼痛。',
      }),
      getEngineeringBundle: emptyEngineeringBundle,
      loadAssetContext: async () => ({
        storyAssetText: '【地点】旧冷库北门\n描述：门槛、封条和围挡属于同一现场。',
        sources: [
          {
            type: 'location',
            title: '地点：旧冷库北门',
            sourceId: 'location-north-gate',
            status: 'used',
          },
        ],
        warnings: [],
      }),
    },
  );

  const continuity = snapshot.compiledContext.sections.find(
    (section) => section.key === 'cross_chapter_continuity',
  );
  assert.ok(continuity);
  assert.equal(
    snapshot.compiledContext.sections[snapshot.compiledContext.sections.length - 1]?.key,
    'cross_chapter_continuity',
  );
  assert.deepEqual(continuity.sourceTypes, [
    'adopted_chapter',
    'context_record',
    'memory_context',
    'character_state',
    'location',
  ]);

  assert.match(snapshot.compiledPromptText, /CONTEXT_DEADLINE_CANARY/);
  assert.match(snapshot.compiledPromptText, /MEMORY_STATE_CANARY/);
  assert.match(snapshot.compiledPromptText, /只追踪材料中实际出现的连续性维度/);
  assert.match(snapshot.compiledPromptText, /沿用同一故事时钟与既定截止点/);
  assert.match(snapshot.compiledPromptText, /不因章节切换重新起算/);
  assert.match(snapshot.compiledPromptText, /人物移动、关键物件归属或状态、伤势/);
  assert.match(snapshot.compiledPromptText, /设备或系统连接状态、人物知识发生变化时/);
  assert.match(snapshot.compiledPromptText, /未在材料中出现的维度无需建模/);
  assert.match(snapshot.compiledPromptText, /静默连续性核对.*不得写入正文/);
  assert.doesNotMatch(snapshot.compiledPromptText, /内部连续性账本|必须执行以下硬约束/);

  assert.doesNotMatch(snapshot.promptSummary, /跨章连续性硬约束/);
  assert.doesNotMatch(snapshot.promptSummary, /故事时钟|关键物件|连续性核对/);
});

test('first chapter without continuity evidence does not receive a synthetic state ledger', async () => {
  const snapshot = await compileGenerationContextSnapshot(
    {
      novelId: 'novel-continuity-001',
      chapterId: 'chapter-001',
    },
    {
      buildBaseContext: async () => ({
        novelTitle: '潮汐旧案',
        chapterTitle: '第一章',
        chapterOutline: '记者收到一段匿名录音。',
      }),
      getEngineeringBundle: emptyEngineeringBundle,
      loadAssetContext: async () => ({ sources: [], warnings: [] }),
    },
  );

  assert.equal(
    snapshot.compiledContext.sections.some((section) => section.key === 'cross_chapter_continuity'),
    false,
  );
  assert.doesNotMatch(snapshot.compiledPromptText, /Story Day N|deadlineAt/);
});

test('persisted world-state timeline is frozen as an explicit Writer section with provenance', async () => {
  const timelineText = [
    '叙事进度：已完成至第2章；当前目标为第3章。',
    '### 第2章《封条》',
    '- 世界/规则变化：北门封条已在 Story Day 2 六时拆除',
    '- 持续有效事实：门禁日志原件仍下落不明',
  ].join('\n');
  const snapshot = await compileGenerationContextSnapshot(
    {
      novelId: 'novel-world-state-001',
      chapterId: 'chapter-003',
    },
    {
      buildBaseContext: async () => ({
        novelTitle: '潮汐旧案',
        chapterTitle: '第三章',
        chapterOutline: '主角核查门禁日志。',
        worldStateTimeline: timelineText,
        worldStateTimelineSource: {
          latestChapterId: 'chapter-002',
          chapterCount: 2,
          sourceSummaryIds: ['summary-001', 'summary-002'],
          sourceContextRecordIds: ['context-002'],
        },
      }),
      getEngineeringBundle: emptyEngineeringBundle,
      loadAssetContext: async () => ({ sources: [], warnings: [] }),
    },
  );

  const section = snapshot.compiledContext.sections.find(
    (candidate) => candidate.key === 'world_state_timeline',
  );
  assert.ok(section);
  assert.equal(section.title, '持久化世界状态与时间线');
  assert.deepEqual(section.sourceTypes, ['world_state']);
  assert.equal(section.content, timelineText);
  assert.match(snapshot.compiledPromptText, /门禁日志原件仍下落不明/);
  assert.equal(snapshot.compiledContext.baseContext.worldStateTimeline, timelineText);
  assert.deepEqual(
    snapshot.sources.find((source) => source.title === '持久化世界状态与时间线'),
    {
      type: 'world_state',
      title: '持久化世界状态与时间线',
      status: 'used',
      summary: 'chapters=2;summaries=2;context_records=1',
      sourceId: 'chapter-002',
    },
  );
});

test('optional source read failures are frozen into snapshot warnings', async () => {
  const warning = '人物资料读取失败，本轮已按无可用来源降级。';
  const snapshot = await compileGenerationContextSnapshot(
    {
      novelId: 'novel-warning-001',
      chapterId: 'chapter-warning-001',
    },
    {
      buildBaseContext: async () => ({
        novelTitle: '潮汐旧案',
        chapterTitle: '第一章',
        chapterOutline: '记者收到一段匿名录音。',
        contextWarnings: [warning],
      }),
      getEngineeringBundle: emptyEngineeringBundle,
      loadAssetContext: async () => ({ sources: [], warnings: [] }),
    },
  );

  assert.ok(snapshot.compiledContext.warnings.includes(warning));
  assert.match(snapshot.promptSummary, new RegExp(warning));
});
