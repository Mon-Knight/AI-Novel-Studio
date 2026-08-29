import assert from 'node:assert/strict';
import test from 'node:test';

import { readProjectContext, type ProjectContextReadDependencies } from './project-tools';
import type { Chapter } from '../types/chapter';
import type { Novel } from '../types/novel';
import type { Volume } from '../types/volume';

const NOW = '2026-08-28T00:00:00.000Z';

function novelFixture(): Novel {
  return {
    id: 'novel-context-fixture',
    title: '雾城回声',
    description: '一名调查员追踪会吞噬记忆的旧城。',
    outline: '调查从失踪案开始，最终指向维持城市秩序的谎言。',
    worldBackground: '旧版项目背景：旧城居民会在月末遗忘自己的姓名。',
    genre: '悬疑幻想',
    protagonistMode: 'single',
    protagonists: [
      {
        id: 'protagonist-lin-mo',
        label: 'primary',
        name: '林默',
        gender: '男',
        identity: '黑市调查员',
        personality: '谨慎而固执',
        goal: '查清失踪案',
        motivation: '保护仍然活着的人',
        ability: '辨认残留记忆',
        limitation: '每次使用都会遗忘自己的片段',
        background: '来自被封锁的旧城区',
        arc: '从独自承担转向信任同伴',
        notes: '',
      },
    ],
    dualProtagonistRelation: {
      type: 'partner',
      description: '',
      conflict: '',
      cooperation: '',
      emotionalProgression: '',
      narrativeWeight: 'balanced',
    },
    status: 'writing',
    currentVolumeId: 'volume-one',
    currentChapterId: 'chapter-one',
    totalWordCount: 12_000,
    totalWords: 12_000,
    targetWordCount: 60_000,
    targetWords: 60_000,
    createdAt: NOW,
    updatedAt: NOW,
    volumes: [],
  };
}

