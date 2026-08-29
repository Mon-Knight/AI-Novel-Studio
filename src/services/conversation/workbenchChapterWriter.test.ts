import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChapterGenerationSnapshot } from '../../types/generationContext';
import type { AiSettings } from '../../types/ai';
import type { TaskModelSnapshot } from '../../types/conversation';
import type { ChapterGenerationExecutionInput } from '../ai/chapterGenerationExecutionService';
import type { AiProviderRequestEvidence } from '../ai/aiExecutionPipeline';
import { routeCreativeTask } from '../ai/runtime/modelRouter';
import { limitContinuityText } from '../generation/generationContextCompiler';
import {
  compileGenerationContextSnapshot,
  type GenerationCoreAssetsMissingError,
} from '../generation/generationContextCompiler';
import { loadGenerationAssetContext } from '../generation/generationAssetContext';
import {
  selectGenerationOutputProfile,
  selectGenerationStyleProfile,
} from '../styles/generationProfileResolver';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import {
  createWorkbenchChapterWriter,
  findPreviousChapterForContinuity,
  resolveChapterWordRange,
  type WorkbenchChapterWriterDependencies,
} from './workbenchChapterWriter';
import type { Chapter } from '../../types/chapter';
import type { Volume } from '../../types/volume';
import type { OutputProfile } from '../../types/output';
import type { StyleProfile } from '../../types/style';
import {
  buildCharacterStatePromptContext,
  hasContextPromptMaterial,
} from '../prompt/contextBuilder';
import type { Character } from '../../types/character';

const snapshot: ChapterGenerationSnapshot = {
  id: 'snapshot-001',
  novelId: 'novel-001',
  chapterId: 'chapter-003',
  compiledContext: {
    novelId: 'novel-001',
    chapterId: 'chapter-003',
    baseContext: {
      novelTitle: '冻结模型测试作品',
      chapterTitle: '第三章',
      targetWordCount: 3000,
    },
    sections: [],
    sources: [],
    warnings: [],
    compiledAt: '2026-08-23T00:00:00.000Z',
  },
  compiledPromptText: 'compiled prompt',
  promptSummary: 'summary',
  contextHash: 'context-hash-001',
  sources: [],
  createdAt: '2026-08-23T00:00:00.000Z',
};

const baseSettings: AiSettings = {
  runtimeMode: 'mock',
  provider: 'mock',
  baseUrl: '',
  apiKey: '',
  modelName: 'Global Model Must Not Win',
  mockMode: true,
};

const frozenModel: TaskModelSnapshot = {
  providerId: 'mock',
  modelId: 'Frozen Mock',
  runtimeMode: 'mock',
  capabilities: ['chapter_generate'],
  options: { temperature: 0.42, maxTokens: 5200, timeoutSeconds: 66 },
  capturedAt: '2026-08-23T00:00:00.000Z',
};

const noPreviousAdoptedChapter = async () => ({ status: 'none' as const });

const providerRequestEvidence: AiProviderRequestEvidence = {
  schemaVersion: 'provider_request_evidence_v1',
  hashAlgorithm: 'sha256',
  messagesSerialization: 'json_stringify_messages_v1',
  messagesSha256: '1'.repeat(64),
  messageCount: 2,
  compiledContextSha256: '2'.repeat(64),
  requestContextSources: [
    {
      sourceVersion: snapshot.contextHash,
      contentSha256: '3'.repeat(64),
      includedSha256: '3'.repeat(64),
      status: 'included',
    },
  ],
};

const inRangeChapterCandidate = '正'.repeat(3_000);

function createTestWorkbenchChapterWriter(deps: WorkbenchChapterWriterDependencies = {}) {
  return createWorkbenchChapterWriter({
    resolveGenerationProfiles: async () => ({}),
    ...deps,
  });
}

function chapter(id: string, volumeId: string, orderIndex: number): Chapter {
  return {
    id,
    novelId: 'novel-001',
    volumeId,
    title: id,
    chapterNumber: orderIndex + 1,
    orderIndex,
    sortOrder: orderIndex,
    status: 'adopted',
    wordCount: 100,
    currentWords: 100,
    targetWords: 100,
    drafts: [],
    createdAt: `2026-08-23T00:00:0${orderIndex}.000Z`,
    updatedAt: `2026-08-23T00:00:0${orderIndex}.000Z`,
  };
}

function volume(id: string, orderIndex: number): Volume {
  return {
    id,
    novelId: 'novel-001',
    title: id,
    orderIndex,
    volumeNumber: orderIndex + 1,
    sortOrder: orderIndex,
    status: 'writing',
    createdAt: `2026-08-23T00:00:0${orderIndex}.000Z`,
    updatedAt: `2026-08-23T00:00:0${orderIndex}.000Z`,
  };
}

test('continuity ordering follows volume order before the volume-local chapter index', () => {
  const volumes = [volume('volume-002', 1), volume('volume-001', 0)];
  const chapters = [
    chapter('chapter-002-001', 'volume-002', 0),
    chapter('chapter-001-002', 'volume-001', 1),
    chapter('chapter-002-002', 'volume-002', 1),
    chapter('chapter-001-001', 'volume-001', 0),
  ];

  assert.equal(
    findPreviousChapterForContinuity(chapters, volumes, 'chapter-002-001')?.id,
    'chapter-001-002',
  );
  assert.equal(
    findPreviousChapterForContinuity(chapters, volumes, 'chapter-002-002')?.id,
    'chapter-002-001',
  );
  assert.equal(findPreviousChapterForContinuity(chapters, volumes, 'chapter-001-001'), undefined);
});

test('manual ContextRecord alone is eligible for the Writer context prompt', () => {
  assert.equal(
    hasContextPromptMaterial({
      chapterSummaries: [],
      volumeContexts: [],
      manualContexts: [{} as never],
    }),
    true,
  );
  assert.equal(
    hasContextPromptMaterial({ chapterSummaries: [], volumeContexts: [], manualContexts: [] }),
    false,
  );
});

test('character state context freezes only the latest state before the target chapter', () => {
  const chapters = [
    chapter('chapter-001', 'volume-001', 0),
    chapter('chapter-002', 'volume-001', 1),
  ];
  const character: Character = {
    id: 'character-001',
    novelId: 'novel-001',
    name: '顾闻舟',
    roleType: 'protagonist',
    currentState: '不应覆盖已有历史记录',
    source: 'manual',
    isActive: true,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
  };
  const context = buildCharacterStatePromptContext({
    histories: [
      {
        character,
        states: [
          {
            id: 'state-current',
            novelId: 'novel-001',
            characterId: character.id,
            chapterId: 'chapter-002',
            stateSummary: '当前章之后才成立的状态',
            createdAt: '2026-08-22T00:00:00.000Z',
          },
          {
            id: 'state-previous',
            novelId: 'novel-001',
            characterId: character.id,
            chapterId: 'chapter-001',
            stateSummary: '左手受伤，仍持有铜钥匙',
            location: '潮汐档案馆',
            createdAt: '2026-08-21T00:00:00.000Z',
          },
        ],
      },
    ],
    chapters,
    volumes: [volume('volume-001', 0)],
    currentChapterId: 'chapter-002',
  });

  assert.match(context.summary ?? '', /左手受伤，仍持有铜钥匙/);
  assert.doesNotMatch(context.summary ?? '', /当前章之后才成立/);
  assert.equal(context.sources[0]?.id, 'state-previous');
  assert.equal(context.sources[0]?.origin, 'character_state');
});

