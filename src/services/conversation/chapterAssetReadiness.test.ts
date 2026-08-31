import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChapterGenerationContext } from '../../types/ai';
import { selectCandidateTool } from './taskGoalRouting';
import {
  seedE2eChapterCoreAssets,
  type E2eChapterCoreAssetSeedInput,
} from '../tauri/e2eChapterCoreAssetFixture';
import {
  buildCoreAssetGenerationGoal,
  chapterAssetRecoveryStore,
  inspectChapterAssetReadiness,
  reconcileChapterAssetOrchestration,
  resolveCoreAssetGenerationChapterId,
  type ChapterCoreAsset,
} from './chapterAssetReadiness';

function context(
  values: Partial<
    Pick<
      ChapterGenerationContext,
      | 'chapterOutline'
      | 'worldBackground'
      | 'chapterSettings'
      | 'ruleSystems'
      | 'protagonist'
      | 'protagonistNames'
      | 'protagonistsSummary'
    >
  >,
): ChapterGenerationContext {
  return values as ChapterGenerationContext;
}

const e2eCoreAssetFixture: E2eChapterCoreAssetSeedInput = {
  novelId: 'novel-1',
  worldSetting: { title: '世界', content: '稳定且可执行的世界背景。' },
  ruleSystem: { title: '规则', content: '能力使用必须承担代价。' },
  protagonist: {
    name: '主角',
    identity: '调查员',
    personality: '谨慎',
    goal: '完成调查',
  },
  chapters: [
    {
      chapterId: 'chapter-1',
      title: '第一章',
      outline: '发现线索并作出选择。',
      targetWordCount: 600,
    },
    {
      chapterId: 'chapter-2',
      title: '第二章',
      outline: '追踪线索并面对阻力。',
      targetWordCount: 650,
    },
  ],
};

test('E2E core-asset fixture is unavailable outside the Tauri test runtime', async () => {
  await assert.rejects(
    seedE2eChapterCoreAssets(e2eCoreAssetFixture, { isDesktop: () => false }),
    /requires the Tauri runtime/,
  );
});

test('E2E core-asset fixture validates every chapter scope before mutating SQLite', async () => {
  let mutationCount = 0;
  await assert.rejects(
    seedE2eChapterCoreAssets(e2eCoreAssetFixture, {
      isDesktop: () => true,
      getNovel: async () => ({ id: 'novel-1' }) as never,
      getChapter: async (chapterId) =>
        ({
          id: chapterId,
          novelId: chapterId === 'chapter-2' ? 'novel-other' : 'novel-1',
        }) as never,
      updateChapter: async () => {
        mutationCount += 1;
        return null;
      },
      saveWorldSetting: async () => {
        mutationCount += 1;
        return { id: 'world-1' } as never;
      },
      saveRuleSystem: async () => {
        mutationCount += 1;
        return { id: 'rule-1' } as never;
      },
      saveProtagonist: async () => {
        mutationCount += 1;
        return { id: 'protagonist-1' } as never;
      },
    }),
    /does not belong to the requested novel/,
  );
  assert.equal(mutationCount, 0);
});

test('chapter readiness reports the exact writer core assets in a stable user-facing order', async () => {
  const result = await inspectChapterAssetReadiness(
    { novelId: 'novel-1', chapterId: 'chapter-1', userInstruction: '生成本章正文' },
    { buildContext: async () => context({}) },
  );

  assert.equal(result.ready, false);
  assert.deepEqual(result.missingAssets, [
    'world_setting',
    'protagonist',
    'chapter_outline',
  ] satisfies ChapterCoreAsset[]);
});

test('chapter readiness accepts authoritative fallback sources from the production writer', async () => {
  const result = await inspectChapterAssetReadiness(
    { novelId: 'novel-1', chapterId: 'chapter-1' },
    {
      buildContext: async () =>
        context({
          chapterOutline: '主角潜入旧港并取得航图。',
          chapterSettings: '旧港受潮汐结界保护。',
          ruleSystems: '潮汐结界每天只在退潮时关闭。',
          protagonistNames: '沈砚',
          protagonistsSummary: '- 主角：沈砚',
        }),
    },
  );

  assert.deepEqual(result, { ready: true, missingAssets: [] });
});

