import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChapterCharacter } from '../../types/character';
import type { ChapterEvent } from '../../types/chapterEvent';
import type { Novel } from '../../types/novel';
import type { OutputProfile } from '../../types/output';
import type { Protagonist } from '../../types/protagonist';
import type { ReferenceWork } from '../../types/reference';
import type { RuleSystem, WorldSetting } from '../../types/setting';
import type { StyleProfile } from '../../types/style';
import type { ChapterOutline, MasterOutline, VolumeOutline } from '../../types/outline';
import {
  loadWorkbenchAssetScope,
  type WorkbenchAssetScopeDependencies,
} from './workbenchAssetScopeService';

const now = '2026-08-29T00:00:00.000Z';

function dependencies(
  overrides: Partial<WorkbenchAssetScopeDependencies> = {},
): WorkbenchAssetScopeDependencies {
  const novel = {
    id: 'novel-1',
    title: '雨夜档案',
    worldBackground: '旧城在每次大雾后更换街道编号。',
    protagonists: [{ name: '林澈' }],
  } as Novel;
  const style = {
    id: 'style-1',
    novelId: 'novel-1',
    name: '克制悬疑',
    updatedAt: now,
  } as StyleProfile;
  const output = {
    id: 'output-1',
    name: '四千字章节',
    updatedAt: now,
  } as OutputProfile;
  return {
    getNovel: async () => novel,
    getWorldSettings: async () =>
      [
        {
          id: 'world-1',
          novelId: 'novel-1',
          title: '雾港旧城',
          content: '雾会改变街道编号。',
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      ] as WorldSetting[],
    getRuleSystems: async () =>
      [
        {
          id: 'rule-1',
          novelId: 'novel-1',
          title: '目击规则',
          content: '同一人无法连续两夜看到同一扇门。',
          category: 'other',
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      ] as RuleSystem[],
    getProtagonist: async () => ({ name: '林澈', updatedAt: now }) as Protagonist,
    getMasterOutline: async () =>
      ({
        id: 'master-1',
        title: '全书追凶线',
        content: '追查雾门背后的失踪链条。',
        version: 3,
        updatedAt: now,
      }) as MasterOutline,
    getVolumeOutline: async () =>
      ({
        id: 'volume-1',
        title: '第一卷 雾门',
        content: '从第一位失踪者追到旧钟楼。',
        version: 2,
        updatedAt: now,
      }) as VolumeOutline,
    getChapterOutline: async () =>
      ({
        id: 'chapter-outline-1',
        title: '雨夜失踪',
        content: '主角在雨夜发现第一条反常线索。',
        version: 4,
        updatedAt: now,
      }) as ChapterOutline,
    getChapterCharacters: async () =>
      [
        { id: 'binding-1', characterId: 'character-1', characterName: '林澈' },
        { id: 'binding-2', characterId: 'character-2', characterName: '周遥' },
      ] as ChapterCharacter[],
    getChapterEvents: async () =>
      [
        { id: 'event-1', title: '钟楼停摆', status: 'required' },
        { id: 'event-2', title: '废弃候选', status: 'discarded' },
      ] as ChapterEvent[],
    getGenerationProfiles: async () => ({
      resolution: { styleProfileId: style.id, outputProfileId: output.id },
      style,
      output,
    }),
    getReferences: async () =>
      [
        { id: 'reference-1', purpose: 'research', sourceStatus: 'available' },
        { id: 'reference-2', purpose: 'style', sourceStatus: 'available' },
      ] as ReferenceWork[],
    ...overrides,
  };
}

test('workbench asset scope mirrors the selected production assets before a chapter run', async () => {
  const summary = await loadWorkbenchAssetScope(
    { novelId: 'novel-1', volumeId: 'volume-1', chapterId: 'chapter-1' },
    dependencies(),
  );

  assert.equal(summary.requiredMissingCount, 0);
  assert.equal(summary.unavailableCount, 0);
  assert.equal(summary.items.find((item) => item.key === 'world')?.value, '雾港旧城');
  assert.equal(summary.items.find((item) => item.key === 'rules')?.value, '目击规则');
  assert.equal(summary.items.find((item) => item.key === 'rules')?.required, true);
  assert.equal(summary.items.find((item) => item.key === 'master_outline')?.required, false);
  assert.equal(summary.items.find((item) => item.key === 'chapter_outline')?.required, true);
  assert.equal(
    summary.items.find((item) => item.key === 'chapter_characters')?.value,
    '林澈、周遥',
  );
  assert.equal(summary.items.find((item) => item.key === 'chapter_events')?.value, '钟楼停摆');
  assert.equal(summary.items.find((item) => item.key === 'style_profile')?.status, 'ready');
  assert.equal(summary.items.find((item) => item.key === 'output_profile')?.status, 'fallback');
  assert.equal(summary.items.find((item) => item.key === 'references')?.value, '研究 / 灵感 1 项');
  assert.deepEqual(
    summary.items
      .filter((item) =>
        ['adopted_chapter', 'context_record', 'memory_context', 'world_state'].includes(item.key),
      )
      .map(({ key, label, status, value }) => ({ key, label, status, value })),
    [
      {
        key: 'adopted_chapter',
        label: '前章采用稿',
        status: 'automatic',
        value: '生成前核验正式采用状态',
      },
      {
        key: 'context_record',
        label: 'Context',
        status: 'automatic',
        value: '按目标章节读取正式记录',
      },
      {
        key: 'memory_context',
        label: 'Memory',
        status: 'automatic',
        value: '按本轮指令检索',
      },
      {
        key: 'world_state',
        label: '世界状态',
        status: 'automatic',
        value: '由已采用总结与 Context 投影',
      },
    ],
  );
  assert.equal(
    summary.items
      .filter((item) =>
        ['adopted_chapter', 'context_record', 'memory_context', 'world_state'].includes(item.key),
      )
      .every((item) => item.evidence === undefined),
    true,
  );
  assert.equal(
    summary.items.some((item) => String(item.key) === 'runtime_continuity'),
    false,
  );
  assert.deepEqual(
    summary.items
      .filter((item) =>
        [
          'world',
          'rules',
          'protagonist',
          'master_outline',
          'volume_outline',
          'chapter_outline',
        ].includes(item.key),
      )
      .map(({ label }) => label),
    ['正式世界', '正式规则', '正式主角', '全书大纲', '分卷大纲', '章节大纲'],
  );

  const worldEvidence = summary.items.find((item) => item.key === 'world')?.evidence;
  assert.deepEqual(
    { source: worldEvidence?.source, revision: worldEvidence?.revision },
    { source: '正式世界设定', revision: '更新 2026-08-29' },
  );
  assert.match(worldEvidence?.fingerprint ?? '', /^sha256:[0-9a-f]{8}\.\.\.[0-9a-f]{4}$/u);
  assert.equal(
    summary.items.find((item) => item.key === 'rules')?.evidence?.source,
    '正式规则体系',
  );
  assert.equal(
    summary.items.find((item) => item.key === 'protagonist')?.evidence?.source,
    '正式主角档案',
  );
  assert.equal(
    summary.items.find((item) => item.key === 'master_outline')?.evidence?.revision,
    'v3',
  );
  assert.equal(
    summary.items.find((item) => item.key === 'chapter_outline')?.evidence?.source,
    '活动章节大纲',
  );

  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /雾会改变街道编号/u);
  assert.doesNotMatch(serialized, /同一人无法连续两夜/u);
  assert.doesNotMatch(serialized, /追查雾门背后的失踪链条/u);
  assert.doesNotMatch(serialized, /主角在雨夜发现第一条反常线索/u);
});

test('workbench asset scope distinguishes legacy fallbacks, missing required assets, and optional gaps', async () => {
  const summary = await loadWorkbenchAssetScope(
    { novelId: 'novel-1', chapterId: 'chapter-1' },
    dependencies({
      getWorldSettings: async () => [],
      getRuleSystems: async () => [],
      getProtagonist: async () => null,
      getMasterOutline: async () => null,
      getChapterOutline: async () => null,
      getChapterCharacters: async () => [],
      getChapterEvents: async () => [],
      getGenerationProfiles: async () => ({ resolution: {}, style: null, output: null }),
      getReferences: async () => [],
    }),
  );

  assert.equal(summary.items.find((item) => item.key === 'world')?.status, 'fallback');
  assert.equal(summary.items.find((item) => item.key === 'protagonist')?.status, 'fallback');
  assert.equal(
    summary.items.find((item) => item.key === 'world')?.evidence?.source,
    '作品背景回退',
  );
  assert.equal(
    summary.items.find((item) => item.key === 'protagonist')?.evidence?.source,
    '作品主角投影',
  );
  assert.equal(summary.items.find((item) => item.key === 'rules')?.status, 'missing');
  assert.equal(summary.items.find((item) => item.key === 'rules')?.required, true);
  assert.equal(summary.items.find((item) => item.key === 'master_outline')?.required, false);
  assert.equal(summary.items.find((item) => item.key === 'chapter_characters')?.required, false);
  assert.equal(summary.requiredMissingCount, 2);
  assert.doesNotMatch(JSON.stringify(summary), /旧城在每次大雾后更换街道编号/u);
});

test('workbench asset scope reports a failed source instead of presenting it as absent', async () => {
  const summary = await loadWorkbenchAssetScope(
    { novelId: 'novel-1' },
    dependencies({
      getRuleSystems: async () => {
        throw new Error('sqlite unavailable');
      },
    }),
  );

  const rules = summary.items.find((item) => item.key === 'rules');
  assert.equal(rules?.status, 'unavailable');
  assert.equal(rules?.value, '读取失败');
  assert.equal(rules?.required, true);
  assert.equal(summary.unavailableCount, 1);
  assert.equal(summary.requiredMissingCount, 1);
});