test('long continuity context preserves the authoritative final state', () => {
  const source = `开场锚点${'中段'.repeat(5_000)}最终倒计时仍为十八分四十一秒`;
  const limited = limitContinuityText(source, 1_000);

  assert.ok(limited.length <= 1_000);
  assert.match(limited, /^开场锚点/);
  assert.match(limited, /已截断中段/);
  assert.match(limited, /最终倒计时仍为十八分四十一秒$/);
});

test('durable content hashing returns SHA-256 and fails closed without Web Crypto', async () => {
  assert.equal(
    await computeContentSha256('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );

  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    await assert.rejects(
      computeContentSha256('continuity'),
      (error: unknown) =>
        error instanceof Error &&
        (error as Error & { code?: string }).code === 'CONTENT_SHA256_UNAVAILABLE',
    );
  } finally {
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
  }
});

test('writer uses the frozen model and injects memory plus previous candidate', async () => {
  let captured: ChapterGenerationExecutionInput | undefined;
  let compiledInput:
    Parameters<NonNullable<WorkbenchChapterWriterDependencies['compileContext']>>[0] | undefined;
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => baseSettings,
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    resolveGenerationProfiles: async () => ({
      styleProfileId: 'style-active-001',
      outputProfileId: 'output-default-001',
    }),
    compileContext: async (input) => {
      compiledInput = input;
      const contextSources: ChapterGenerationSnapshot['sources'] = [
        {
          type: 'world_setting',
          title: '世界设定',
          status: 'used',
          sourceId: 'world-setting-private-id',
          summary: '不应进入工作台回执的内部摘要',
        },
        { type: 'memory_context', title: '长期记忆', status: 'missing' },
      ];
      return {
        ...snapshot,
        styleProfileId: input.styleProfileId,
        outputProfileId: input.outputProfileId,
        sources: contextSources,
        compiledPromptText: [
          snapshot.compiledPromptText,
          input.retrievedMemoryContext,
          input.currentEditorContent,
        ]
          .filter(Boolean)
          .join('\n'),
      };
    },
    executeGeneration: async (input) => {
      captured = input;
      return {
        persistence: 'ephemeral_browser',
        text: inRangeChapterCandidate,
        taskId: 'generation-task-001',
        attemptId: 'generation-attempt-001',
        providerRequestEvidence,
        provider: {
          text: inRangeChapterCandidate,
          providerId: 'mock',
          modelId: 'Frozen Mock',
          durationMs: 12,
        },
      };
    },
  });

  const result = await writer.generate({
    novelId: 'novel-001',
    chapterId: 'chapter-003',
    goal: '重写第三章并加强铜钥匙伏笔',
    mode: 'generate',
    previousCandidateText: '上一版章节候选正文。',
    memoryContext: { items: [{ text: '铜钥匙只能在月光下开启。' }] },
    modelSnapshot: frozenModel,
  });

  assert.equal(result.source, 'writer');
  assert.deepEqual(result.providerRequestEvidence, {
    schemaVersion: 'workbench_provider_request_evidence_v1',
    hashAlgorithm: 'sha256',
    messagesSerialization: 'json_stringify_messages_v1',
    taskId: 'generation-task-001',
    attemptId: 'generation-attempt-001',
    messagesSha256: '1'.repeat(64),
    messageCount: 2,
    compiledContextSha256: '2'.repeat(64),
    snapshotContextHash: snapshot.contextHash,
    snapshotCompiledPromptSha256: await computeContentSha256(
      [
        snapshot.compiledPromptText,
        compiledInput?.retrievedMemoryContext,
        compiledInput?.currentEditorContent,
      ]
        .filter(Boolean)
        .join('\n'),
    ),
    snapshotRequestSourceSha256: '3'.repeat(64),
    includedSnapshotRequestSourceSha256: '3'.repeat(64),
    snapshotRequestSourceStatus: 'included',
  });
  assert.deepEqual(result.contextSources, [
    { type: 'world_setting', title: '世界设定', status: 'used' },
    { type: 'memory_context', title: '长期记忆', status: 'missing' },
  ]);
  assert.equal(captured?.settings.modelName, 'Frozen Mock');
  assert.equal(captured?.settings.temperature, 0.42);
  assert.equal(captured?.settings.maxTokens, 5200);
  assert.equal(captured?.settings.timeoutSeconds, 66);
  assert.equal(captured?.taskInput.mode, 'rewrite');
  assert.equal(compiledInput?.styleProfileId, 'style-active-001');
  assert.equal(compiledInput?.outputProfileId, 'output-default-001');
  assert.equal(compiledInput?.requireCoreAssets, true);
  assert.match(compiledInput?.retrievedMemoryContext ?? '', /铜钥匙只能在月光下开启/);
  assert.equal(compiledInput?.currentEditorContent, '上一版章节候选正文。');
  const prompt = captured?.request.messages.map((message) => message.content).join('\n') ?? '';
  assert.match(prompt, /铜钥匙只能在月光下开启/);
  assert.match(prompt, /上一版章节候选正文/);
  assert.doesNotMatch(prompt, /【检索到的长期记忆事实】/);
});

test('writer rewrites an oversized chapter through the same frozen model before publishing', async () => {
  const oversized = '甲'.repeat(150);
  const repaired = '乙'.repeat(100);
  const calls: ChapterGenerationExecutionInput[] = [];
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => baseSettings,
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    compileContext: async () => ({
      ...snapshot,
      compiledContext: {
        ...snapshot.compiledContext,
        baseContext: {
          ...snapshot.compiledContext.baseContext,
          targetWordCount: 100,
        },
      },
    }),
    executeGeneration: async (input) => {
      calls.push(input);
      const text = calls.length === 1 ? oversized : repaired;
      return {
        persistence: 'ephemeral_browser',
        text,
        taskId: `generation-task-${calls.length}`,
        attemptId: `generation-attempt-${calls.length}`,
        providerRequestEvidence: {
          ...providerRequestEvidence,
          messagesSha256: String(calls.length).repeat(64),
          requestContextSources: [
            {
              sourceVersion: input.sourceVersion,
              contentSha256: String(calls.length + 2).repeat(64),
              includedSha256: String(calls.length + 2).repeat(64),
              status: 'included',
            },
          ],
        },
        provider: {
          text,
          providerId: 'mock',
          modelId: 'Frozen Mock',
          durationMs: 12,
        },
      };
    },
  });

  const result = await writer.generate({
    novelId: 'novel-001',
    chapterId: 'chapter-003',
    goal: '生成本章正文',
    mode: 'generate',
    modelSnapshot: frozenModel,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.settings.modelName, 'Frozen Mock');
  assert.equal(calls[1]?.taskInput.purpose, 'workbench_chapter_length_repair');
  assert.equal(calls[1]?.taskInput.maximumWordCount, 105);
  assert.equal(calls[1]?.request.promptTemplateSource, 'generation_context_snapshot:length_repair');
  assert.match(calls[1]?.request.messages[0]?.content ?? '', /90-105/);
  assert.match(calls[1]?.request.messages[1]?.content ?? '', /冻结 generation_context_snapshot/);
  assert.match(calls[1]?.request.messages[1]?.content ?? '', /compiled prompt/);
  assert.match(calls[1]?.request.messages[1]?.content ?? '', /甲{20}/);
  assert.equal(result.text, repaired);
  assert.equal(result.targetWordCount, 100);
  assert.equal(result.originalWordCount, 150);
  assert.equal(result.finalWordCount, 100);
  assert.equal(result.lengthRepairCount, 1);
  assert.equal(result.taskId, 'generation-task-2');
  assert.equal(result.providerRequestEvidence?.taskId, result.taskId);
  assert.equal(result.providerRequestEvidence?.attemptId, 'generation-attempt-2');
  assert.equal(result.providerRequestEvidence?.messagesSha256, '2'.repeat(64));
  assert.equal(result.providerRequestEvidence?.snapshotRequestSourceSha256, '4'.repeat(64));
  assert.deepEqual(resolveChapterWordRange(100), {
    target: 100,
    minimum: 90,
    maximum: 105,
    fallbackMinimum: 85,
    fallbackMaximum: 95,
    finalMinimum: 80,
    finalMaximum: 90,
    hardMinimum: 80,
    hardMaximum: 115,
  });
});