test('chapter readiness rejects a label-only protagonist summary from an empty novel profile', async () => {
  const result = await inspectChapterAssetReadiness(
    { novelId: 'novel-1', chapterId: 'chapter-1' },
    {
      buildContext: async () =>
        context({
          chapterOutline: '调查员在旧宅发现第一条线索。',
          worldBackground: '旧城每逢月末会封锁一夜。',
          ruleSystems: '封锁期间任何居民不得离开旧城。',
          protagonistsSummary: '- 主角A：',
        }),
    },
  );

  assert.deepEqual(result, { ready: false, missingAssets: ['protagonist'] });
});

test('a project without chapters requests formal world and protagonist assets first', async () => {
  const result = await inspectChapterAssetReadiness(
    { novelId: 'novel-1', userInstruction: '写一个约六万字的悬疑故事' },
    {
      listChapters: async () => [],
      listVolumes: async () => [],
      getWorldSettings: async () => [],
      getRuleSystems: async () => [],
      getProtagonist: async () => null,
      getNovel: async () => null,
    },
  );

  assert.deepEqual(result, {
    ready: false,
    missingAssets: ['world_setting', 'protagonist'],
  });
});

test('world-and-rules recovery does not leave a duplicate rule step after its bundle is applied', async () => {
  const states = [
    {
      worldSettings: [],
      ruleSystems: [],
    },
    {
      worldSettings: [{ isActive: true, content: '永夜城依靠中央钟楼维持时间流动。' } as never],
      ruleSystems: [{ isActive: true, content: '时间倒流必须付出等量记忆。' } as never],
    },
  ];
  let stateIndex = 0;
  const dependencies = {
    listChapters: async () => [],
    listVolumes: async () => [],
    getWorldSettings: async () => states[stateIndex].worldSettings,
    getRuleSystems: async () => states[stateIndex].ruleSystems,
    getProtagonist: async () => null,
    getNovel: async () => null,
  };

  assert.deepEqual(await inspectChapterAssetReadiness({ novelId: 'novel-1' }, dependencies), {
    ready: false,
    missingAssets: ['world_setting', 'protagonist'],
  });

  stateIndex = 1;
  assert.deepEqual(await inspectChapterAssetReadiness({ novelId: 'novel-1' }, dependencies), {
    ready: false,
    missingAssets: ['protagonist'],
  });
});

test('a chapterless project requires formal rules before creating the story plan', async () => {
  const result = await inspectChapterAssetReadiness(
    { novelId: 'novel-1' },
    {
      listChapters: async () => [],
      listVolumes: async () => [],
      getWorldSettings: async () => [
        { isActive: true, content: '永夜城依靠中央钟楼维持时间流动。' } as never,
      ],
      getRuleSystems: async () => [],
      getProtagonist: async () => ({ name: '林默' }) as never,
      getNovel: async () => null,
    },
  );

  assert.deepEqual(result, { ready: false, missingAssets: ['rule_system'] });
});

test('a chapterless project requests a story plan after formal prerequisites exist', async () => {
  const result = await inspectChapterAssetReadiness(
    { novelId: 'novel-1' },
    {
      listChapters: async () => [],
      listVolumes: async () => [],
      getWorldSettings: async () => [
        { isActive: true, content: '永夜城依靠中央钟楼维持时间流动。' } as never,
      ],
      getRuleSystems: async () => [
        { isActive: true, content: '时间倒流必须付出等量记忆。' } as never,
      ],
      getProtagonist: async () => ({ name: '林默' }) as never,
      getNovel: async () => null,
    },
  );

  assert.deepEqual(result, { ready: false, missingAssets: ['story_plan'] });
});

