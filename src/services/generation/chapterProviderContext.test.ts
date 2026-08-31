import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ChapterGenerationSnapshot,
  GenerationContextSection,
} from '../../types/generationContext';
import { CHAPTER_GENERATION_ALLOWED_SOURCE_TYPES } from '../ai/compilation/chapterGenerationSourcePolicy';
import { buildChapterProviderContextSources } from './chapterProviderContext';

function snapshot(sections: GenerationContextSection[]): ChapterGenerationSnapshot {
  return {
    id: 'snapshot-provider-context-001',
    novelId: 'novel-provider-context-001',
    chapterId: 'chapter-provider-context-003',
    compiledContext: {
      novelId: 'novel-provider-context-001',
      chapterId: 'chapter-provider-context-003',
      baseContext: {
        novelTitle: '潮汐旧案',
        chapterTitle: '第三章',
      },
      sections,
      sources: [],
      warnings: [],
      compiledAt: '2026-08-29T00:00:00.000Z',
    },
    compiledPromptText: sections.map((section) => section.content).join('\n'),
    promptSummary: 'provider context fixture',
    contextHash: 'a'.repeat(64),
    sources: [],
    createdAt: '2026-08-29T00:00:00.000Z',
  };
}

const canonicalSections: GenerationContextSection[] = [
  { key: 'novel', title: '作品与世界', content: 'NOVEL_CANARY', sourceTypes: ['novel'] },
  {
    key: 'world_settings',
    title: '补充世界设定',
    content: 'WORLD_CANARY',
    sourceTypes: ['world_setting'],
  },
  {
    key: 'world_state_timeline',
    title: '持久化世界状态与时间线',
    content: 'TIMELINE_CANARY',
    sourceTypes: ['world_state'],
  },
  {
    key: 'protagonist',
    title: '主角与角色',
    content: 'PROTAGONIST_CANARY',
    sourceTypes: ['protagonist', 'chapter_character'],
  },
  {
    key: 'character_states',
    title: '人物动态状态',
    content: 'CHARACTER_STATE_CANARY',
    sourceTypes: ['character_state'],
  },
  {
    key: 'outline',
    title: '大纲与剧情锚点',
    content: 'OUTLINE_CANARY',
    sourceTypes: ['master_outline', 'chapter_outline'],
  },
  {
    key: 'story_assets',
    title: '相关势力与地点',
    content: 'STORY_ASSET_CANARY',
    sourceTypes: ['faction', 'location'],
  },
  {
    key: 'engineering',
    title: '章节工程状态',
    content: 'ENGINEERING_CANARY',
    sourceTypes: ['chapter_engineering'],
  },
  {
    key: 'context_records',
    title: '创作上下文包',
    content: 'CONTEXT_RECORD_CANARY',
    sourceTypes: ['context_record'],
  },
  {
    key: 'memory_context',
    title: '长期记忆',
    content: 'MEMORY_CANARY',
    sourceTypes: ['memory_context'],
  },
  {
    key: 'user_instruction',
    title: '冻结用户指令',
    content: 'FROZEN_INSTRUCTION_CANARY',
    sourceTypes: ['user_instruction'],
  },
  {
    key: 'adopted_previous_chapter',
    title: '前章采用稿',
    content: 'ADOPTED_DRAFT_CANARY',
    sourceTypes: ['adopted_chapter'],
  },
  {
    key: 'provisional_previous_chapter',
    title: '前章临时候选',
    content: 'PROVISIONAL_DRAFT_CANARY',
    sourceTypes: ['provisional_candidate'],
  },
  {
    key: 'style_output',
    title: '风格与输出控制',
    content: 'STYLE_OUTPUT_CANARY',
    sourceTypes: ['style_profile', 'output_profile'],
  },
  {
    key: 'reference_materials',
    title: '参考资料约束',
    content: 'REFERENCE_CANARY',
    sourceTypes: ['reference_material'],
  },
  {
    key: 'current_editor',
    title: '当前正文修改',
    content: 'EDITOR_CANARY',
    sourceTypes: ['current_editor'],
  },
  {
    key: 'cross_chapter_continuity',
    title: '跨章连续性硬约束',
    content: 'CONTINUITY_CANARY',
    sourceTypes: ['context_record'],
  },
];