test('writer routes pollution introduced by length repair through integrity repair', async () => {
  const oversized = '甲'.repeat(150);
  const pollutedLengthRepair = `${'乙'.repeat(96)}。经典三级`;
  const integrityRepaired = `${'丙'.repeat(99)}。`;
  const calls: ChapterGenerationExecutionInput[] = [];
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => baseSettings,
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    compileContext: async () => ({
      ...snapshot,
      compiledContext: {
        ...snapshot.compiledContext,
        baseContext: {
          ...snapshot.compiledContext.baseContext,
          targetWordCount: 100,
        },
      },
    }),
    executeGeneration: async (input) => {
      calls.push(input);
      const text =
        calls.length === 1
          ? oversized
          : calls.length === 2
            ? pollutedLengthRepair
            : integrityRepaired;
      return {
        persistence: 'ephemeral_browser',
        text,
        taskId: `generation-task-${calls.length}`,
        attemptId: `generation-attempt-${calls.length}`,
        provider: {
          text,
          providerId: 'mock',
          modelId: 'Frozen Mock',
          durationMs: 12,
        },
      };
    },
  });

  const result = await writer.generate({
    novelId: 'novel-001',
    chapterId: 'chapter-003',
    goal: '生成本章正文',
    mode: 'generate',
    modelSnapshot: frozenModel,
  });

  assert.deepEqual(
    calls.map((call) => call.taskInput.purpose),
    [
      'workbench_chapter_candidate',
      'workbench_chapter_length_repair',
      'workbench_chapter_integrity_repair',
    ],
  );
  assert.deepEqual(calls[2]?.taskInput.issueCodes, ['chapter_tail_pollution']);
  assert.equal(result.text, integrityRepaired);
  assert.equal(result.lengthRepairCount, 1);
  assert.equal(result.integrityRepairCount, 1);
});

test('writer never reuses initial request evidence when the final repair has no evidence', async () => {
  let calls = 0;
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => baseSettings,
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    compileContext: async () => ({
      ...snapshot,
      compiledContext: {
        ...snapshot.compiledContext,
        baseContext: { ...snapshot.compiledContext.baseContext, targetWordCount: 100 },
      },
    }),
    executeGeneration: async () => {
      calls += 1;
      const text = calls === 1 ? '甲'.repeat(150) : '乙'.repeat(100);
      return {
        persistence: 'ephemeral_browser',
        text,
        taskId: `generation-task-${calls}`,
        attemptId: `generation-attempt-${calls}`,
        ...(calls === 1 ? { providerRequestEvidence } : {}),
        provider: { text, providerId: 'mock', modelId: 'Frozen Mock', durationMs: 12 },
      };
    },
  });

  const result = await writer.generate({
    novelId: 'novel-001',
    chapterId: 'chapter-003',
    goal: '生成本章正文',
    mode: 'generate',
    modelSnapshot: frozenModel,
  });

  assert.equal(calls, 2);
  assert.equal(result.taskId, 'generation-task-2');
  assert.equal(result.providerRequestEvidence, undefined);
});

test('writer repairs an opening rollback and returns evidence from the integrity repair', async () => {
  const repeatedOpening = '“你为什么不问他们，为什么报警广播出现在没有发布警报的夜里？”';
  const previousChapterText = [
    '沈砚走进档案馆，开始核对录音和值班记录。',
    '前文调查。'.repeat(120),
    repeatedOpening,
    '匿名人已经离开值班室，沈砚也完成了双份备份。'.repeat(20),
    '录音最后的声音说，门在水下。',
  ].join('\n');
  const rollbackCandidate = `${repeatedOpening}${'甲'.repeat(2_950)}。`;
  const repairedCandidate = `${'乙'.repeat(3_000)}。`;
  const calls: ChapterGenerationExecutionInput[] = [];
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => baseSettings,
    loadAdoptedPreviousChapter: async () => ({
      status: 'adopted',
      context: {
        chapterId: 'chapter-002',
        draftId: 'draft-adopted-002',
        contentHash: 'previous-adopted-content-hash',
        content: previousChapterText,
      },
    }),
    compileContext: async () => snapshot,
    executeGeneration: async (input) => {
      calls.push(input);
      const callNumber = calls.length;
      const text = callNumber === 1 ? rollbackCandidate : repairedCandidate;
      return {
        persistence: 'ephemeral_browser',
        text,
        taskId: `generation-task-${callNumber}`,
        attemptId: `generation-attempt-${callNumber}`,
        providerRequestEvidence: {
          ...providerRequestEvidence,
          messagesSha256: String(callNumber).repeat(64),
          requestContextSources: [
            {
              sourceVersion: input.sourceVersion,
              contentSha256: String(callNumber + 2).repeat(64),
              includedSha256: String(callNumber + 2).repeat(64),
              status: 'included',
            },
          ],
        },
        provider: { text, providerId: 'mock', modelId: 'Frozen Mock', durationMs: 12 },
      };
    },
  });

  const result = await writer.generate({
    novelId: 'novel-001',
    chapterId: 'chapter-003',
    goal: '继续生成第三章',
    mode: 'generate',
    modelSnapshot: frozenModel,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.taskInput.purpose, 'workbench_chapter_integrity_repair');
  assert.deepEqual(calls[1]?.taskInput.issueCodes, ['chapter_opening_rollback']);
  assert.equal(calls[1]?.taskInput.integrityRepairAttempt, 1);
  assert.equal(
    calls[1]?.request.promptTemplateSource,
    'generation_context_snapshot:integrity_repair',
  );
  assert.match(calls[1]?.request.messages[0]?.content ?? '', /已完成动作的重演/);
  assert.match(calls[1]?.request.messages[1]?.content ?? '', /chapter_opening_rollback/);
  assert.equal(calls[1]?.sourceVersion, await computeContentSha256(rollbackCandidate.trim()));
  assert.equal(result.text, repairedCandidate);
  assert.equal(result.lengthRepairCount, 0);
  assert.equal(result.integrityRepairCount, 1);
  assert.deepEqual(result.integrityRepairAttempts, [
    {
      attempt: 1,
      issueCodes: ['chapter_opening_rollback'],
      sourceContentHash: await computeContentSha256(rollbackCandidate.trim()),
    },
  ]);
  assert.equal(result.taskId, 'generation-task-2');
  assert.equal(result.providerRequestEvidence?.taskId, 'generation-task-2');
  assert.equal(result.providerRequestEvidence?.attemptId, 'generation-attempt-2');
  assert.equal(result.providerRequestEvidence?.messagesSha256, '2'.repeat(64));
  assert.equal(result.providerRequestEvidence?.snapshotRequestSourceSha256, '4'.repeat(64));
});