test('a chapterless project recognizes protagonists stored on the modern novel aggregate', async () => {
  const result = await inspectChapterAssetReadiness(
    { novelId: 'novel-1' },
    {
      listChapters: async () => [],
      listVolumes: async () => [],
      getWorldSettings: async () => [
        { isActive: true, content: '永夜城依靠中央钟楼维持时间流动。' } as never,
      ],
      getRuleSystems: async () => [
        { isActive: true, content: '时间倒流必须付出等量记忆。' } as never,
      ],
      getProtagonist: async () => null,
      getNovel: async () => ({ protagonists: [{ name: '林默' }] }) as never,
    },
  );

  assert.deepEqual(result, { ready: false, missingAssets: ['story_plan'] });
});

test('readiness discovers the first planned chapter after a story plan is applied', async () => {
  const result = await inspectChapterAssetReadiness(
    { novelId: 'novel-1', userInstruction: '写一个约六万字的悬疑故事' },
    {
      listChapters: async () => [{ id: 'chapter-1' } as never],
      listVolumes: async () => [],
      buildContext: async () =>
        context({
          chapterOutline: '主角发现第一条线索。',
          worldBackground: '城市会定期清除居民记忆。',
          ruleSystems: '被清除的记忆只能通过原始载体恢复。',
          protagonist: '沈岚',
        }),
    },
  );

  assert.deepEqual(result, { ready: true, missingAssets: [], chapterId: 'chapter-1' });
});

test('chapter readiness blocks existing chapter prose when formal rules are absent', async () => {
  const result = await inspectChapterAssetReadiness(
    { novelId: 'novel-1', chapterId: 'chapter-1' },
    {
      buildContext: async () =>
        context({
          chapterOutline: '主角沿着失踪者留下的记号进入钟楼。',
          worldBackground: '永夜城依靠中央钟楼维持时间流动。',
          protagonist: '林默',
        }),
    },
  );

  assert.deepEqual(result, { ready: false, missingAssets: ['rule_system'] });
});

test('rule-system recovery enters the same stable asset queue as other prerequisites', () => {
  assert.deepEqual(
    reconcileChapterAssetOrchestration(undefined, ['rule_system'], '2026-08-28T00:00:00.000Z'),
    { phase: 'queued', asset: 'rule_system', updatedAt: '2026-08-28T00:00:00.000Z' },
  );
});

test('asset preparation goals preserve the complete user idea in a stable hidden envelope', () => {
  const sparseIdea = '写一个失忆钟表匠在永夜城追查时间失窃案的第一章正文';
  const planGoal = buildCoreAssetGenerationGoal('story_plan', sparseIdea);
  const worldGoal = buildCoreAssetGenerationGoal('world_setting', sparseIdea);
  const ruleGoal = buildCoreAssetGenerationGoal('rule_system', sparseIdea);
  const protagonistGoal = buildCoreAssetGenerationGoal('protagonist', sparseIdea);
  const outlineGoal = buildCoreAssetGenerationGoal('chapter_outline', sparseIdea);

  const marker = '。\n\n[[ANS_CREATIVE_BRIEF:v1]]\n';
  const goals = [planGoal, worldGoal, ruleGoal, protagonistGoal, outlineGoal];
  assert.deepEqual(
    goals.map((goal) => JSON.parse(goal.slice(goal.indexOf(marker) + marker.length))),
    goals.map(() => ({
      schema: 'ans_core_asset_creative_brief_v1',
      source: 'original_user_goal',
      content: sparseIdea,
    })),
  );
  assert.deepEqual(selectCandidateTool(worldGoal, 'chapter-1'), {
    name: 'expand_settings',
    artifactType: 'setting_candidates',
  });
  assert.deepEqual(selectCandidateTool(protagonistGoal, 'chapter-1'), {
    name: 'generate_characters',
    artifactType: 'character_candidates',
  });
  assert.deepEqual(selectCandidateTool(ruleGoal), {
    name: 'expand_settings',
    artifactType: 'setting_candidates',
  });
  assert.deepEqual(selectCandidateTool(outlineGoal, 'chapter-1'), {
    name: 'generate_outline',
    artifactType: 'outline',
  });
  assert.deepEqual(selectCandidateTool(planGoal), {
    name: 'generate_outline',
    artifactType: 'outline',
  });
  const longIdea = `写一个近未来悬疑故事：${'城市记忆每夜都会改变。'.repeat(30)}结尾必须保留钟楼仍在运转。`;
  const longGoal = buildCoreAssetGenerationGoal('world_setting', longIdea);
  const longPayload = JSON.parse(longGoal.slice(longGoal.indexOf(marker) + marker.length)) as {
    content: string;
  };
  assert.equal(longPayload.content, longIdea);
  assert.match(longPayload.content, /结尾必须保留钟楼仍在运转。$/u);
});