test('frozen snapshot sections become independent typed Provider sources', () => {
  const sources = buildChapterProviderContextSources({
    snapshot: snapshot(canonicalSections),
    requestSourceVersion: 'request-version-001',
    requestInstruction: '生成第三章正文。',
  });
  const byContent = new Map(sources.map((source) => [source.content, source]));

  assert.equal(sources.length, canonicalSections.length);
  assert.equal(byContent.get('NOVEL_CANARY')?.sourceType, 'novel');
  assert.equal(byContent.get('NOVEL_CANARY')?.sourceId, 'novel-provider-context-001');
  assert.equal(byContent.get('WORLD_CANARY')?.sourceType, 'world_setting');
  assert.equal(byContent.get('TIMELINE_CANARY')?.sourceType, 'context_record');
  assert.equal(byContent.get('PROTAGONIST_CANARY')?.sourceType, 'protagonist');
  assert.equal(byContent.get('CHARACTER_STATE_CANARY')?.sourceType, 'character');
  assert.equal(byContent.get('OUTLINE_CANARY')?.sourceType, 'outline');
  assert.equal(byContent.get('STORY_ASSET_CANARY')?.sourceType, 'world_setting');
  assert.equal(byContent.get('ENGINEERING_CANARY')?.sourceType, 'context_record');
  assert.equal(byContent.get('CONTEXT_RECORD_CANARY')?.sourceType, 'context_record');
  assert.equal(byContent.get('MEMORY_CANARY')?.sourceType, 'memory_context');
  assert.equal(byContent.get('FROZEN_INSTRUCTION_CANARY')?.sourceType, 'context_record');
  assert.equal(byContent.get('ADOPTED_DRAFT_CANARY')?.sourceType, 'draft');
  assert.equal(byContent.get('PROVISIONAL_DRAFT_CANARY')?.sourceType, 'draft');
  assert.equal(byContent.get('STYLE_OUTPUT_CANARY')?.sourceType, 'output_profile');
  assert.equal(byContent.get('REFERENCE_CANARY')?.sourceType, 'context_record');
  assert.equal(byContent.has('EDITOR_CANARY'), false);
  assert.equal(byContent.get('CONTINUITY_CANARY')?.sourceType, 'context_record');

  for (const content of [
    'NOVEL_CANARY',
    'PROTAGONIST_CANARY',
    'OUTLINE_CANARY',
    'CONTINUITY_CANARY',
  ]) {
    assert.equal(byContent.get(content)?.required, true);
    assert.equal(byContent.get(content)?.requireFull, true);
  }
  assert.equal(byContent.get('WORLD_CANARY')?.required, false);
  assert.equal(
    sources.some(
      (source) =>
        source.content.includes('NOVEL_CANARY') && source.content.includes('OUTLINE_CANARY'),
    ),
    false,
  );
});

test('source ordering and identities are deterministic and unique', () => {
  const sources = buildChapterProviderContextSources({
    snapshot: snapshot([...canonicalSections].reverse()),
    requestSourceVersion: 'request-version-ordering',
    requestInstruction: '继续写。',
  });
  const identities = sources.map((source) => `${source.sourceType}:${source.sourceId}`);
  const request = sources[0];

  assert.equal(new Set(identities).size, sources.length);
  assert.equal(new Set(sources.map((source) => source.order)).size, sources.length);
  assert.deepEqual(
    sources.map((source) => source.order),
    sources.map((_, index) => index * 10),
  );
  assert.equal(request.sourceType, 'request_context');
  assert.equal(request.required, true);
  assert.equal(request.sourceVersion, 'request-version-ordering');
  assert.equal(
    sources.find((source) => source.content === 'NOVEL_CANARY')?.sourceId,
    snapshot([]).novelId,
  );
});

test('an empty snapshot section list still returns the required request source', () => {
  const sources = buildChapterProviderContextSources({
    snapshot: snapshot([]),
    requestSourceVersion: 'request-version-empty',
    requestInstruction: '写一个悬疑故事。',
  });

  assert.deepEqual(
    sources.map(({ sourceType, sourceVersion, required, content }) => ({
      sourceType,
      sourceVersion,
      required,
      content,
    })),
    [
      {
        sourceType: 'request_context',
        sourceVersion: 'request-version-empty',
        required: true,
        content: '写一个悬疑故事。',
      },
    ],
  );
});

test('repair draft remains an independent required source with its own version', () => {
  const sources = buildChapterProviderContextSources({
    snapshot: snapshot(canonicalSections.slice(0, 3)),
    requestSourceVersion: 'repair-request-version-002',
    requestInstruction: '把正文压缩到三千字。',
    currentDraft: {
      content: 'REPAIR_DRAFT_CANARY',
      sourceVersion: 'draft-content-sha256-002',
    },
  });
  const request = sources.find((source) => source.sourceType === 'request_context');
  const draft = sources.find((source) => source.content === 'REPAIR_DRAFT_CANARY');

  assert.equal(request?.sourceVersion, 'repair-request-version-002');
  assert.equal(request?.required, true);
  assert.equal(draft?.sourceType, 'draft');
  assert.equal(draft?.sourceVersion, 'draft-content-sha256-002');
  assert.equal(draft?.required, true);
  assert.equal(draft?.origin, 'request');
  assert.equal(new Set(sources.map((source) => source.sourceId)).size, sources.length);
});

test('chapter generation registry accepts every projected Provider source type', () => {
  const sources = buildChapterProviderContextSources({
    snapshot: snapshot(canonicalSections),
    requestSourceVersion: 'request-version-registry',
    requestInstruction: '继续写。',
    currentDraft: {
      content: 'REGISTRY_DRAFT_CANARY',
      sourceVersion: 'draft-version-registry',
    },
  });

  assert.deepEqual(
    [...new Set(sources.map((source) => source.sourceType))].filter(
      (sourceType) => !CHAPTER_GENERATION_ALLOWED_SOURCE_TYPES.includes(sourceType),
    ),
    [],
  );
});