test('writer repairs a short polluted suffix without consuming a length repair', async () => {
  const pollutedCandidate = `${'甲'.repeat(2_990)}。经典三级`;
  const repairedCandidate = `${'乙'.repeat(3_000)}。`;
  const calls: ChapterGenerationExecutionInput[] = [];
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => baseSettings,
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    compileContext: async () => snapshot,
    executeGeneration: async (input) => {
      calls.push(input);
      const text = calls.length === 1 ? pollutedCandidate : repairedCandidate;
      return {
        persistence: 'ephemeral_browser',
        text,
        provider: { text, providerId: 'mock', modelId: 'Frozen Mock', durationMs: 12 },
      };
    },
  });

  const result = await writer.generate({
    novelId: 'novel-001',
    chapterId: 'chapter-003',
    goal: '生成本章正文',
    mode: 'generate',
    modelSnapshot: frozenModel,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.taskInput.purpose, 'workbench_chapter_integrity_repair');
  assert.deepEqual(calls[1]?.taskInput.issueCodes, ['chapter_tail_pollution']);
  assert.equal(calls[1]?.taskInput.integrityRepairAttempt, 1);
  assert.match(calls[1]?.request.messages[0]?.content ?? '', /清除合法故事结尾之后/);
  assert.equal(result.text, repairedCandidate);
  assert.equal(result.lengthRepairCount, 0);
  assert.equal(result.integrityRepairCount, 1);
});

test('writer repairs Gate-style meta reasoning leakage and returns clean prose', async () => {
  const leakedCandidate = [
    `${'甲'.repeat(2_800)}。`,
    'Wait avoid typo. Need continue. We need preserve the chapter constraints.',
    "Let's revise the final paragraphs. Let's craft final prose around 3000 Chinese characters.",
  ].join('\n');
  const repairedCandidate = `${'乙'.repeat(3_000)}。`;
  const calls: ChapterGenerationExecutionInput[] = [];
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => baseSettings,
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    compileContext: async () => snapshot,
    executeGeneration: async (input) => {
      calls.push(input);
      const text = calls.length === 1 ? leakedCandidate : repairedCandidate;
      return {
        persistence: 'ephemeral_browser',
        text,
        provider: { text, providerId: 'mock', modelId: 'Frozen Mock', durationMs: 12 },
      };
    },
  });

  const result = await writer.generate({
    novelId: 'novel-001',
    chapterId: 'chapter-003',
    goal: '生成本章正文',
    mode: 'generate',
    modelSnapshot: frozenModel,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.taskInput.purpose, 'workbench_chapter_integrity_repair');
  assert.deepEqual(calls[1]?.taskInput.issueCodes, ['chapter_meta_reasoning_leakage']);
  assert.equal(calls[1]?.taskInput.integrityRepairAttempt, 1);
  assert.match(calls[1]?.request.messages[1]?.content ?? '', /chapter_meta_reasoning_leakage/);
  assert.equal(result.text, repairedCandidate);
  assert.equal(result.lengthRepairCount, 0);
  assert.equal(result.integrityRepairCount, 1);
});

test('writer fails closed after two integrity repairs still leak meta reasoning', async () => {
  const leakedCandidate = [
    `${'甲'.repeat(2_800)}。`,
    'Wait avoid typo. Need continue. We need preserve the chapter constraints.',
    "Let's revise the final paragraphs. Let's craft final prose around 3000 Chinese characters.",
  ].join('\n');
  const calls: ChapterGenerationExecutionInput[] = [];
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => baseSettings,
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    compileContext: async () => snapshot,
    executeGeneration: async (input) => {
      calls.push(input);
      return {
        persistence: 'ephemeral_browser',
        text: leakedCandidate,
        provider: {
          text: leakedCandidate,
          providerId: 'mock',
          modelId: 'Frozen Mock',
          durationMs: 12,
        },
      };
    },
  });

  await assert.rejects(
    writer.generate({
      novelId: 'novel-001',
      chapterId: 'chapter-003',
      goal: '生成本章正文',
      mode: 'generate',
      modelSnapshot: frozenModel,
    }),
    (error: unknown) => {
      const writerError = error as Error & { code?: string };
      assert.equal(writerError.code, 'WORKBENCH_CHAPTER_INTEGRITY_FAILED');
      assert.match(writerError.message, /2 次完整性修复/);
      assert.match(writerError.message, /chapter_meta_reasoning_leakage/);
      assert.doesNotMatch(writerError.message, /Wait avoid typo|Let's craft/);
      return true;
    },
  );

  assert.equal(calls.length, 3);
  assert.equal(calls[1]?.taskInput.integrityRepairAttempt, 1);
  assert.equal(calls[2]?.taskInput.integrityRepairAttempt, 2);
  assert.deepEqual(calls[1]?.taskInput.issueCodes, ['chapter_meta_reasoning_leakage']);
  assert.deepEqual(calls[2]?.taskInput.issueCodes, ['chapter_meta_reasoning_leakage']);
});

test('writer fails closed after two integrity repairs still return polluted prose', async () => {
  const pollutedCandidate = `${'甲'.repeat(3_000)}。经典三级`;
  const calls: ChapterGenerationExecutionInput[] = [];
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => baseSettings,
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    compileContext: async () => snapshot,
    executeGeneration: async (input) => {
      calls.push(input);
      return {
        persistence: 'ephemeral_browser',
        text: pollutedCandidate,
        provider: {
          text: pollutedCandidate,
          providerId: 'mock',
          modelId: 'Frozen Mock',
          durationMs: 12,
        },
      };
    },
  });

  await assert.rejects(
    writer.generate({
      novelId: 'novel-001',
      chapterId: 'chapter-003',
      goal: '生成本章正文',
      mode: 'generate',
      modelSnapshot: frozenModel,
    }),
    (error: unknown) => {
      const writerError = error as Error & { code?: string };
      assert.equal(writerError.code, 'WORKBENCH_CHAPTER_INTEGRITY_FAILED');
      assert.match(writerError.message, /2 次完整性修复/);
      assert.match(writerError.message, /chapter_tail_pollution/);
      assert.doesNotMatch(writerError.message, /经典三级/);
      return true;
    },
  );

  assert.equal(calls.length, 3);
  assert.equal(calls[1]?.taskInput.integrityRepairAttempt, 1);
  assert.equal(calls[2]?.taskInput.integrityRepairAttempt, 2);
  assert.deepEqual(calls[1]?.taskInput.issueCodes, ['chapter_tail_pollution']);
  assert.deepEqual(calls[2]?.taskInput.issueCodes, ['chapter_tail_pollution']);
});

test('writer expands the real 2334-word Gate regression into the 3000-word contract', async () => {
  const undersized = '甲'.repeat(2_334);
  const repaired = '乙'.repeat(2_700);
  const calls: ChapterGenerationExecutionInput[] = [];
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => baseSettings,
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    compileContext: async () => snapshot,
    executeGeneration: async (input) => {
      calls.push(input);
      const text = calls.length === 1 ? undersized : repaired;
      return {
        persistence: 'ephemeral_browser',
        text,
        provider: { text, providerId: 'mock', modelId: 'Frozen Mock', durationMs: 12 },
      };
    },
  });

  const result = await writer.generate({
    novelId: 'novel-001',
    chapterId: 'chapter-003',
    goal: '生成本章正文',
    mode: 'generate',
    modelSnapshot: frozenModel,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.taskInput.lengthRepairDirection, 'expand');
  assert.equal(calls[1]?.taskInput.minimumWordCount, 2_700);
  assert.equal(calls[1]?.taskInput.maximumWordCount, 3_150);
  assert.match(calls[1]?.request.messages[0]?.content ?? '', /小说正文扩写编辑/);
  assert.match(calls[1]?.request.messages[0]?.content ?? '', /至少增加 366 字/);
  assert.match(calls[1]?.request.messages[1]?.content ?? '', /【待扩写完整正文】/);
  assert.equal(result.targetWordCount, 3_000);
  assert.equal(result.originalWordCount, 2_334);
  assert.equal(result.finalWordCount, 2_700);
  assert.equal(result.lengthRepairCount, 1);
});