test('only chapter-outline preparation carries a chapter target', () => {
  assert.equal(resolveCoreAssetGenerationChapterId('world_setting', 'chapter-1'), undefined);
  assert.equal(resolveCoreAssetGenerationChapterId('rule_system', 'chapter-1'), undefined);
  assert.equal(resolveCoreAssetGenerationChapterId('protagonist', 'chapter-1'), undefined);
  assert.equal(resolveCoreAssetGenerationChapterId('story_plan', 'chapter-1'), undefined);
  assert.equal(resolveCoreAssetGenerationChapterId('chapter_outline', 'chapter-1'), 'chapter-1');
});

test('asset recovery keeps the original chapter goal in session scope', () => {
  const values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => void values.delete(key),
    setItem: (key: string, value: string) => void values.set(key, value),
  } satisfies Storage;
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { sessionStorage: storage },
  });
  try {
    chapterAssetRecoveryStore.set({
      conversationId: 'conversation-1',
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      originalGoal: '生成本章正文',
      missingAssets: ['chapter_outline', 'world_setting'],
      orchestration: {
        phase: 'awaiting_apply',
        asset: 'world_setting',
        preparationTurnId: 'turn-world',
        preparationRunId: 'run-world',
        candidateArtifactId: 'artifact-world',
        updatedAt: '2026-08-28T00:00:00.500Z',
      },
      createdAt: '2026-08-28T00:00:00.000Z',
      checkedAt: '2026-08-28T00:00:01.000Z',
    });

    assert.deepEqual(chapterAssetRecoveryStore.get('conversation-1'), {
      conversationId: 'conversation-1',
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      originalGoal: '生成本章正文',
      missingAssets: ['world_setting', 'chapter_outline'],
      createdAt: '2026-08-28T00:00:00.000Z',
      checkedAt: '2026-08-28T00:00:01.000Z',
      sourceTurnId: undefined,
      modelSnapshot: undefined,
      orchestration: {
        phase: 'awaiting_apply',
        asset: 'world_setting',
        preparationTurnId: 'turn-world',
        preparationRunId: 'run-world',
        candidateArtifactId: 'artifact-world',
        error: undefined,
        updatedAt: '2026-08-28T00:00:00.500Z',
      },
    });
    chapterAssetRecoveryStore.remove('conversation-1');
    assert.equal(chapterAssetRecoveryStore.get('conversation-1'), null);
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  }
});

test('asset orchestration advances only when the formal missing asset changes', () => {
  const awaitingApply = {
    phase: 'awaiting_apply' as const,
    asset: 'world_setting' as const,
    preparationTurnId: 'turn-world',
    candidateArtifactId: 'artifact-world',
    updatedAt: '2026-08-28T00:00:00.000Z',
  };

  assert.equal(
    reconcileChapterAssetOrchestration(
      awaitingApply,
      ['world_setting', 'protagonist'],
      '2026-08-28T00:00:01.000Z',
    ),
    awaitingApply,
  );
  assert.deepEqual(
    reconcileChapterAssetOrchestration(awaitingApply, ['protagonist'], '2026-08-28T00:00:02.000Z'),
    {
      phase: 'queued',
      asset: 'protagonist',
      updatedAt: '2026-08-28T00:00:02.000Z',
    },
  );
  assert.deepEqual(
    reconcileChapterAssetOrchestration(awaitingApply, [], '2026-08-28T00:00:03.000Z'),
    { phase: 'resuming', updatedAt: '2026-08-28T00:00:03.000Z' },
  );
});