function volumeFixture(): Volume {
  return {
    id: 'volume-one',
    novelId: 'novel-context-fixture',
    title: '第一卷 雨中的旧城',
    summary: '调查进入封锁区。',
    goal: '揭示失踪案与旧城的联系。',
    mainConflict: '调查真相与维持秩序的冲突。',
    orderIndex: 0,
    volumeNumber: 1,
    sortOrder: 0,
    status: 'writing',
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function chapterFixture(): Chapter {
  return {
    id: 'chapter-one',
    novelId: 'novel-context-fixture',
    volumeId: 'volume-one',
    title: '雨夜来客',
    outline: '林默接到一件没有报案人的失踪案。',
    goal: '建立调查动机并留下旧城线索。',
    chapterNumber: 1,
    orderIndex: 0,
    sortOrder: 0,
    status: 'outline_ready',
    wordCount: 0,
    currentWords: 0,
    targetWordCount: 4_000,
    targetWords: 4_000,
    drafts: [
      {
        id: 'draft-one',
        chapterId: 'chapter-one',
        version: 1,
        source: 'user_edit',
        content: '这段历史正文不应被 novel.read_context 重复投影。',
        wordCount: 24,
        isAdopted: true,
        createdAt: NOW,
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function contextDependencies(): ProjectContextReadDependencies {
  return {
    getNovel: async () => novelFixture(),
    getWorldSettings: async () => [
      {
        id: 'world-one',
        novelId: 'novel-context-fixture',
        title: '雾城',
        content: '城市被终年不散的雾包围，记忆可以被储存和交易。',
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    getRuleSystems: async () => [
      {
        id: 'rule-one',
        novelId: 'novel-context-fixture',
        title: '记忆交易规则',
        category: 'other',
        content: '取出记忆必然留下等量空缺。',
        forbiddenRules: '不存在无代价恢复。',
        isActive: true,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    getLegacyProtagonist: async () => null,
    getVolumes: async () => [volumeFixture()],
    getChapters: async () => [chapterFixture()],
    getMasterOutline: async () => ({
      id: 'master-one',
      projectId: 'novel-context-fixture',
      title: '总纲',
      content: '失踪案逐步揭开城市依靠被窃记忆维持稳定的事实。',
      status: 'active',
      version: 2,
      isActive: true,
      sourceType: 'manual',
      createdAt: NOW,
      updatedAt: NOW,
    }),
    getVolumeOutline: async () => ({
      id: 'volume-outline-one',
      projectId: 'novel-context-fixture',
      volumeId: 'volume-one',
      volumeIndex: 0,
      title: '第一卷纲',
      content: '林默进入旧城并发现第一位仍保留记忆的证人。',
      status: 'active',
      version: 1,
      isActive: true,
      sourceType: 'manual',
      createdAt: NOW,
      updatedAt: NOW,
    }),
    getChapterOutline: async () => ({
      id: 'chapter-outline-one',
      projectId: 'novel-context-fixture',
      chapterId: 'chapter-one',
      chapterIndex: 0,
      title: '第一章纲',
      content: '雨夜来客留下空白档案后消失。',
      status: 'active',
      version: 3,
      isActive: true,
      sourceType: 'manual',
      createdAt: NOW,
      updatedAt: NOW,
    }),
    resolveProfiles: async () => ({ styleProfileId: 'style-one', outputProfileId: 'output-one' }),
    getStyleProfile: async () => ({
      id: 'style-one',
      novelId: 'novel-context-fixture',
      name: '冷峻悬疑',
      sourceType: 'manual',
      targetWordsPerChapter: 4_000,
      rhythmPreference: 'moderate',
      narrativePerspective: '第三人称有限视角',
      tone: '克制、冷峻',
      pace: '中等',
      dialogueRatio: 0.3,
      descriptionRatio: 0.45,
      prohibitedStyles: ['解释性独白'],
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
    }),
    getOutputProfile: async () => ({
      id: 'output-one',
      novelId: 'novel-context-fixture',
      name: '四千字章节',
      chapterWordRange: { min: 3_500, max: 4_500, default: 4_000 },
      targetWordCount: 4_000,
      minWordCount: 3_500,
      maxWordCount: 4_500,
      paragraphLength: 'medium',
      povType: 'third_person_limited',
      tenseType: 'past',
      paceLevel: 'medium',
      endingHookRequired: true,
      forbiddenItems: ['突然出现万能解法'],
      isDefault: true,
      createdAt: NOW,
      updatedAt: NOW,
    }),
    loadGenerationAssets: async () => ({
      storyAssetText: '【势力】记忆交易所\n目标：垄断旧城记忆。',
      referenceText: '【研究资料】创伤后记忆\n资料节选：回忆并不等同于事实。',
      sources: [
        {
          type: 'faction',
          title: '势力：记忆交易所',
          sourceId: 'faction-one',
          status: 'used',
        },
      ],
      warnings: [],
    }),
  };
}

test('readProjectContext projects authored assets for a short user instruction', async () => {
  const result = await readProjectContext(
    { novelId: 'novel-context-fixture', chapterId: 'chapter-one' },
    contextDependencies(),
  );

  assert.equal(result.ok, true);
  const data = result.data as {
    protagonistSource?: string;
    protagonists?: Array<{ name?: string }>;
    worldSettings?: Array<{ content?: string }>;
    ruleSystems?: Array<{ content?: string }>;
    activeOutlines?: {
      master?: { content?: string };
      volume?: { content?: string };
      chapter?: { content?: string };
    };
    generationProfiles?: {
      style?: { promptProjection?: string };
      output?: { targetWordCount?: number };
    };
    generationAssets?: { storyAssets?: string; referenceMaterials?: string };
    chapters?: Array<Record<string, unknown>>;
  };
  assert.equal(data.protagonistSource, 'novels.protagonists');
  assert.equal(data.protagonists?.[0]?.name, '林默');
  assert.match(data.worldSettings?.[0]?.content ?? '', /记忆可以被储存和交易/);
  assert.match(data.ruleSystems?.[0]?.content ?? '', /等量空缺/);
  assert.match(data.activeOutlines?.master?.content ?? '', /被窃记忆/);
  assert.match(data.activeOutlines?.volume?.content ?? '', /第一位仍保留记忆的证人/);
  assert.match(data.activeOutlines?.chapter?.content ?? '', /空白档案/);
  assert.match(data.generationProfiles?.style?.promptProjection ?? '', /克制、冷峻/);
  assert.equal(data.generationProfiles?.output?.targetWordCount, 4_000);
  assert.match(data.generationAssets?.storyAssets ?? '', /记忆交易所/);
  assert.match(data.generationAssets?.referenceMaterials ?? '', /回忆并不等同于事实/);
  assert.equal('drafts' in (data.chapters?.[0] ?? {}), false);
  assert.doesNotMatch(JSON.stringify(data), /历史正文不应被/);
});

test('readProjectContext degrades optional asset failure to a warning', async () => {
  const dependencies = contextDependencies();
  dependencies.loadGenerationAssets = async () => {
    throw new Error('fixture asset failure');
  };

  const result = await readProjectContext(
    { novelId: 'novel-context-fixture', chapterId: 'chapter-one' },
    dependencies,
  );

  assert.equal(result.ok, true);
  assert.match(result.warnings?.join('\n') ?? '', /无法读取参考资料或势力地点资产/);
  assert.deepEqual(
    (result.data as { generationAssets?: { sources?: unknown[] } }).generationAssets?.sources,
    [],
  );
});

test('readProjectContext includes legacy world background in asset relevance text', async () => {
  const dependencies = contextDependencies();
  let capturedRelevanceText = '';
  dependencies.loadGenerationAssets = async (_novelId, relevanceText) => {
    capturedRelevanceText = relevanceText;
    return { sources: [], warnings: [] };
  };

  const result = await readProjectContext(
    { novelId: 'novel-context-fixture', chapterId: 'chapter-one' },
    dependencies,
  );

  assert.equal(result.ok, true);
  assert.match(capturedRelevanceText, /旧版项目背景：旧城居民会在月末遗忘自己的姓名/);
  assert.match(
    (result.data as { novel?: { worldBackground?: string } }).novel?.worldBackground ?? '',
    /旧版项目背景/,
  );
});