test('writer escalates expansion targets and fails closed when a chapter stays undersized', async () => {
  const calls: ChapterGenerationExecutionInput[] = [];
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => baseSettings,
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    compileContext: async () => ({
      ...snapshot,
      compiledContext: {
        ...snapshot.compiledContext,
        baseContext: { ...snapshot.compiledContext.baseContext, targetWordCount: 100 },
      },
    }),
    executeGeneration: async (input) => {
      calls.push(input);
      const text = '甲'.repeat(70);
      return {
        persistence: 'ephemeral_browser',
        text,
        provider: { text, providerId: 'mock', modelId: 'Frozen Mock', durationMs: 12 },
      };
    },
  });

  await assert.rejects(
    writer.generate({
      novelId: 'novel-001',
      chapterId: 'chapter-003',
      goal: '生成本章正文',
      mode: 'generate',
      modelSnapshot: frozenModel,
    }),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'WORKBENCH_CHAPTER_LENGTH_OUT_OF_RANGE' &&
      /允许范围 80-115 字/.test(error.message),
  );
  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.slice(1).map((call) => ({
      minimum: call.taskInput.minimumWordCount,
      maximum: call.taskInput.maximumWordCount,
      direction: call.taskInput.lengthRepairDirection,
    })),
    [
      { minimum: 90, maximum: 105, direction: 'expand' },
      { minimum: 95, maximum: 110, direction: 'expand' },
      { minimum: 100, maximum: 115, direction: 'expand' },
    ],
  );
  assert.match(calls[2]?.request.messages[0]?.content ?? '', /更严格的第二次扩写收敛/);
  assert.match(calls[3]?.request.messages[0]?.content ?? '', /最后一次扩写收敛兜底/);
});

test('writer uses a tighter fallback range while preserving the previous repair ending', async () => {
  const firstCandidate = '甲'.repeat(150);
  const firstRepair = `${'乙'.repeat(118)}章末钩子`;
  const finalRepair = `${'丙'.repeat(96)}章末钩子`;
  const calls: ChapterGenerationExecutionInput[] = [];
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => baseSettings,
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    compileContext: async () => ({
      ...snapshot,
      compiledPromptText: '冻结规则 CANARY_REPAIR_CONTEXT：铜钥匙只能在月光下开启。',
      compiledContext: {
        ...snapshot.compiledContext,
        baseContext: { ...snapshot.compiledContext.baseContext, targetWordCount: 100 },
      },
    }),
    executeGeneration: async (input) => {
      calls.push(input);
      const text = [firstCandidate, firstRepair, finalRepair][calls.length - 1] ?? finalRepair;
      return {
        persistence: 'ephemeral_browser',
        text,
        taskId: `generation-task-${calls.length}`,
        attemptId: `generation-attempt-${calls.length}`,
        providerRequestEvidence: {
          ...providerRequestEvidence,
          messagesSha256: String(calls.length).repeat(64),
          requestContextSources: [
            {
              sourceVersion: input.sourceVersion,
              contentSha256: String(calls.length + 2).repeat(64),
              includedSha256: String(calls.length + 2).repeat(64),
              status: 'included',
            },
          ],
        },
        provider: { text, providerId: 'mock', modelId: 'Frozen Mock', durationMs: 12 },
      };
    },
  });

  const result = await writer.generate({
    novelId: 'novel-001',
    chapterId: 'chapter-003',
    goal: '生成本章正文',
    mode: 'generate',
    modelSnapshot: frozenModel,
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[1]?.taskInput.minimumWordCount, 90);
  assert.equal(calls[1]?.taskInput.maximumWordCount, 105);
  assert.equal(calls[1]?.taskInput.repairAttempt, 1);
  assert.equal(calls[2]?.taskInput.minimumWordCount, 85);
  assert.equal(calls[2]?.taskInput.maximumWordCount, 95);
  assert.equal(calls[2]?.taskInput.repairAttempt, 2);
  assert.match(calls[2]?.request.messages[0]?.content ?? '', /85-95/);
  assert.match(calls[2]?.request.messages[0]?.content ?? '', /更严格的第二次收敛/);
  assert.match(calls[2]?.request.messages[0]?.content ?? '', /至少删除 27 字/);
  assert.match(calls[1]?.request.messages[1]?.content ?? '', /CANARY_REPAIR_CONTEXT/);
  assert.match(calls[2]?.request.messages[1]?.content ?? '', /CANARY_REPAIR_CONTEXT/);
  assert.match(calls[2]?.request.messages[1]?.content ?? '', /章末钩子/);
  assert.equal(result.text, finalRepair);
  assert.equal(result.lengthRepairCount, 2);
  assert.equal(result.taskId, 'generation-task-3');
  assert.equal(result.providerRequestEvidence?.taskId, result.taskId);
  assert.equal(result.providerRequestEvidence?.attemptId, 'generation-attempt-3');
  assert.equal(result.providerRequestEvidence?.messagesSha256, '3'.repeat(64));
  assert.equal(result.providerRequestEvidence?.snapshotRequestSourceSha256, '5'.repeat(64));
});

test('writer accepts a chapter within the final hard maximum without a repair', async () => {
  let calls = 0;
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => baseSettings,
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    compileContext: async () => ({
      ...snapshot,
      compiledContext: {
        ...snapshot.compiledContext,
        baseContext: { ...snapshot.compiledContext.baseContext, targetWordCount: 100 },
      },
    }),
    executeGeneration: async () => {
      calls += 1;
      const text = '甲'.repeat(112);
      return {
        persistence: 'ephemeral_browser',
        text,
        provider: { text, providerId: 'mock', modelId: 'Frozen Mock', durationMs: 12 },
      };
    },
  });

  const result = await writer.generate({
    novelId: 'novel-001',
    chapterId: 'chapter-003',
    goal: '生成本章正文',
    mode: 'generate',
    modelSnapshot: frozenModel,
  });

  assert.equal(calls, 1);
  assert.equal(result.finalWordCount, 112);
  assert.equal(result.lengthRepairCount, 0);
  assert.deepEqual(result.integrityRepairAttempts, []);
});

test('writer uses a final complete rewrite before failing an oversized chapter', async () => {
  let calls = 0;
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => baseSettings,
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    compileContext: async () => ({
      ...snapshot,
      compiledContext: {
        ...snapshot.compiledContext,
        baseContext: { ...snapshot.compiledContext.baseContext, targetWordCount: 100 },
      },
    }),
    executeGeneration: async () => {
      calls += 1;
      const text = '甲'.repeat(150);
      return {
        persistence: 'ephemeral_browser',
        text,
        provider: {
          text,
          providerId: 'mock',
          modelId: 'Frozen Mock',
          durationMs: 12,
        },
      };
    },
  });

  await assert.rejects(
    writer.generate({
      novelId: 'novel-001',
      chapterId: 'chapter-003',
      goal: '生成本章正文',
      mode: 'generate',
      modelSnapshot: frozenModel,
    }),
    (error: unknown) =>
      error instanceof Error &&
      (error as Error & { code?: string }).code === 'WORKBENCH_CHAPTER_LENGTH_OUT_OF_RANGE',
  );
  assert.equal(calls, 4);
});

test('writer third repair targets a wider safety margin and preserves the full ending', async () => {
  const calls: ChapterGenerationExecutionInput[] = [];
  const outputs = [
    '甲'.repeat(150),
    '乙'.repeat(125),
    '丙'.repeat(118),
    `${'丁'.repeat(88)}完整章末钩子`,
  ];
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => baseSettings,
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    compileContext: async () => ({
      ...snapshot,
      compiledContext: {
        ...snapshot.compiledContext,
        baseContext: { ...snapshot.compiledContext.baseContext, targetWordCount: 100 },
      },
    }),
    executeGeneration: async (input) => {
      calls.push(input);
      const text = outputs[calls.length - 1] ?? outputs[outputs.length - 1];
      return {
        persistence: 'ephemeral_browser',
        text,
        provider: { text, providerId: 'mock', modelId: 'Frozen Mock', durationMs: 12 },
      };
    },
  });

  const result = await writer.generate({
    novelId: 'novel-001',
    chapterId: 'chapter-003',
    goal: '生成本章正文',
    mode: 'generate',
    modelSnapshot: frozenModel,
  });

  assert.equal(calls.length, 4);
  assert.equal(calls[3]?.taskInput.minimumWordCount, 80);
  assert.equal(calls[3]?.taskInput.maximumWordCount, 90);
  assert.equal(calls[3]?.taskInput.repairAttempt, 3);
  assert.match(calls[3]?.request.messages[0]?.content ?? '', /80-90/);
  assert.match(calls[3]?.request.messages[0]?.content ?? '', /最后一次收敛兜底/);
  assert.match(result.text, /完整章末钩子$/);
  assert.equal(result.lengthRepairCount, 3);
});

test('writer freezes the previous adopted chapter into the auditable generation context', async () => {
  const previous = {
    chapterId: 'chapter-002',
    draftId: 'draft-adopted-002',
    contentHash: 'adopted-content-hash',
    content: '上一章最终停在倒计时十八分四十一秒，顾闻舟仍在塔外。',
  };
  let compiledInput:
    Parameters<NonNullable<WorkbenchChapterWriterDependencies['compileContext']>>[0] | undefined;
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => baseSettings,
    loadAdoptedPreviousChapter: async () => ({ status: 'adopted', context: previous }),
    compileContext: async (input) => {
      compiledInput = input;
      return snapshot;
    },
    executeGeneration: async () => ({
      persistence: 'ephemeral_browser',
      text: inRangeChapterCandidate,
      provider: {
        text: inRangeChapterCandidate,
        providerId: 'mock',
        modelId: 'Frozen Mock',
        durationMs: 12,
      },
    }),
  });

  const result = await writer.generate({
    novelId: 'novel-001',
    chapterId: 'chapter-003',
    goal: '继续生成第三章',
    mode: 'generate',
    modelSnapshot: frozenModel,
  });

  assert.deepEqual(compiledInput?.adoptedPreviousChapter, previous);
  assert.equal(result.continuitySourceHash, previous.contentHash);
  assert.equal(result.continuitySourceChapterId, previous.chapterId);
});

test('writer fails closed before compilation when a previous chapter is not adopted or unreadable', async () => {
  for (const fixture of [
    {
      resolution: { status: 'not_adopted' as const, chapterId: 'chapter-002' },
      code: 'WORKBENCH_PREVIOUS_CHAPTER_NOT_ADOPTED',
    },
    {
      resolution: {
        status: 'content_unavailable' as const,
        chapterId: 'chapter-002',
        draftId: 'draft-002',
      },
      code: 'WORKBENCH_PREVIOUS_CHAPTER_CONTENT_UNAVAILABLE',
    },
  ]) {
    let compileCalled = false;
    let executeCalled = false;
    const writer = createTestWorkbenchChapterWriter({
      loadAdoptedPreviousChapter: async () => fixture.resolution,
      compileContext: async () => {
        compileCalled = true;
        return snapshot;
      },
      executeGeneration: async () => {
        executeCalled = true;
        throw new Error('executeGeneration should not run');
      },
    });

    await assert.rejects(
      writer.generate({
        novelId: 'novel-001',
        chapterId: 'chapter-003',
        goal: '继续生成第三章',
        mode: 'generate',
        modelSnapshot: frozenModel,
      }),
      (error: unknown) =>
        error instanceof Error && (error as Error & { code?: string }).code === fixture.code,
    );
    assert.equal(compileCalled, false);
    assert.equal(executeCalled, false);
  }
});

test('writer resolves the session API key for the exact frozen model binding', async () => {
  const sessionApiKey = 'session-only-deepseek-key';
  const frozenApiModel: TaskModelSnapshot = {
    ...frozenModel,
    providerId: 'deepseek-official',
    modelId: 'deepseek-chat',
    runtimeMode: 'api',
    baseUrl: 'https://api.deepseek.com/v1',
  };
  const laterGlobalSettings: AiSettings = {
    ...baseSettings,
    runtimeMode: 'api',
    provider: 'openai_compatible',
    baseUrl: 'https://later-provider.invalid/v1',
    apiKey: 'later-global-key-must-not-win',
    modelName: 'later-global-model',
    mockMode: false,
  };
  let captured: ChapterGenerationExecutionInput | undefined;

  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => laterGlobalSettings,
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    resolveApiKey: (identity) => {
      assert.deepEqual(identity, {
        scope: 'provider',
        providerId: frozenApiModel.providerId,
        baseUrl: frozenApiModel.baseUrl,
        modelId: frozenApiModel.modelId,
      });
      return sessionApiKey;
    },
    compileContext: async () => snapshot,
    executeGeneration: async (input) => {
      captured = input;
      return {
        persistence: 'ephemeral_browser',
        text: inRangeChapterCandidate,
        provider: {
          text: inRangeChapterCandidate,
          providerId: frozenApiModel.providerId,
          modelId: frozenApiModel.modelId,
          durationMs: 12,
        },
      };
    },
  });

  await writer.generate({
    novelId: 'novel-001',
    chapterId: 'chapter-003',
    goal: '生成第三章',
    mode: 'generate',
    modelSnapshot: frozenApiModel,
  });

  assert.equal(captured?.settings.modelName, frozenApiModel.modelId);
  assert.equal(captured?.settings.baseUrl, frozenApiModel.baseUrl);
  assert.equal(captured?.settings.apiKey, sessionApiKey);
  assert.notEqual(captured?.settings.modelName, laterGlobalSettings.modelName);
  assert.notEqual(captured?.settings.baseUrl, laterGlobalSettings.baseUrl);
  assert.notEqual(captured?.settings.apiKey, laterGlobalSettings.apiKey);
});

test('writer removes every specialist endpoint so the frozen model owns Scene and Beat routing', async () => {
  const frozenApiModel: TaskModelSnapshot = {
    ...frozenModel,
    providerId: 'openai_compatible',
    modelId: 'gpt-5.6-luna',
    runtimeMode: 'api',
    baseUrl: 'http://localhost:12074/v1',
  };
  const settingsWithSpecialists: AiSettings = {
    ...baseSettings,
    runtimeMode: 'api',
    provider: 'openai_compatible',
    baseUrl: frozenApiModel.baseUrl!,
    apiKey: 'current-provider-key',
    modelName: frozenApiModel.modelId,
    mockMode: false,
    localChapterModel: {
      enabled: true,
      providerId: 'foreign-local-writer',
      baseUrl: 'http://127.0.0.1:22001/v1',
      apiKey: 'foreign-local-key',
      modelName: 'foreign-local-model',
      timeoutSeconds: 60,
      contextTokens: 32_000,
      maxTokens: 2_000,
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      repeatPenalty: 1.05,
      allowCloudWriterFallback: false,
    },
    gateway: {
      enabled: true,
      providerId: 'foreign-gateway',
      baseUrl: 'https://gateway.invalid/v1',
      apiKey: 'foreign-gateway-key',
      modelName: 'foreign-gateway-model',
      timeoutSeconds: 90,
    },
    remoteWriter: {
      enabled: true,
      providerId: 'foreign-remote-writer',
      baseUrl: 'https://remote.invalid/v1',
      apiKey: 'foreign-remote-key',
      modelName: 'foreign-remote-model',
      timeoutSeconds: 90,
    },
  };
  let captured: ChapterGenerationExecutionInput | undefined;
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => settingsWithSpecialists,
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    resolveApiKey: () => 'frozen-session-key',
    compileContext: async () => snapshot,
    executeGeneration: async (input) => {
      captured = input;
      return {
        persistence: 'ephemeral_browser',
        text: inRangeChapterCandidate,
        provider: {
          text: inRangeChapterCandidate,
          providerId: frozenApiModel.providerId,
          modelId: frozenApiModel.modelId,
          durationMs: 12,
        },
      };
    },
  });

  await writer.generate({
    novelId: 'novel-001',
    chapterId: 'chapter-003',
    goal: '继续生成第三章',
    mode: 'generate',
    modelSnapshot: frozenApiModel,
  });

  assert.ok(captured);
  assert.equal(captured.settings.localChapterModel, undefined);
  assert.equal(captured.settings.gateway, undefined);
  assert.equal(captured.settings.remoteWriter, undefined);
  const route = routeCreativeTask(captured.settings, 'chapter_scene_generate');
  assert.equal(route.selected.providerId, frozenApiModel.providerId);
  assert.equal(route.selected.modelId, frozenApiModel.modelId);
  assert.equal(route.reason, 'cloud_writer_primary');
});

test('writer fails closed when an API snapshot credential cannot be resolved', async () => {
  let executeCalled = false;
  const writer = createTestWorkbenchChapterWriter({
    getSettings: () => ({
      ...baseSettings,
      runtimeMode: 'api',
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com/v1',
      apiKey: 'unrelated-current-key-must-not-win',
      modelName: 'deepseek-chat',
      mockMode: false,
    }),
    resolveApiKey: () => '',
    loadAdoptedPreviousChapter: noPreviousAdoptedChapter,
    compileContext: async () => snapshot,
    executeGeneration: async () => {
      executeCalled = true;
      throw new Error('executeGeneration should not run');
    },
  });
  await assert.rejects(
    writer.generate({
      novelId: 'novel-001',
      chapterId: 'chapter-003',
      goal: '生成第三章',
      mode: 'generate',
      modelSnapshot: {
        ...frozenModel,
        providerId: 'deepseek-official',
        modelId: 'deepseek-chat',
        runtimeMode: 'api',
        baseUrl: 'https://api.deepseek.com/v1',
      },
    }),
    /无法获取冻结模型 Provider/,
  );
  assert.equal(executeCalled, false);
});

test('generation profile selection prefers the project active style and project default output', () => {
  const styleFixture = (input: Partial<StyleProfile> & Pick<StyleProfile, 'id'>): StyleProfile => ({
    id: input.id,
    novelId: input.novelId,
    name: input.id,
    sourceType: 'manual',
    targetWordsPerChapter: 4_000,
    rhythmPreference: 'moderate',
    dialogueRatio: 0.35,
    descriptionRatio: 0.4,
    prohibitedStyles: [],
    isActive: input.isActive ?? false,
    createdAt: input.createdAt ?? '2026-08-20T00:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-08-20T00:00:00.000Z',
  });
  const outputFixture = (
    input: Partial<OutputProfile> & Pick<OutputProfile, 'id'>,
  ): OutputProfile => ({
    id: input.id,
    novelId: input.novelId,
    name: input.id,
    chapterWordRange: { min: 2_000, max: 5_000, default: 3_000 },
    paragraphLength: 'medium',
    povType: 'third_person_limited',
    tenseType: 'past',
    endingHookRequired: false,
    isDefault: input.isDefault ?? false,
    createdAt: input.createdAt ?? '2026-08-20T00:00:00.000Z',
    updatedAt: input.updatedAt ?? '2026-08-20T00:00:00.000Z',
  });

  const selectedStyle = selectGenerationStyleProfile('novel-001', [
    styleFixture({ id: 'global-active', isActive: true }),
    styleFixture({ id: 'project-inactive', novelId: 'novel-001', isActive: false }),
    styleFixture({ id: 'project-active', novelId: 'novel-001', isActive: true }),
  ]);
  const selectedOutput = selectGenerationOutputProfile('novel-001', [
    outputFixture({ id: 'global-default', isDefault: true }),
    outputFixture({ id: 'project-non-default', novelId: 'novel-001' }),
    outputFixture({ id: 'project-default', novelId: 'novel-001', isDefault: true }),
  ]);

  assert.equal(selectedStyle?.id, 'project-active');
  assert.equal(selectedOutput?.id, 'project-default');

  const selectedBuiltInDefault = selectGenerationStyleProfile('novel-without-style', [
    {
      ...styleFixture({
        id: 'newer-specialized-style',
        isActive: true,
        updatedAt: '2026-08-22T00:00:00.000Z',
      }),
      name: '快节奏战斗风',
      sourceType: 'system_default',
    },
    {
      ...styleFixture({
        id: 'stable-default-style',
        isActive: true,
        updatedAt: '2026-08-20T00:00:00.000Z',
      }),
      name: '默认小说风格',
      sourceType: 'system_default',
    },
  ]);
  assert.equal(selectedBuiltInDefault?.id, 'stable-default-style');
});

test('snapshot compiles multiple world settings, frozen profiles and reference canaries with evidence', async () => {
  const compiled = await compileGenerationContextSnapshot(
    {
      novelId: 'novel-001',
      chapterId: 'chapter-003',
      styleProfileId: 'style-active-001',
      outputProfileId: 'output-default-001',
      requireCoreAssets: true,
      userInstruction: '继续写下一章',
    },
    {
      buildBaseContext: async () => ({
        novelTitle: '稀疏指令验收作品',
        chapterTitle: '第三章',
        chapterOutline: '主角进入潮汐档案馆，确认月潮历法。',
        protagonist: '顾闻舟',
        protagonistsSummary: '- 主角：顾闻舟',
        worldBackground: '主世界设定 CANARY_WORLD_PRIMARY：月潮决定城门开放时刻。',
        chapterSettings: '- 补充设定 CANARY_WORLD_SECONDARY：潮汐档案只能由守钟人调阅。',
        ruleSystems: 'RULE_CANARY：守钟人只能在月潮退去后调阅档案。',
        worldSettingSources: [
          {
            id: 'world-primary-001',
            title: '月潮世界',
            role: 'primary',
            updatedAt: '2026-08-20T00:00:00.000Z',
          },
          {
            id: 'world-secondary-001',
            title: '档案馆规则',
            role: 'supplemental',
            updatedAt: '2026-08-21T00:00:00.000Z',
          },
        ],
        styleProfile: 'STYLE_CANARY：第三人称有限视角，句式克制。',
        outputProfile: 'OUTPUT_CANARY：目标 3200 字，结尾保留未解钩子。',
        characterStates: '- 顾闻舟\n  当前状态：CHARACTER_STATE_CANARY 左手受伤。',
        characterStateSources: [
          {
            id: 'character-state-001',
            characterId: 'character-001',
            characterName: '顾闻舟',
            chapterId: 'chapter-002',
            origin: 'character_state',
          },
        ],
        targetWordCount: 3_200,
        userInstruction: '继续写下一章',
      }),
      getEngineeringBundle: async () => ({ states: [], hasUnappliedDraft: false }),
      loadAssetContext: async () => ({
        storyAssetText: '【地点】潮汐档案馆\n描述：只在退潮后的二十分钟开放。',
        referenceText:
          '【研究资料】港区钟表校准记录\n资料节选《校准表》：REFERENCE_CANARY 十八分四十一秒。',
        sources: [
          {
            type: 'location',
            title: '地点：潮汐档案馆',
            sourceId: 'location-archive-001',
            status: 'used',
            summary: 'revision=3',
          },
          {
            type: 'reference_material',
            title: '参考资料：港区钟表校准记录',
            sourceId: 'reference-work-001:reference-import-002',
            status: 'used',
            summary: `purpose=research;source_hash=${'a'.repeat(64)}`,
          },
        ],
        warnings: [],
      }),
    },
  );

  assert.equal(compiled.styleProfileId, 'style-active-001');
  assert.equal(compiled.outputProfileId, 'output-default-001');
  assert.match(compiled.compiledPromptText, /CANARY_WORLD_PRIMARY/);
  assert.match(compiled.compiledPromptText, /CANARY_WORLD_SECONDARY/);
  assert.match(compiled.compiledPromptText, /STYLE_CANARY/);
  assert.match(compiled.compiledPromptText, /OUTPUT_CANARY/);
  assert.match(compiled.compiledPromptText, /CHARACTER_STATE_CANARY/);
  assert.match(compiled.compiledPromptText, /REFERENCE_CANARY/);
  assert.equal(
    compiled.sources.find((source) => source.sourceId === 'world-secondary-001')?.status,
    'used',
  );
  assert.equal(compiled.sources.find((source) => source.type === 'protagonist')?.status, 'used');
  assert.equal(
    compiled.sources.find((source) => source.type === 'character_state')?.sourceId,
    'character-state-001',
  );
  assert.equal(
    compiled.sources.find((source) => source.type === 'reference_material')?.sourceId,
    'reference-work-001:reference-import-002',
  );
});

test('snapshot freezes retrieved memory and revision source into the prompt and context hash', async () => {
  const dependencies = {
    buildBaseContext: async () => ({
      novelTitle: '快照一致性测试作品',
      chapterTitle: '第三章',
      chapterOutline: '主角携带铜钥匙进入档案馆。',
      protagonist: '顾闻舟',
      protagonistsSummary: '- 主角：顾闻舟',
      worldBackground: '月潮决定档案馆开放时间。',
      userInstruction: '修改本章候选',
    }),
    getEngineeringBundle: async () => ({ states: [], hasUnappliedDraft: false }),
    loadAssetContext: async () => ({ sources: [], warnings: [] }),
  };
  const baseline = await compileGenerationContextSnapshot(
    {
      novelId: 'novel-001',
      chapterId: 'chapter-003',
      userInstruction: '修改本章候选',
    },
    dependencies,
  );
  const frozen = await compileGenerationContextSnapshot(
    {
      novelId: 'novel-001',
      chapterId: 'chapter-003',
      userInstruction: '修改本章候选',
      retrievedMemoryContext: '1. 铜钥匙只能在月光下开启。',
      currentEditorContent: '上一版章节候选正文。',
    },
    dependencies,
  );

  assert.notEqual(frozen.contextHash, baseline.contextHash);
  assert.match(frozen.compiledPromptText, /检索到的长期记忆事实/);
  assert.match(frozen.compiledPromptText, /铜钥匙只能在月光下开启/);
  assert.match(frozen.compiledPromptText, /当前正文修改/);
  assert.match(frozen.compiledPromptText, /上一版章节候选正文/);
  assert.equal(frozen.sources.find((source) => source.type === 'memory_context')?.status, 'used');
  assert.equal(frozen.sources.find((source) => source.type === 'current_editor')?.status, 'used');
});

test('research reference excerpts are bounded and style source prose is not re-injected', async () => {
  const hash = 'b'.repeat(64);
  const context = await loadGenerationAssetContext('novel-001', '潮汐档案馆', {
    listFactions: async () => [],
    listLocations: async () => [],
    listReferenceWorks: async () => [
      {
        id: 'reference-research',
        novelId: 'novel-001',
        title: '港区钟表校准记录',
        purpose: 'research',
        description: '用于校准故事里的钟表误差。',
        activeImportId: 'import-research',
        activeSourceHash: hash,
        revision: 2,
        sourceStatus: 'available',
        sectionCount: 1,
        totalChars: 10_000,
        createdAt: '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-08-21T00:00:00.000Z',
      },
      {
        id: 'reference-style',
        novelId: 'novel-001',
        title: '不应直接注入的风格原文',
        purpose: 'style',
        activeImportId: 'import-style',
        activeSourceHash: 'c'.repeat(64),
        revision: 1,
        sourceStatus: 'available',
        sectionCount: 1,
        totalChars: 8_000,
        createdAt: '2026-08-20T00:00:00.000Z',
        updatedAt: '2026-08-20T00:00:00.000Z',
      },
    ],
    listReferenceSections: async () => ({
      items: [
        {
          id: 'reference-section-001',
          importId: 'import-research',
          workId: 'reference-research',
          novelId: 'novel-001',
          orderIndex: 0,
          title: '校准表',
          contentHash: hash,
          charCount: 10_000,
          sourceStartUtf16: 0,
          sourceEndUtf16: 10_000,
        },
      ],
      total: 1,
      offset: 0,
      limit: 2,
    }),
    getReferenceSectionContent: async () => ({
      id: 'reference-section-001',
      importId: 'import-research',
      workId: 'reference-research',
      novelId: 'novel-001',
      orderIndex: 0,
      title: '校准表',
      contentHash: hash,
      charCount: 10_000,
      sourceStartUtf16: 0,
      sourceEndUtf16: 10_000,
      content: `REFERENCE_LOADER_CANARY ${'校准数据'.repeat(500)}`,
    }),
  });

  assert.match(context.referenceText ?? '', /REFERENCE_LOADER_CANARY/);
  assert.doesNotMatch(context.referenceText ?? '', /不应直接注入的风格原文/);
  assert.ok((context.referenceText?.length ?? 0) <= 3_000);
  assert.match(context.sources[0]?.summary ?? '', new RegExp(hash));
  assert.match(context.sources[0]?.summary ?? '', /reference-section-001/);
});

test('Workbench core-asset readiness fails closed before asset loading or model execution', async () => {
  let assetsLoaded = false;
  await assert.rejects(
    compileGenerationContextSnapshot(
      {
        novelId: 'novel-001',
        chapterId: 'chapter-001',
        requireCoreAssets: true,
      },
      {
        buildBaseContext: async () => ({
          novelTitle: '缺资产作品',
          chapterTitle: '第一章',
        }),
        getEngineeringBundle: async () => ({ states: [], hasUnappliedDraft: false }),
        loadAssetContext: async () => {
          assetsLoaded = true;
          return { sources: [], warnings: [] };
        },
      },
    ),
    (error: unknown) => {
      const readiness = error as GenerationCoreAssetsMissingError;
      assert.equal(readiness.code, 'GENERATION_CORE_ASSETS_MISSING');
      assert.deepEqual(readiness.missingAssets, [
        'chapter_outline',
        'world_setting',
        'rule_system',
        'protagonist',
      ]);
      return true;
    },
  );
  assert.equal(assetsLoaded, false);
});
