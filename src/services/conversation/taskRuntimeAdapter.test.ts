import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mockNovels } from '../../features/novels/mockNovels';
import { ArtifactCard, ToolEventRow } from '../../pages/Workbench/WorkbenchComponents';
import { PluginPanel } from '../../pages/Workbench/WorkbenchPluginPanel';
import {
  resolveArtifactDecisionTarget,
  resolveConversationTargetChapter,
} from '../../pages/Workbench/workbenchHelpers';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { volumeRepository } from '../database/volumeRepository';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { artifactDecisionService } from './artifactDecisionService';
import { taskConversationService } from './taskConversationService';
import {
  createTaskRuntimeAdapter,
  findLatestCandidateText,
  taskRuntimeAdapter,
} from './taskRuntimeAdapter';
import { taskSessionAdapter, WORKBENCH_CONVERSATIONAL_REPLY } from '../dsh/taskSessionAdapter';
import { workbenchChapterWriter } from './workbenchChapterWriter';
import { putLocalMemoryDocument, retrieveLocalMemory } from '../memory/adoptedDraftMemory';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

workbenchChapterWriter.generate = async () => ({
  text: '这是一段足够长度的章节候选正文，用于工作台写章验收。',
  source: 'writer',
  contextHash: 'context-fixture-hash',
  continuitySourceHash: 'continuity-fixture-hash',
  continuitySourceChapterId: 'ch-002',
  contextSources: [
    { type: 'world_setting', title: '世界设定', status: 'used' },
    { type: 'chapter_outline', title: '章节大纲', status: 'used' },
    { type: 'memory_context', title: '长期记忆', status: 'missing' },
    { type: 'style_profile', title: '风格方案', status: 'fallback' },
  ],
  targetWordCount: 4_000,
  originalWordCount: 4_620,
  finalWordCount: 4_080,
  lengthRepairCount: 1,
  integrityRepairCount: 1,
  integrityRepairAttempts: [
    {
      attempt: 1,
      issueCodes: ['chapter_source_chain_break'],
      sourceContentHash: '5'.repeat(64),
    },
  ],
  providerRequestEvidence: {
    schemaVersion: 'workbench_provider_request_evidence_v1',
    hashAlgorithm: 'sha256',
    messagesSerialization: 'json_stringify_messages_v1',
    taskId: 'generation-task-fixture',
    attemptId: 'generation-attempt-fixture',
    messagesSha256: '1'.repeat(64),
    messageCount: 2,
    compiledContextSha256: '2'.repeat(64),
    snapshotContextHash: 'context-fixture-hash',
    snapshotCompiledPromptSha256: '4'.repeat(64),
    snapshotRequestSourceSha256: '3'.repeat(64),
    includedSnapshotRequestSourceSha256: '3'.repeat(64),
    snapshotRequestSourceStatus: 'truncated',
    providerSourceStatus: 'included',
    generationSourceStatuses: {
      world_setting: 'included',
      chapter_outline: 'truncated',
    },
  },
});

function mockModel(modelId = 'Mock') {
  return {
    providerId: 'mock',
    modelId,
    runtimeMode: 'mock' as const,
    capabilities: ['conversation_turn', 'chapter_generate', 'tool_calling'],
    options: { temperature: 0.4 },
    runtime: {
      adapterProtocol: 'ans_provider_fallback_v1',
      adapterProvider: 'browser-fallback',
      bundle: 'browser-deterministic',
      profile: 'conversational-workbench-v2',
    },
    capturedAt: new Date().toISOString(),
  };
}

test('two task workers keep independent runs and event projections', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
  localStorage.setItem(
    'ai_novel_studio_chapters',
    JSON.stringify([
      {
        id: 'ch-003',
        novelId: 'novel-001',
        title: '第三章',
        outline: '主角发现关键线索。',
        orderIndex: 2,
        createdAt: '2026-08-20T00:00:00Z',
        updatedAt: '2026-08-20T00:00:00Z',
      },
    ]),
  );
  const [first, second] = await Promise.all([
    taskConversationService.create('novel-001', '生成下一章'),
    taskConversationService.create('novel-001', '审计人物一致性'),
  ]);
  const firstTurn = await taskConversationService.appendTurn(
    first.conversationId,
    'user',
    '生成下一章',
  );
  const secondTurn = await taskConversationService.appendTurn(
    second.conversationId,
    'user',
    '审计人物一致性',
  );
  const [firstRun, secondRun] = await Promise.all([
    taskRuntimeAdapter.start({
      conversationId: first.conversationId,
      novelId: 'novel-001',
      chapterId: 'ch-003',
      turnId: firstTurn.turnId,
      goal: '生成下一章',
    }),
    taskRuntimeAdapter.start({
      conversationId: second.conversationId,
      novelId: 'novel-001',
      turnId: secondTurn.turnId,
      goal: '审计人物一致性',
    }),
  ]);
  assert.equal(firstRun.status, 'completed');
  assert.equal(secondRun.status, 'completed');
  assert.notEqual(firstRun.runId, secondRun.runId);
  const [firstBundle, secondBundle] = await Promise.all([
    taskConversationService.get(first.conversationId),
    taskConversationService.get(second.conversationId),
  ]);
  assert.equal(firstBundle?.runs.length, 1);
  assert.equal(secondBundle?.runs.length, 1);
  assert.equal(firstBundle?.runs[0].chapterId, 'ch-003');
  assert.ok((firstBundle?.toolEvents.length ?? 0) >= 2);
  assert.ok((secondBundle?.toolEvents.length ?? 0) >= 2);
  assert.notEqual(firstBundle?.runs[0].workerId, secondBundle?.runs[0].workerId);
  assert.deepEqual(
    firstBundle?.toolEvents.map((event) => event.status),
    firstBundle?.toolEvents.map(() => 'succeeded'),
  );
  assert.equal(firstBundle?.artifacts.length, 1);
  assert.match(
    firstBundle?.turns.find((turn) => turn.role === 'assistant')?.content ?? '',
    /正式写章管线/,
  );
  assert.ok(firstBundle?.toolEvents.some((event) => event.toolName === 'generate_chapter'));
  const writerEvent = firstBundle?.toolEvents.find(
    (event) => event.toolName === 'generate_chapter',
  );
  assert.deepEqual(
    (writerEvent?.result as { generationContext?: unknown } | undefined)?.generationContext,
    {
      contextHash: 'context-fixture-hash',
      continuitySourceHash: 'continuity-fixture-hash',
      continuitySourceChapterId: 'ch-002',
      sources: [
        { type: 'world_setting', title: '世界设定', status: 'used' },
        { type: 'chapter_outline', title: '章节大纲', status: 'used' },
        { type: 'memory_context', title: '长期记忆', status: 'missing' },
        { type: 'style_profile', title: '风格方案', status: 'fallback' },
      ],
      targetWordCount: 4_000,
      originalWordCount: 4_620,
      finalWordCount: 4_080,
      lengthRepairCount: 1,
      integrityRepairCount: 1,
      integrityRepairAttempts: [
        {
          attempt: 1,
          issueCodes: ['chapter_source_chain_break'],
          sourceContentHash: '5'.repeat(64),
        },
      ],
      providerRequestEvidence: {
        schemaVersion: 'workbench_provider_request_evidence_v1',
        hashAlgorithm: 'sha256',
        messagesSerialization: 'json_stringify_messages_v1',
        taskId: 'generation-task-fixture',
        attemptId: 'generation-attempt-fixture',
        messagesSha256: '1'.repeat(64),
        messageCount: 2,
        compiledContextSha256: '2'.repeat(64),
        snapshotContextHash: 'context-fixture-hash',
        snapshotCompiledPromptSha256: '4'.repeat(64),
        snapshotRequestSourceSha256: '3'.repeat(64),
        includedSnapshotRequestSourceSha256: '3'.repeat(64),
        snapshotRequestSourceStatus: 'truncated',
        providerSourceStatus: 'included',
        generationSourceStatuses: {
          world_setting: 'included',
          chapter_outline: 'truncated',
        },
      },
    },
  );
  const writerResult = writerEvent?.result as Record<string, unknown> | undefined;
  assert.equal(writerResult?.ok, true);
  assert.equal(writerResult?.artifactType, 'chapter_text');
  assert.equal(writerResult?.candidateOnly, true);
  assert.equal(Object.prototype.hasOwnProperty.call(writerResult ?? {}, 'toolResult'), false);
});

test('browser fallback selects domain candidate tools from the user goal', async () => {
  const cases: Array<{ goal: string; tool: string; chapterId?: string }> = [
    { goal: '生成下一章', tool: 'generate_chapter', chapterId: 'ch-003' },
    { goal: '为本作品生成角色候选', tool: 'generate_characters', chapterId: 'ch-003' },
    { goal: '扩展本章大纲', tool: 'generate_outline', chapterId: 'ch-003' },
    { goal: '生成世界设定候选', tool: 'expand_settings', chapterId: 'ch-003' },
    { goal: '建议本章事件', tool: 'suggest_events', chapterId: 'ch-003' },
    { goal: '润色本章正文', tool: 'polish_chapter', chapterId: 'ch-003' },
    { goal: '审计人物一致性', tool: 'check_quality', chapterId: 'ch-003' },
    { goal: '检查章节质量', tool: 'check_quality', chapterId: 'ch-003' },
    { goal: '总结本章', tool: 'summarize_chapter', chapterId: 'ch-003' },
    { goal: '为本作品生成角色候选', tool: 'generate_characters' },
  ];
  for (const fixture of cases) {
    (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
      new MemoryStorage() as unknown as Storage;
    localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
    localStorage.setItem(
      'ai_novel_studio_chapters',
      JSON.stringify([
        {
          id: 'ch-003',
          novelId: 'novel-001',
          title: '第三章',
          outline: '主角发现关键线索。',
          orderIndex: 2,
          createdAt: '2026-08-20T00:00:00Z',
          updatedAt: '2026-08-20T00:00:00Z',
        },
      ]),
    );
    const conversation = await taskConversationService.create('novel-001', fixture.goal);
    const turn = await taskConversationService.appendTurn(
      conversation.conversationId,
      'user',
      fixture.goal,
    );
    const run = await taskRuntimeAdapter.start({
      conversationId: conversation.conversationId,
      novelId: 'novel-001',
      chapterId: fixture.chapterId,
      turnId: turn.turnId,
      goal: fixture.goal,
    });
    assert.equal(run.status, 'completed', `${fixture.goal}: ${run.error ?? 'no run error'}`);
    const bundle = await taskConversationService.get(conversation.conversationId);
    assert.ok(
      bundle?.toolEvents.some((event) => event.toolName === fixture.tool),
      `${fixture.goal} should invoke ${fixture.tool}`,
    );
    assert.ok(bundle?.toolEvents.every((event) => event.status === 'succeeded'));
    if (fixture.tool === 'generate_chapter' || fixture.tool === 'polish_chapter') {
      assert.equal(bundle?.artifacts.length, 1, fixture.goal);
    } else {
      assert.equal(bundle?.artifacts.length, 0, fixture.goal);
    }
  }
});

test('chapter revision falls back to the adopted draft when the task has no prior candidate', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
  localStorage.setItem(
    'ai_novel_studio_chapters',
    JSON.stringify([
      {
        id: 'ch-003',
        novelId: 'novel-001',
        title: '第三章',
        outline: '主角发现关键线索。',
        orderIndex: 2,
        createdAt: '2026-08-20T00:00:00Z',
        updatedAt: '2026-08-20T00:00:00Z',
      },
    ]),
  );

  let writerMode = '';
  let previousCandidateText: string | undefined;
  const adapter = createTaskRuntimeAdapter({
    chapterWriter: {
      generate: async (input) => {
        writerMode = input.mode;
        previousCandidateText = input.previousCandidateText;
        return {
          text: '这是从已采用正文重新生成的章节候选，仍需用户审阅确认后才能采用。',
          source: 'writer',
          contextSources: [],
        };
      },
    },
  });
  const conversation = await taskConversationService.create('novel-001', '直接重写已采用正文');
  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '重写本章正文',
  );

  const run = await adapter.start({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    chapterId: 'ch-003',
    turnId: turn.turnId,
    goal: '重写本章正文',
    modelSnapshot: mockModel(),
  });

  assert.equal(run.status, 'completed', run.error);
  assert.equal(writerMode, 'polish');
  assert.equal(previousCandidateText, undefined);
  const bundle = await taskConversationService.get(conversation.conversationId);
  assert.ok(bundle?.toolEvents.some((event) => event.toolName === 'polish_chapter'));
  assert.equal(bundle?.artifacts.length, 1);
});

test('chapter revision selects the latest browser candidate for the current chapter', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const conversation = await taskConversationService.create('novel-001', '跨章润色');
  await taskConversationService.publishStructuredCandidate({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    chapterId: 'chapter-a',
    artifactType: 'chapter_text',
    title: 'A 章候选',
    summary: '候选',
    structuredPayloadJson: {
      data: { novelId: 'novel-001', chapterId: 'chapter-a', text: 'A 章最近候选' },
    },
  });
  await taskConversationService.publishStructuredCandidate({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    chapterId: 'chapter-b',
    artifactType: 'chapter_text',
    title: 'B 章候选',
    summary: '候选',
    structuredPayloadJson: {
      data: { novelId: 'novel-001', chapterId: 'chapter-b', text: 'B 章更新候选' },
    },
  });

  assert.equal(
    await findLatestCandidateText(conversation.conversationId, 'novel-001', 'chapter-a'),
    'A 章最近候选',
  );
});

test('chapter revision does not fall back to a candidate from another chapter', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const conversation = await taskConversationService.create('novel-001', '无匹配章节');
  await taskConversationService.publishStructuredCandidate({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    chapterId: 'chapter-b',
    artifactType: 'chapter_text',
    title: 'B 章候选',
    summary: '候选',
    structuredPayloadJson: {
      data: { novelId: 'novel-001', chapterId: 'chapter-b', text: 'B 章候选' },
    },
  });

  assert.equal(
    await findLatestCandidateText(conversation.conversationId, 'novel-001', 'chapter-a'),
    undefined,
  );
});

test('chapter revision rejects an invalid latest candidate for the matching chapter', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const conversation = await taskConversationService.create('novel-001', '无效本章候选');
  await taskConversationService.publishStructuredCandidate({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    chapterId: 'chapter-a',
    artifactType: 'chapter_text',
    title: 'A 章旧候选',
    summary: '候选',
    structuredPayloadJson: {
      data: { novelId: 'novel-001', chapterId: 'chapter-a', text: 'A 章旧候选' },
    },
  });
  await taskConversationService.publishStructuredCandidate({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    chapterId: 'chapter-a',
    artifactType: 'chapter_text',
    title: 'A 章无效候选',
    summary: '候选',
    structuredPayloadJson: {
      data: { novelId: 'novel-001', chapterId: 'chapter-a', text: '   ' },
    },
  });

  await assert.rejects(
    findLatestCandidateText(conversation.conversationId, 'novel-001', 'chapter-a'),
    /修改来源正文为空/,
  );
});

test('desktop chapter revision reads scoped ResultArtifacts and rejects an invalid match', async () => {
  const originalConversationGet = taskConversationService.get;
  const originalArtifactGet = aiTaskRuntimeService.getArtifact;
  const originalWindow = globalThis.window;
  const artifactReads: string[] = [];
  let matchingStatus: 'valid' | 'invalid' = 'valid';

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
  taskConversationService.get = async () =>
    ({
      artifacts: [
        { artifactId: 'artifact-a', artifactType: 'chapter_text' },
        { artifactId: 'artifact-b', artifactType: 'chapter_text' },
      ],
    }) as NonNullable<Awaited<ReturnType<typeof taskConversationService.get>>>;
  aiTaskRuntimeService.getArtifact = async (artifactId) => {
    artifactReads.push(artifactId);
    const chapterId = artifactId === 'artifact-a' ? 'chapter-a' : 'chapter-b';
    return {
      artifact: {
        artifactId,
        taskId: 'task-fixture',
        attemptId: 'attempt-fixture',
        sourceInputSnapshotId: 'snapshot-fixture',
        artifactType: 'chapter_text',
        schemaVersion: 1,
        rawContentRefId: 'raw-fixture',
        sourceNovelId: 'novel-001',
        sourceChapterId: chapterId,
        contentHash: 'hash-fixture',
        contentLength: 12,
        processingStatus: chapterId === 'chapter-a' ? matchingStatus : 'valid',
        createdAt: '2026-08-29T00:00:00Z',
      },
      rawContent: chapterId === 'chapter-a' ? 'A 章桌面候选' : 'B 章桌面候选',
      issues: [],
    };
  };

  try {
    assert.equal(
      await findLatestCandidateText('conversation-desktop', 'novel-001', 'chapter-a'),
      'A 章桌面候选',
    );
    assert.deepEqual(artifactReads, ['artifact-b', 'artifact-a']);

    matchingStatus = 'invalid';
    await assert.rejects(
      findLatestCandidateText('conversation-desktop', 'novel-001', 'chapter-a'),
      /ResultArtifact 处理状态校验/,
    );
  } finally {
    taskConversationService.get = originalConversationGet;
    aiTaskRuntimeService.getArtifact = originalArtifactGet;
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  }
});

test('short follow-up writing inherits only explicit task-wide constraints', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
  localStorage.setItem(
    'ai_novel_studio_chapters',
    JSON.stringify([
      {
        id: 'ch-003',
        novelId: 'novel-001',
        title: '第三章',
        outline: '主角发现关键线索。',
        orderIndex: 2,
        createdAt: '2026-08-20T00:00:00Z',
        updatedAt: '2026-08-20T00:00:00Z',
      },
    ]),
  );
  const conversation = await taskConversationService.create('novel-001', '连续写作测试');
  await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    ['全程使用第三人称限知。', '本章必须在钟楼开场。', '第十二章让馆长现身。'].join('\n'),
  );
  const current = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '继续写',
  );
  let writerGoal = '';
  const runtime = createTaskRuntimeAdapter({
    chapterWriter: {
      generate: async (input) => {
        writerGoal = input.goal;
        return {
          text: '这是由短提示触发并读取正式小说资产后生成的章节候选正文，长度足够进入人工审阅。',
          source: 'writer',
        };
      },
    },
  });

  const run = await runtime.start({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    chapterId: 'ch-003',
    turnId: current.turnId,
    goal: '继续写',
    modelSnapshot: mockModel(),
  });

  assert.equal(run.status, 'completed');
  assert.match(writerGoal, /【当前用户指令】\n继续写/);
  assert.match(writerGoal, /全程使用第三人称限知/);
  assert.doesNotMatch(writerGoal, /钟楼开场|馆长现身/);
});

test('writer progress replaces the running event result and terminal evidence replaces progress', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
  localStorage.setItem(
    'ai_novel_studio_chapters',
    JSON.stringify([
      {
        id: 'ch-003',
        novelId: 'novel-001',
        title: '第三章',
        outline: '主角发现关键线索。',
        orderIndex: 2,
        createdAt: '2026-08-20T00:00:00Z',
        updatedAt: '2026-08-20T00:00:00Z',
      },
    ]),
  );
  const conversation = await taskConversationService.create('novel-001', '可见写章进度测试');
  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '继续写',
  );
  const projectedProgress: unknown[] = [];
  const runtime = createTaskRuntimeAdapter({
    chapterWriter: {
      generate: async (input) => {
        await input.onProgress?.({
          phase: 'generating_draft',
          acceptedWordRange: { minimum: 2_400, maximum: 3_450 },
          timestamp: '2026-08-30T00:00:00.000Z',
        });
        await input.onProgress?.({
          phase: 'repairing_length',
          repairAttempt: 1,
          repairMaximumAttempts: 3,
          currentWordCount: 3_526,
          acceptedWordRange: { minimum: 2_400, maximum: 3_450 },
          timestamp: '2026-08-30T00:01:00.000Z',
        });
        return {
          text: '这是完成长度收敛后的章节候选正文，仍需用户审阅确认后才能采用。',
          source: 'writer',
          finalWordCount: 3_240,
        };
      },
    },
  });

  const run = await runtime.start(
    {
      conversationId: conversation.conversationId,
      novelId: 'novel-001',
      chapterId: 'ch-003',
      turnId: turn.turnId,
      goal: '继续写',
      modelSnapshot: mockModel(),
    },
    (event) => {
      if (
        event.toolEvent?.toolName === 'generate_chapter' &&
        event.toolEvent.status === 'running' &&
        event.toolEvent.result !== undefined
      ) {
        projectedProgress.push(event.toolEvent.result);
      }
    },
  );

  assert.equal(run.status, 'completed', run.error);
  assert.deepEqual(
    projectedProgress.map((result) => (result as { phase?: string }).phase),
    ['generating_draft', 'repairing_length'],
  );
  assert.doesNotMatch(JSON.stringify(projectedProgress), /继续写|候选正文|apiKey/i);
  const bundle = await taskConversationService.get(conversation.conversationId);
  const writerEvent = bundle?.toolEvents.find((event) => event.toolName === 'generate_chapter');
  assert.equal(writerEvent?.status, 'succeeded');
  assert.equal((writerEvent?.result as { phase?: string } | undefined)?.phase, undefined);
  assert.equal(
    (writerEvent?.result as { generationContext?: { finalWordCount?: number } } | undefined)
      ?.generationContext?.finalWordCount,
    3_240,
  );
});

test('generic continue writing retrieves adopted memory without requiring prompt keywords', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
  localStorage.setItem(
    'ai_novel_studio_chapters',
    JSON.stringify([
      {
        id: 'ch-002',
        novelId: 'novel-001',
        title: '第二章',
        outline: '主角取得铜钥匙并暂时隐藏机械钟。',
        orderIndex: 1,
        createdAt: '2026-08-19T00:00:00Z',
        updatedAt: '2026-08-19T00:00:00Z',
      },
      {
        id: 'ch-003',
        novelId: 'novel-001',
        title: '第三章',
        outline: '主角沿着铜钥匙留下的线索进入钟楼。',
        orderIndex: 2,
        createdAt: '2026-08-20T00:00:00Z',
        updatedAt: '2026-08-20T00:00:00Z',
      },
    ]),
  );
  putLocalMemoryDocument({
    documentId: 'memory-adopted-chapter-2',
    novelId: 'novel-001',
    sourceType: 'adopted_draft',
    sourceId: 'draft-chapter-2',
    sourceVersion: 1,
    sourceHash: 'a'.repeat(64),
    adoptedDraftId: 'draft-chapter-2',
    chapterId: 'ch-002',
    metadata: { title: '第二章' },
    chunks: [
      {
        id: 'chunk-chapter-2-0',
        ordinal: 0,
        text: '沈岚把机械钟藏进旧档案柜，决定天亮前不告诉任何人。',
        tokenCount: 26,
        importance: 0.85,
        chapterOrderIndex: 0,
        temporalStartChapter: 0,
        entityKeys: [],
        metadata: { source: 'adopted_draft' },
        contentHash: 'b'.repeat(64),
      },
    ],
  });
  assert.equal(
    retrieveLocalMemory('novel-001', '', 8, {
      sourceTypes: ['adopted_draft'],
      chapterEnd: 0,
      temporalChapter: 1,
    }).items[0]?.text,
    '沈岚把机械钟藏进旧档案柜，决定天亮前不告诉任何人。',
  );
  const conversation = await taskConversationService.create('novel-001', '短指令连续性测试');
  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '继续写',
  );
  let memoryContext: unknown;
  const runtime = createTaskRuntimeAdapter({
    chapterWriter: {
      generate: async (input) => {
        memoryContext = input.memoryContext;
        return {
          text: '这是使用已采用正文连续性记忆生成的章节候选，长度足够进入人工审阅。',
          source: 'writer',
        };
      },
    },
  });

  const run = await runtime.start({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    chapterId: 'ch-003',
    turnId: turn.turnId,
    goal: '继续写',
    modelSnapshot: mockModel(),
  });

  assert.equal(run.status, 'completed');
  assert.equal(
    (memoryContext as { items?: Array<{ text?: string }> } | undefined)?.items?.[0]?.text,
    '沈岚把机械钟藏进旧档案柜，决定天亮前不告诉任何人。',
  );
});

test('task chapter target restores from the latest persisted run evidence', () => {
  const bundle = {
    conversation: {
      conversationId: 'conversation-target',
      novelId: 'novel-001',
      title: '连续写作',
      status: 'idle' as const,
      createdAt: '2026-08-20T00:00:00Z',
      updatedAt: '2026-08-20T00:02:00Z',
    },
    turns: [],
    runs: [
      {
        runId: 'run-old',
        conversationId: 'conversation-target',
        turnId: 'turn-old',
        status: 'completed' as const,
        modelSnapshot: mockModel(),
        workerId: 'worker-old',
        createdAt: '2026-08-20T00:00:00Z',
        updatedAt: '2026-08-20T00:00:00Z',
      },
      {
        runId: 'run-new',
        conversationId: 'conversation-target',
        turnId: 'turn-new',
        status: 'completed' as const,
        modelSnapshot: mockModel(),
        workerId: 'worker-new',
        createdAt: '2026-08-20T00:02:00Z',
        updatedAt: '2026-08-20T00:02:00Z',
      },
    ],
    toolEvents: [
      {
        eventId: 'event-old',
        runId: 'run-old',
        sequence: 0,
        toolName: 'chapter.read_outline',
        argumentsSummary: { novelId: 'novel-001', chapterId: 'chapter-001' },
        status: 'succeeded' as const,
        createdAt: '2026-08-20T00:00:00Z',
      },
      {
        eventId: 'event-new',
        runId: 'run-new',
        sequence: 0,
        toolName: 'chapter.read_outline',
        argumentsSummary: { novelId: 'novel-001', chapterId: 'chapter-002' },
        status: 'succeeded' as const,
        createdAt: '2026-08-20T00:02:00Z',
      },
    ],
    artifacts: [],
  };

  assert.equal(resolveConversationTargetChapter(bundle), 'chapter-002');
});

test('greetings complete without generate_chapter or a DSH worker', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
  localStorage.setItem(
    'ai_novel_studio_chapters',
    JSON.stringify([
      {
        id: 'ch-003',
        novelId: 'novel-001',
        title: '第三章',
        outline: '主角发现关键线索。',
        orderIndex: 2,
        createdAt: '2026-08-20T00:00:00Z',
        updatedAt: '2026-08-20T00:00:00Z',
      },
    ]),
  );
  const conversation = await taskConversationService.create('novel-001', '问候任务', mockModel());
  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '你好',
  );
  const run = await taskSessionAdapter.startTurn({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    chapterId: 'ch-003',
    turnId: turn.turnId,
    goal: '你好',
    modelSnapshot: mockModel(),
  });
  assert.equal(run.status, 'completed');
  const bundle = await taskConversationService.get(conversation.conversationId);
  assert.equal(bundle?.toolEvents.length, 0);
  assert.equal(
    bundle?.toolEvents.some((event) => event.toolName === 'generate_chapter'),
    false,
  );
  assert.equal(
    bundle?.turns.find((item) => item.role === 'assistant')?.content,
    WORKBENCH_CONVERSATIONAL_REPLY,
  );
});

test('chapter write without a bound chapter fails with an actionable data error', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
  const conversation = await taskConversationService.create('novel-001', '新的创作任务');
  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '生成下一章',
  );
  const run = await taskSessionAdapter.startTurn({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    turnId: turn.turnId,
    goal: '生成下一章',
    modelSnapshot: mockModel(),
  });
  assert.equal(run.status, 'failed');
  assert.match(run.error ?? '', /【data】/);
  assert.match(run.error ?? '', /选择目标章节/);
  const bundle = await taskConversationService.get(conversation.conversationId);
  assert.equal(
    bundle?.toolEvents.some((event) => event.toolName === 'generate_chapter'),
    false,
  );
  assert.equal(bundle?.conversation.title, '生成下一章');
});

test('cancelling an active worker is scoped to its conversation', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
  const [conversation, unaffected] = await Promise.all([
    taskConversationService.create('novel-001', '可取消任务'),
    taskConversationService.create('novel-001', '不受影响任务'),
  ]);
  const [turn, unaffectedTurn] = await Promise.all([
    taskConversationService.appendTurn(conversation.conversationId, 'user', '检查上下文'),
    taskConversationService.appendTurn(unaffected.conversationId, 'user', '继续检查上下文'),
  ]);
  const promise = taskRuntimeAdapter.start({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    turnId: turn.turnId,
    goal: '检查上下文',
  });
  const unaffectedPromise = taskRuntimeAdapter.start({
    conversationId: unaffected.conversationId,
    novelId: 'novel-001',
    turnId: unaffectedTurn.turnId,
    goal: '继续检查上下文',
  });
  assert.equal(taskRuntimeAdapter.cancel(conversation.conversationId), true);
  const [run, unaffectedRun] = await Promise.all([promise, unaffectedPromise]);
  assert.ok(run.status === 'cancelled' || run.status === 'completed');
  assert.equal(unaffectedRun.status, 'completed');
  assert.equal(taskRuntimeAdapter.cancel('missing-conversation'), false);
});

test('browser fallback rejects a second active run for the same conversation', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
  const conversation = await taskConversationService.create('novel-001', '单活动运行');
  const firstTurn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '第一次运行',
  );
  const secondTurn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '第二次运行',
  );
  const first = taskRuntimeAdapter.start({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    turnId: firstTurn.turnId,
    goal: '第一次运行',
  });
  await assert.rejects(
    taskRuntimeAdapter.start({
      conversationId: conversation.conversationId,
      novelId: 'novel-001',
      turnId: secondTurn.turnId,
      goal: '第二次运行',
    }),
    /已有活动运行/,
  );
  await first;
});

test('browser recovery closes interrupted run and tool facts idempotently', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const conversation = await taskConversationService.create('novel-001', '恢复任务');
  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '恢复上一轮',
  );
  const run = await taskConversationService.createRun(
    conversation.conversationId,
    turn.turnId,
    {
      providerId: 'mock',
      modelId: 'Mock',
      runtimeMode: 'mock',
      capabilities: ['conversation_turn', 'chapter_generate'],
      options: {},
      capturedAt: new Date().toISOString(),
    },
    `worker-${conversation.conversationId}`,
  );
  await taskConversationService.updateRun(run.runId, 'running', {
    startedAt: new Date().toISOString(),
  });
  await taskConversationService.appendToolEvent({
    runId: run.runId,
    toolName: 'novel.read_context',
    argumentsSummary: { novelId: 'novel-001' },
    status: 'running',
    createdAt: new Date().toISOString(),
  });

  assert.equal(await taskConversationService.recoverInterruptedRuns(), 1);
  assert.equal(await taskConversationService.recoverInterruptedRuns(), 0);
  const bundle = await taskConversationService.get(conversation.conversationId);
  assert.equal(bundle?.conversation.status, 'failed');
  assert.equal(bundle?.runs[0].status, 'failed');
  assert.equal(bundle?.runs[0].error, '工作台已重新加载，上一轮运行已中断。请重试本回合。');
  assert.equal(bundle?.toolEvents[0].status, 'cancelled');
});

test('task model selection persists the complete non-secret snapshot', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const conversation = await taskConversationService.create('novel-001', '模型任务');
  const snapshot = {
    providerId: 'deepseek',
    modelId: 'deepseek-chat',
    runtimeMode: 'api' as const,
    baseUrl: 'https://api.deepseek.com',
    capabilities: ['conversation_turn', 'chapter_generate'],
    options: { temperature: 0.4, maxTokens: 4096, timeoutSeconds: 90 },
    pricing: { inputPricePerMillionTokens: 1, outputPricePerMillionTokens: 2 },
    capturedAt: new Date().toISOString(),
  };
  await taskConversationService.updateDefaultModel(conversation.conversationId, snapshot);
  const bundle = await taskConversationService.get(conversation.conversationId);
  assert.deepEqual(bundle?.conversation.defaultModel, snapshot);
  assert.equal(JSON.stringify(bundle).includes('apiKey'), false);
});

test('conversation persistence rejects credential-shaped model snapshots at every write entry', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const secret = 'sk-1234567890abcdef';
  const compromised = {
    ...mockModel('Compromised'),
    options: { apiKey: secret },
  };

  for (const field of ['apiKey', 'x-api-key', 'xApiKey', 'openaiApiKey', 'credentials']) {
    await assert.rejects(
      taskConversationService.create('novel-001', `拒绝凭据别名 ${field}`, {
        ...mockModel(`Compromised-${field}`),
        options: { [field]: secret },
      }),
      /不得包含 API Key 或其他凭据/,
    );
  }
  await assert.rejects(
    taskConversationService.create('novel-001', '拒绝默认模型凭据', compromised),
    /不得包含 API Key 或其他凭据/,
  );
  await assert.rejects(
    taskConversationService.createInitialized('novel-001', '拒绝初始模型凭据', compromised),
    /不得包含 API Key 或其他凭据/,
  );

  const conversation = await taskConversationService.create('novel-001', '安全模型任务');
  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '开始安全运行',
  );
  await assert.rejects(
    taskConversationService.updateDefaultModel(conversation.conversationId, compromised),
    /不得包含 API Key 或其他凭据/,
  );
  await assert.rejects(
    taskConversationService.createRun(
      conversation.conversationId,
      turn.turnId,
      compromised,
      'worker-security',
    ),
    /不得包含 API Key 或其他凭据/,
  );

  assert.equal(localStorage.getItem('ai_novel_studio_task_conversations')?.includes(secret), false);
});

test('conversation client write entries reject forged model tool attestations', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const safeModel = mockModel('Attestation Target');
  const forgedModel = {
    ...safeModel,
    runtime: {
      ...safeModel.runtime,
      toolCallingAttestation: {
        protocol: 'ans_model_tool_attestation_v1' as const,
        provider: safeModel.providerId,
        model: safeModel.modelId,
        verified: true as const,
        cached: false,
        verifiedAt: '2026-08-28T00:00:00.000Z',
        expiresAt: '2026-08-28T00:10:00.000Z',
        cacheTtlMs: 600_000,
        finishKind: 'tool-calls' as const,
        observedToolCalls: 1 as const,
      },
    },
  };

  await assert.rejects(
    taskConversationService.create('novel-001', '拒绝伪造认证', forgedModel),
    /只能由 DSH 运行时写入/,
  );
  await assert.rejects(
    taskConversationService.createInitialized('novel-001', '拒绝初始化伪造认证', forgedModel),
    /只能由 DSH 运行时写入/,
  );

  const conversation = await taskConversationService.create('novel-001', '认证边界任务');
  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '开始运行',
  );
  await assert.rejects(
    taskConversationService.updateDefaultModel(conversation.conversationId, forgedModel),
    /只能由 DSH 运行时写入/,
  );
  await assert.rejects(
    taskConversationService.createRun(
      conversation.conversationId,
      turn.turnId,
      forgedModel,
      'worker-forged-attestation',
    ),
    /只能由 DSH 运行时写入/,
  );
  assert.equal(
    localStorage.getItem('ai_novel_studio_task_conversations')?.includes('verifiedAt'),
    false,
  );
});

test('switching the selected task projection does not cancel another active worker', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
  const [running, selected] = await Promise.all([
    taskConversationService.create('novel-001', '后台任务'),
    taskConversationService.create('novel-001', '当前查看任务'),
  ]);
  const turn = await taskConversationService.appendTurn(
    running.conversationId,
    'user',
    '读取上下文',
  );
  const promise = taskRuntimeAdapter.start({
    conversationId: running.conversationId,
    novelId: 'novel-001',
    turnId: turn.turnId,
    goal: '读取上下文',
  });
  assert.equal(taskRuntimeAdapter.isRunning(running.conversationId), true);
  assert.equal(
    (await taskConversationService.get(selected.conversationId))?.conversation.title,
    '当前查看任务',
  );
  assert.equal((await promise).status, 'completed');
});

test('tool lifecycle persists ordered states and rejects terminal rewrites', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const conversation = await taskConversationService.create('novel-001', '工具状态');
  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '检查',
  );
  const run = await taskConversationService.createRun(
    conversation.conversationId,
    turn.turnId,
    mockModel(),
    'worker-tool-lifecycle',
  );
  await taskConversationService.updateRun(run.runId, 'running', {
    startedAt: new Date().toISOString(),
  });
  const queued = await taskConversationService.appendToolEvent({
    runId: run.runId,
    toolName: 'novel.read_context',
    argumentsSummary: { argumentsHash: 'hash-only' },
    status: 'queued',
    createdAt: new Date().toISOString(),
  });
  const running = await taskConversationService.updateToolEvent(queued, { status: 'running' });
  const succeeded = await taskConversationService.updateToolEvent(running, {
    status: 'succeeded',
    durationMs: 8,
    result: { contentHash: 'result-hash' },
    finishedAt: new Date().toISOString(),
  });
  assert.equal(succeeded.status, 'succeeded');
  await assert.rejects(
    taskConversationService.updateToolEvent(succeeded, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
    }),
    /不可改写/,
  );
});

test('artifact cards expose confirm-to-review actions for chapter candidates', () => {
  const html = renderToStaticMarkup(
    createElement(ArtifactCard, {
      artifact: {
        cardId: 'card-1',
        conversationId: 'conversation-1',
        artifactId: 'artifact-1',
        artifactType: 'chapter_text',
        title: '第3章候选',
        summary: '候选摘要',
        content: '候选正文',
        status: 'candidate',
        createdAt: '2026-08-21T00:00:00Z',
      },
      onDecide: () => undefined,
    }),
  );
  assert.match(html, /确认进入审阅/);
  assert.match(html, /data-testid="workbench-artifact-confirm-review"/);
});

test('artifact cards render persisted source, baseline, and validation evidence', () => {
  const html = renderToStaticMarkup(
    createElement(ArtifactCard, {
      artifact: {
        cardId: 'card-evidence',
        conversationId: 'conversation-1',
        artifactId: 'artifact-evidence',
        artifactType: 'chapter_text',
        title: '章节候选',
        summary: '候选已完成产物校验。',
        content: '候选正文',
        status: 'candidate',
        createdAt: '2026-08-21T00:00:00Z',
        artifactEvidence: {
          sourceNovelId: 'novel-001',
          sourceChapterId: 'chapter-003',
          sourceDraftId: 'draft-007',
          sourceDraftVersion: 7,
          baseContentHash: '1234567890abcdef1234567890abcdef',
          processingStatus: 'valid_with_warnings',
          validationIssues: [
            {
              issueId: 'issue-warning',
              artifactId: 'artifact-evidence',
              validationRunId: 'validation-1',
              issueIndex: 0,
              severity: 'warning',
              code: 'ARTIFACT_PROVIDER_TARGET_IGNORED',
              message: 'Provider 目标已忽略',
              validatorVersion: 'artifact-validator-m1-v2',
              createdAt: '2026-08-21T00:00:00Z',
            },
          ],
        },
      },
    }),
  );

  assert.match(html, /data-processing-status="valid_with_warnings"/);
  assert.match(html, /生成来源：作品 novel-001 · 章节 chapter-003 · 草稿 draft-007/);
  assert.match(html, /生成时基线：源草稿 v7 · 内容哈希 1234567890ab\.\.\./);
  assert.match(html, /结构与来源校验通过，含警告 · 1 个警告/);
});

test('invalid artifact evidence blocks confirmation but keeps revision and rejection available', () => {
  const html = renderToStaticMarkup(
    createElement(ArtifactCard, {
      artifact: {
        cardId: 'card-invalid',
        conversationId: 'conversation-1',
        artifactId: 'artifact-invalid',
        artifactType: 'chapter_text',
        title: '无效章节候选',
        summary: '候选已通过 ResultArtifact 校验。',
        content: '不完整候选正文',
        status: 'candidate',
        createdAt: '2026-08-21T00:00:00Z',
        artifactEvidence: {
          sourceNovelId: 'novel-001',
          sourceChapterId: 'chapter-003',
          processingStatus: 'invalid',
          validationIssues: [
            {
              issueId: 'issue-error',
              artifactId: 'artifact-invalid',
              validationRunId: 'validation-2',
              issueIndex: 0,
              severity: 'error',
              code: 'ARTIFACT_EMPTY',
              message: 'Provider 返回为空',
              validatorVersion: 'artifact-validator-m1-v2',
              createdAt: '2026-08-21T00:00:00Z',
            },
          ],
        },
      },
      onDecide: () => undefined,
    }),
  );

  assert.match(html, /data-testid="workbench-artifact-confirm-review" disabled=""/);
  assert.match(html, /结构与来源校验未通过 · 1 个错误/);
  assert.doesNotMatch(html, /候选已通过 ResultArtifact 校验/);
  assert.match(html, /要求修改/);
  assert.match(html, /拒绝/);
});

test('only atomically supported structured artifact cards expose an apply action', () => {
  for (const artifactType of [
    'outline',
    'character_candidates',
    'event_candidates',
    'setting_candidates',
    'chapter_summary',
  ] as const) {
    const html = renderToStaticMarkup(
      createElement(ArtifactCard, {
        artifact: {
          cardId: `card-${artifactType}`,
          conversationId: 'conversation-1',
          artifactId: `artifact-${artifactType}`,
          artifactType,
          title: '结构化候选',
          summary: '候选摘要',
          content: '候选内容',
          status: 'candidate',
          createdAt: '2026-08-21T00:00:00Z',
        },
        onDecide: () => undefined,
      }),
    );
    assert.match(html, /data-testid="workbench-artifact-apply"/);
    assert.match(html, /data-availability="available"/);
    assert.doesNotMatch(html, /workbench-artifact-apply"[^>]*disabled/);
    assert.match(html, /应用到作品/);
  }

  const reportHtml = renderToStaticMarkup(
    createElement(ArtifactCard, {
      artifact: {
        cardId: 'card-report',
        conversationId: 'conversation-1',
        artifactId: 'artifact-report',
        artifactType: 'quality_report',
        title: '质量报告',
        summary: '报告摘要',
        content: '报告内容',
        status: 'candidate',
        createdAt: '2026-08-21T00:00:00Z',
      },
      onDecide: () => undefined,
    }),
  );
  assert.doesNotMatch(reportHtml, /workbench-artifact-apply/);
  assert.match(reportHtml, /要求修改/);
  assert.match(reportHtml, /拒绝/);

  const genericHtml = renderToStaticMarkup(
    createElement(ArtifactCard, {
      artifact: {
        cardId: 'card-generic',
        conversationId: 'conversation-1',
        artifactId: 'artifact-generic',
        artifactType: 'generic_json',
        title: '通用上下文候选',
        summary: '候选摘要',
        content: '{}',
        status: 'candidate',
        createdAt: '2026-08-21T00:00:00Z',
      },
      onDecide: () => undefined,
    }),
  );
  assert.doesNotMatch(genericHtml, /workbench-artifact-apply/);
});

test('structured artifact cards disclose browser apply limitations before interaction', () => {
  const html = renderToStaticMarkup(
    createElement(ArtifactCard, {
      artifact: {
        cardId: 'card-browser-outline',
        conversationId: 'conversation-1',
        artifactId: 'browser-artifact-outline',
        artifactType: 'outline',
        title: '结构化候选',
        summary: '候选摘要',
        content: '候选内容',
        status: 'candidate',
        createdAt: '2026-08-21T00:00:00Z',
      },
      onDecide: () => undefined,
    }),
  );

  assert.match(html, /data-availability="runtime-unsupported"/);
  assert.match(html, /data-testid="workbench-artifact-apply"[^>]*disabled/);
  assert.match(html, /仅桌面端可应用/);
  assert.match(html, /当前环境不可应用/);
});

test('structured artifact target resolution keeps chapter evidence separate from domain target', () => {
  for (const artifactType of ['character_candidates', 'setting_candidates'] as const) {
    assert.deepEqual(
      resolveArtifactDecisionTarget({
        artifactType,
        sourceChapterId: 'chapter-source',
        currentChapterId: 'chapter-selected',
        novelId: 'novel-001',
      }),
      {
        targetType: 'asset',
        targetId: 'novel-001',
        chapterId: 'chapter-source',
      },
    );
  }
  for (const artifactType of ['event_candidates', 'chapter_summary', 'outline'] as const) {
    assert.equal(
      resolveArtifactDecisionTarget({
        artifactType,
        sourceChapterId: 'chapter-source',
        currentChapterId: 'chapter-selected',
        novelId: 'novel-001',
      }).targetId,
      'chapter-source',
    );
  }
});

test('structured apply conflicts require a new candidate instead of replaying the same apply key', () => {
  const html = renderToStaticMarkup(
    createElement(ArtifactCard, {
      artifact: {
        cardId: 'card-conflict',
        conversationId: 'conversation-1',
        artifactId: 'artifact-conflict',
        artifactType: 'setting_candidates',
        title: '冲突设定候选',
        summary: '候选基线已经过期',
        content: '{}',
        status: 'candidate',
        createdAt: '2026-08-21T00:00:00Z',
        latestDecision: {
          decisionId: 'decision-conflict',
          artifactId: 'artifact-conflict',
          artifactHash: 'artifact-hash',
          cardId: 'card-conflict',
          conversationId: 'conversation-1',
          decision: 'request_apply',
          idempotencyKey: 'card-conflict:request_apply:atomic-v1',
          actor: 'user',
          targetType: 'asset',
          targetId: 'novel-001',
          conflictCode: 'STRUCTURED_BASE_REVISION_CONFLICT',
          createdAt: '2026-08-21T00:00:01Z',
        },
      },
      onDecide: () => undefined,
    }),
  );
  assert.doesNotMatch(html, /workbench-artifact-apply/);
  assert.match(html, /要求修改/);
  assert.match(html, /拒绝/);
});

test('known tools render a semantic Chinese label beside the technical name', () => {
  const html = renderToStaticMarkup(
    createElement(ToolEventRow, {
      event: {
        eventId: 'event-context',
        runId: 'run-context',
        sequence: 1,
        toolName: 'novel.read_context',
        argumentsSummary: { novelId: 'novel-001' },
        status: 'succeeded',
        durationMs: 12,
        createdAt: '2026-08-21T00:00:00Z',
        finishedAt: '2026-08-21T00:00:01Z',
      },
    }),
  );
  assert.match(html, /读取小说上下文/);
  assert.match(html, /novel\.read_context/);

  const characterStateHtml = renderToStaticMarkup(
    createElement(ToolEventRow, {
      event: {
        eventId: 'event-character-state',
        runId: 'run-context',
        sequence: 2,
        toolName: 'get_character_states',
        argumentsSummary: { chapterId: 'chapter-003' },
        status: 'succeeded',
        createdAt: '2026-08-21T00:00:00Z',
        finishedAt: '2026-08-21T00:00:01Z',
      },
    }),
  );
  assert.match(characterStateHtml, /读取人物状态/);
  assert.doesNotMatch(characterStateHtml, /运行时事件/);
});

test('writer tool rows keep a compact summary and defer the expanded receipt payload', () => {
  const html = renderToStaticMarkup(
    createElement(ToolEventRow, {
      event: {
        eventId: 'event-writer-context',
        runId: 'run-writer-context',
        sequence: 2,
        toolName: 'generate_chapter',
        argumentsSummary: { novelId: 'novel-001', chapterId: 'chapter-003' },
        status: 'succeeded',
        result: {
          ok: true,
          generationContext: {
            contextHash: 'must-not-be-rendered-context-hash',
            continuitySourceHash: 'must-not-be-rendered-continuity-hash',
            providerRequestEvidence: {
              snapshotRequestSourceStatus: 'included',
            },
            sources: [
              {
                type: 'world_setting',
                title: '世界设定',
                status: 'used',
                sourceId: 'must-not-be-rendered-source-id',
                summary: 'must-not-be-rendered-summary',
              },
              { type: 'chapter_outline', title: '章节大纲', status: 'used' },
              { type: 'memory_context', title: '长期记忆', status: 'missing' },
              { type: 'style_profile', title: '风格方案', status: 'fallback' },
            ],
          },
        },
        createdAt: '2026-08-21T00:00:00Z',
        finishedAt: '2026-08-21T00:00:01Z',
      },
    }),
  );

  const summaryEnd = html.indexOf('</summary>');
  const compactSummaryIndex = html.indexOf('data-testid="workbench-context-summary"');
  const detailIndex = html.indexOf('class="workbench-tool-detail"');
  const fullReceiptIndex = html.indexOf('data-testid="workbench-context-receipt"');
  assert.ok(compactSummaryIndex >= 0 && compactSummaryIndex < summaryEnd);
  assert.equal(detailIndex, -1);
  assert.equal(fullReceiptIndex, -1);
  assert.equal(html.match(/data-testid="workbench-context-receipt"/gu)?.length, undefined);
  assert.match(html, /快照 2\/4/);
  assert.match(html, /Provider 2\/4/);
  assert.match(html, /正式世界/);
  assert.match(html, /data-context-status="used"/);
  assert.match(html, /Memory/);
  assert.match(html, /data-context-status="missing"/);
  assert.match(html, /风格 \/ 输出/);
  assert.match(html, /data-context-status="fallback"/);
  assert.doesNotMatch(html, /must-not-be-rendered/);
});

test('running writer tool rows expose safe chapter-generation progress inline', () => {
  const html = renderToStaticMarkup(
    createElement(ToolEventRow, {
      event: {
        eventId: 'event-writer-progress',
        runId: 'run-writer-progress',
        sequence: 2,
        toolName: 'generate_chapter',
        argumentsSummary: { novelId: 'novel-001', chapterId: 'chapter-003' },
        status: 'running',
        result: {
          phase: 'repairing_length',
          repairAttempt: 1,
          repairMaximumAttempts: 3,
          currentWordCount: 3_526,
          acceptedWordRange: { minimum: 2_400, maximum: 3_450 },
          timestamp: '2026-08-30T00:01:00.000Z',
        },
        createdAt: '2026-08-30T00:00:00.000Z',
      },
    }),
  );

  assert.match(html, /data-testid="workbench-writer-progress"/);
  assert.match(html, /收敛章节长度/);
  assert.match(html, /1\/3/);
  assert.match(html, /3,526 字/);
  assert.match(html, /允许 2,400-3,450 字/);
  assert.doesNotMatch(html, /运行中|用户提示词|候选正文|apiKey/i);
});

test('DSH candidate rows report only observed read tools when source details are unavailable', () => {
  const readEvents = [
    {
      eventId: 'event-dsh-read-novel',
      runId: 'run-dsh-context',
      sequence: 1,
      toolName: 'novel.read_context',
      argumentsSummary: { source: 'dsh-session.event' },
      status: 'succeeded' as const,
      result: { contentHash: 'novel-context-hash', largeTextRefId: 'novel-context-ref' },
      createdAt: '2026-08-21T00:00:00Z',
      finishedAt: '2026-08-21T00:00:01Z',
    },
    {
      eventId: 'event-dsh-read-outline',
      runId: 'run-dsh-context',
      sequence: 2,
      toolName: 'chapter.read_outline',
      argumentsSummary: { source: 'dsh-session.event' },
      status: 'succeeded' as const,
      result: { contentHash: 'chapter-outline-hash', largeTextRefId: 'chapter-outline-ref' },
      createdAt: '2026-08-21T00:00:01Z',
      finishedAt: '2026-08-21T00:00:02Z',
    },
  ];
  const candidateEvent = {
    eventId: 'event-dsh-candidate',
    runId: 'run-dsh-context',
    sequence: 3,
    toolName: 'generate_chapter',
    argumentsSummary: { source: 'dsh-session.event' },
    status: 'succeeded' as const,
    result: { contentHash: 'candidate-hash', largeTextRefId: 'candidate-ref' },
    createdAt: '2026-08-21T00:00:02Z',
    finishedAt: '2026-08-21T00:00:03Z',
  };
  const html = renderToStaticMarkup(
    createElement(ToolEventRow, {
      event: candidateEvent,
      runEvents: [...readEvents, candidateEvent],
    }),
  );

  assert.match(html, /data-context-evidence="observed"/);
  assert.match(html, /章节大纲/);
  assert.match(html, /data-context-status="read"/);
  assert.doesNotMatch(html, /已使用/);
});

test('candidate rows say source evidence is unavailable instead of inventing usage', () => {
  const html = renderToStaticMarkup(
    createElement(ToolEventRow, {
      event: {
        eventId: 'event-dsh-no-context',
        runId: 'run-dsh-no-context',
        sequence: 1,
        toolName: 'generate_outline',
        argumentsSummary: { source: 'dsh-session.event' },
        status: 'succeeded',
        result: { contentHash: 'candidate-hash' },
        createdAt: '2026-08-21T00:00:00Z',
        finishedAt: '2026-08-21T00:00:01Z',
      },
    }),
  );

  assert.match(html, /data-context-evidence="unavailable"/);
  assert.match(html, /来源未核验/);
  assert.doesNotMatch(html, /当前运行时没有提供可核验的来源明细/);
  assert.doesNotMatch(html, /已使用/);
});

test('context receipt accepts a future explicit envelope without exposing its internals', () => {
  const html = renderToStaticMarkup(
    createElement(ToolEventRow, {
      event: {
        eventId: 'event-future-context-envelope',
        runId: 'run-future-context-envelope',
        sequence: 1,
        toolName: 'generate_outline',
        argumentsSummary: {},
        status: 'succeeded',
        result: {
          contextReceipt: {
            sources: [
              {
                type: 'novel_context',
                title: '小说上下文',
                status: 'observed',
                sourceId: 'must-not-be-rendered-source-id',
              },
            ],
          },
        },
        createdAt: '2026-08-21T00:00:00Z',
        finishedAt: '2026-08-21T00:00:01Z',
      },
    }),
  );

  assert.match(html, /data-context-evidence="explicit"/);
  assert.match(html, /data-context-status="unverified"/);
  assert.doesNotMatch(html, /小说上下文/);
  assert.doesNotMatch(html, /must-not-be-rendered/);
});

test('plugin panel distinguishes loading and failure from a successful empty registry', () => {
  const loadingHtml = renderToStaticMarkup(
    createElement(PluginPanel, {
      plugins: [],
      loading: true,
      onClose: () => undefined,
    }),
  );
  assert.match(loadingHtml, /正在读取 Runtime Registry/);
  assert.doesNotMatch(loadingHtml, /暂无可用插件/);

  const errorHtml = renderToStaticMarkup(
    createElement(PluginPanel, {
      plugins: [],
      error: 'Runtime Registry 暂不可用。',
      onClose: () => undefined,
    }),
  );
  assert.match(errorHtml, /Runtime Registry 暂不可用/);
  assert.doesNotMatch(errorHtml, /暂无可用插件/);
});

test('unknown DSH event projections use the generic tool row renderer', () => {
  const html = renderToStaticMarkup(
    createElement(ToolEventRow, {
      event: {
        eventId: 'event-future',
        runId: 'run-future',
        callId: 'event:41:future/event',
        sequence: 41,
        toolName: 'dsh.future.event',
        argumentsSummary: { eventType: 'future/event' },
        status: 'succeeded',
        createdAt: '2026-08-21T00:00:00Z',
        finishedAt: '2026-08-21T00:00:01Z',
      },
    }),
  );
  assert.match(html, /运行时事件/);
  assert.match(html, /dsh\.future\.event/);
  assert.match(html, /data-status="succeeded"/);
});

test('task list returns conversations from every novel', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  await taskConversationService.create('novel-001', '小说一任务');
  await taskConversationService.create('novel-002', '小说二任务');
  const all = await taskConversationService.list();
  assert.ok(all.some((item) => item.novelId === 'novel-001' && item.title === '小说一任务'));
  assert.ok(all.some((item) => item.novelId === 'novel-002' && item.title === '小说二任务'));
});

test('initialized task creation persists its model and first goal atomically in browser fallback', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const model = mockModel('Mock-initialized');
  const initialized = await taskConversationService.createInitialized(
    'novel-001',
    '生成下一章并延续悬念',
    model,
  );
  const bundle = await taskConversationService.get(initialized.conversation.conversationId);

  assert.equal(initialized.conversation.title, '生成下一章并延续悬念');
  assert.equal(initialized.turn.content, '生成下一章并延续悬念');
  assert.equal(bundle?.turns.length, 1);
  assert.deepEqual(bundle?.conversation.defaultModel, model);
});

test('task management keeps archive visibility and browser fallback behavior aligned', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const conversation = await taskConversationService.create('novel-001', '待整理任务');

  const renamed = await taskConversationService.rename(conversation.conversationId, '人物线审计');
  assert.equal(renamed.title, '人物线审计');

  const archived = await taskConversationService.setArchived(conversation.conversationId, true);
  assert.ok(archived.archivedAt);
  assert.equal(
    (await taskConversationService.list()).some(
      (item) => item.conversationId === conversation.conversationId,
    ),
    false,
  );
  assert.equal(
    (await taskConversationService.list(undefined, { includeArchived: true })).some(
      (item) => item.conversationId === conversation.conversationId,
    ),
    true,
  );

  const restored = await taskConversationService.setArchived(conversation.conversationId, false);
  assert.equal(restored.archivedAt, undefined);
  assert.equal(
    (await taskConversationService.list()).some(
      (item) => item.conversationId === conversation.conversationId,
    ),
    true,
  );
});

test('browser fallback refuses to archive a task with an active run', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const conversation = await taskConversationService.create('novel-001', '运行中任务');
  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '继续执行',
  );
  await taskConversationService.createRun(
    conversation.conversationId,
    turn.turnId,
    mockModel(),
    'worker-archive-guard',
  );

  await assert.rejects(
    taskConversationService.setArchived(conversation.conversationId, true),
    /运行中的任务不能归档/,
  );
});

test('browser candidate status outranks terminal runs and interrupted-run recovery', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const conversation = await taskConversationService.create('novel-001', '候选状态归约');
  await taskConversationService.publishStructuredCandidate({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    artifactType: 'outline',
    title: '大纲候选',
    summary: '等待决定',
    structuredPayloadJson: { title: '第一卷', content: '候选内容' },
  });
  assert.equal(
    (await taskConversationService.get(conversation.conversationId))?.conversation.status,
    'waiting_user',
  );

  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '继续处理候选',
  );
  const completed = await taskConversationService.createRun(
    conversation.conversationId,
    turn.turnId,
    mockModel('Mock-completed'),
    'worker-status-completed',
  );
  await taskConversationService.updateRun(completed.runId, 'running', {
    startedAt: new Date().toISOString(),
  });
  await taskConversationService.updateRun(completed.runId, 'completed', {
    finishedAt: new Date().toISOString(),
  });

  const failed = await taskConversationService.createRun(
    conversation.conversationId,
    turn.turnId,
    mockModel('Mock-failed'),
    'worker-status-failed',
  );
  await taskConversationService.updateRun(failed.runId, 'failed', {
    error: 'fixture failure',
    finishedAt: new Date().toISOString(),
  });

  const cancelled = await taskConversationService.createRun(
    conversation.conversationId,
    turn.turnId,
    mockModel('Mock-cancelled'),
    'worker-status-cancelled',
  );
  await taskConversationService.updateRun(cancelled.runId, 'cancelled', {
    finishedAt: new Date().toISOString(),
  });

  await taskConversationService.createRun(
    conversation.conversationId,
    turn.turnId,
    mockModel('Mock-recovery'),
    'worker-status-recovery',
  );
  assert.equal(await taskConversationService.recoverInterruptedRuns('fixture interrupted'), 1);
  const bundle = await taskConversationService.get(conversation.conversationId);
  assert.equal(bundle?.conversation.status, 'waiting_user');
  assert.deepEqual(
    bundle?.runs.map((run) => run.status),
    ['completed', 'failed', 'cancelled', 'failed'],
  );
});

test('browser decisions are append-only, refreshable, and resolve multiple candidates in order', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const conversation = await taskConversationService.create('novel-001', '多候选决定');
  const first = await taskConversationService.publishStructuredCandidate({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    artifactType: 'outline',
    title: '候选一',
    summary: '等待决定',
    structuredPayloadJson: { title: '候选一', content: '第一份内容' },
  });
  const second = await taskConversationService.publishStructuredCandidate({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    artifactType: 'outline',
    title: '候选二',
    summary: '等待决定',
    structuredPayloadJson: { title: '候选二', content: '第二份内容' },
  });

  const rejected = await artifactDecisionService.record({
    conversationId: conversation.conversationId,
    cardId: first.cardId,
    artifactId: first.artifactId!,
    decision: 'reject',
    targetType: 'asset',
    targetId: 'novel-001',
    novelId: 'novel-001',
  });
  assert.equal(
    (await taskConversationService.get(conversation.conversationId))?.conversation.status,
    'waiting_user',
  );
  const replay = await artifactDecisionService.record({
    conversationId: conversation.conversationId,
    cardId: first.cardId,
    artifactId: first.artifactId!,
    decision: 'reject',
    targetType: 'asset',
    targetId: 'novel-001',
    novelId: 'novel-001',
  });
  assert.equal(replay.decision.decisionId, rejected.decision.decisionId);
  await assert.rejects(
    artifactDecisionService.record({
      conversationId: conversation.conversationId,
      cardId: first.cardId,
      artifactId: first.artifactId!,
      decision: 'reject',
      targetType: 'asset',
      targetId: 'novel-drifted-target',
      novelId: 'novel-001',
    }),
    /既有产物决定与当前重放请求身份不一致/,
  );

  await artifactDecisionService.record({
    conversationId: conversation.conversationId,
    cardId: second.cardId,
    artifactId: second.artifactId!,
    decision: 'request_revision',
    targetType: 'asset',
    targetId: 'novel-001',
    novelId: 'novel-001',
  });
  const storageSnapshot = localStorage.getItem('ai_novel_studio_task_conversations');
  const refreshedStorage = new MemoryStorage();
  if (storageSnapshot) {
    refreshedStorage.setItem('ai_novel_studio_task_conversations', storageSnapshot);
  }
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    refreshedStorage as unknown as Storage;

  const refreshed = await taskConversationService.get(conversation.conversationId);
  assert.equal(refreshed?.conversation.status, 'idle');
  assert.equal(refreshed?.decisions?.length, 2);
  assert.equal(refreshed?.artifacts[0].latestDecision?.decision, 'reject');
  assert.equal(refreshed?.artifacts[1].latestDecision?.decision, 'request_revision');
});

test('browser chapter confirmation stays pending until authorized adoption succeeds', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const conversation = await taskConversationService.create('novel-001', '章节审阅采用');
  const card = await taskConversationService.publishStructuredCandidate({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    chapterId: 'chapter-browser-review',
    artifactType: 'chapter_text',
    title: '章节正文候选',
    summary: '等待确认审阅',
    structuredPayloadJson: {
      candidateOnly: true,
      data: {
        novelId: 'novel-001',
        chapterId: 'chapter-browser-review',
        text: '浏览器章节候选正文',
      },
    },
  });
  const confirmed = await artifactDecisionService.record({
    conversationId: conversation.conversationId,
    cardId: card.cardId,
    artifactId: card.artifactId!,
    decision: 'confirm',
    targetType: 'chapter',
    targetId: 'chapter-browser-review',
    novelId: 'novel-001',
    chapterId: 'chapter-browser-review',
  });
  assert.equal(confirmed.authorization?.status, 'issued');
  assert.equal(
    (await taskConversationService.get(conversation.conversationId))?.conversation.status,
    'waiting_user',
  );

  const storageSnapshot = localStorage.getItem('ai_novel_studio_task_conversations');
  const refreshedStorage = new MemoryStorage();
  if (storageSnapshot) {
    refreshedStorage.setItem('ai_novel_studio_task_conversations', storageSnapshot);
  }
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    refreshedStorage as unknown as Storage;
  const authorizationId = confirmed.authorization!.authorizationId;
  assert.equal((await artifactDecisionService.getAuthorization(authorizationId))?.status, 'issued');
  await assert.rejects(
    artifactDecisionService.consume(authorizationId, 'draft-browser-review'),
    /只能在章节草稿采用成功后消费/,
  );

  const reviewDraft = {
    id: 'draft-browser-review',
    novelId: 'novel-001',
    chapterId: 'chapter-browser-review',
    content: '浏览器章节候选正文',
    source: 'ai_generated' as const,
    versionNo: 1,
    wordCount: 10,
    isAdopted: false,
    createdAt: '2026-08-28T00:00:00Z',
    updatedAt: '2026-08-28T00:00:01Z',
  };
  const reviewContentHash = await computeContentSha256(reviewDraft.content);
  const originalAdopt = draftVersionService.adopt;
  const originalGetById = draftVersionService.getById;
  const originalGetChapters = chapterRepository.getByNovelId;
  const originalGetVolumes = volumeRepository.getByNovelId;
  draftVersionService.getById = async (chapterId, draftId) =>
    chapterId === reviewDraft.chapterId && draftId === reviewDraft.id ? reviewDraft : null;
  chapterRepository.getByNovelId = async () => [
    {
      id: reviewDraft.chapterId,
      novelId: reviewDraft.novelId,
      title: '浏览器审阅章节',
      chapterNumber: 1,
      orderIndex: 0,
      sortOrder: 0,
      status: 'draft_generated',
      wordCount: 0,
      currentWords: 0,
      targetWords: 3_000,
      drafts: [],
      createdAt: '2026-08-28T00:00:00Z',
      updatedAt: '2026-08-28T00:00:01Z',
    },
  ];
  volumeRepository.getByNovelId = async () => [];
  let shouldFail = true;
  draftVersionService.adopt = async (draftId, chapterId) => {
    if (shouldFail) throw new Error('fixture adopt failed');
    return {
      ...reviewDraft,
      id: draftId,
      chapterId,
      isAdopted: true,
    };
  };
  try {
    await assert.rejects(
      artifactDecisionService.adoptReviewAuthorizedDraft({
        authorizationId,
        draftId: 'draft-browser-review',
        expectedDraftVersion: 1,
        expectedContentHash: reviewContentHash,
      }),
      /fixture adopt failed/,
    );
    assert.equal(
      (await artifactDecisionService.getAuthorization(authorizationId))?.status,
      'issued',
    );
    assert.equal(
      (await taskConversationService.get(conversation.conversationId))?.conversation.status,
      'waiting_user',
    );

    shouldFail = false;
    const adopted = await artifactDecisionService.adoptReviewAuthorizedDraft({
      authorizationId,
      draftId: 'draft-browser-review',
      expectedDraftVersion: 1,
      expectedContentHash: reviewContentHash,
    });
    assert.equal(adopted.authorization.status, 'consumed');
    assert.equal(adopted.authorization.consumedByDraftId, 'draft-browser-review');
    assert.equal(adopted.adoptedDraft.isAdopted, true);
  } finally {
    draftVersionService.adopt = originalAdopt;
    draftVersionService.getById = originalGetById;
    chapterRepository.getByNovelId = originalGetChapters;
    volumeRepository.getByNovelId = originalGetVolumes;
  }

  const completedSnapshot = localStorage.getItem('ai_novel_studio_task_conversations');
  const completedStorage = new MemoryStorage();
  if (completedSnapshot) {
    completedStorage.setItem('ai_novel_studio_task_conversations', completedSnapshot);
  }
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    completedStorage as unknown as Storage;
  const completed = await taskConversationService.get(conversation.conversationId);
  assert.equal(completed?.conversation.status, 'completed');
  assert.equal(completed?.authorizations?.[0].status, 'consumed');
  assert.equal(completed?.artifacts[0].reviewAuthorization?.status, 'consumed');
  assert.equal(completed?.decisions?.length, 1);
});

test('tool failures remain attached to the failed invocation and run', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
  const conversation = await taskConversationService.create('novel-001', '错误定位');
  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '读取不存在章节',
  );
  const run = await taskRuntimeAdapter.start({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    chapterId: 'missing-chapter',
    turnId: turn.turnId,
    goal: '读取不存在章节',
  });
  const bundle = await taskConversationService.get(conversation.conversationId);
  const failedEvent = bundle?.toolEvents.find((event) => event.status === 'failed');
  assert.equal(run.status, 'failed');
  assert.ok(failedEvent?.error);
  assert.equal(failedEvent?.toolName, 'chapter.read_outline');
});

test('retry creates a new immutable run instead of overwriting the failed run', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const conversation = await taskConversationService.create('novel-001', '重试任务');
  const firstTurn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '第一次',
  );
  const first = await taskConversationService.createRun(
    conversation.conversationId,
    firstTurn.turnId,
    mockModel('Mock-A'),
    'worker-retry',
    'chapter-001',
  );
  await taskConversationService.updateRun(first.runId, 'failed', {
    error: 'fixture failure',
    finishedAt: new Date().toISOString(),
  });
  const retry = await taskConversationService.createRun(
    conversation.conversationId,
    firstTurn.turnId,
    mockModel('Mock-B'),
    'worker-retry',
    'chapter-001',
  );
  const bundle = await taskConversationService.get(conversation.conversationId);
  assert.notEqual(retry.runId, first.runId);
  assert.equal(bundle?.turns.length, 1);
  assert.equal(bundle?.runs.length, 2);
  assert.equal(bundle?.runs[0].turnId, firstTurn.turnId);
  assert.equal(bundle?.runs[1].turnId, firstTurn.turnId);
  assert.equal(bundle?.runs[0].status, 'failed');
  assert.equal(bundle?.runs[0].error, 'fixture failure');
  assert.equal(bundle?.runs[0].modelSnapshot.modelId, 'Mock-A');
  assert.equal(bundle?.runs[1].modelSnapshot.modelId, 'Mock-B');
  assert.equal(bundle?.runs[0].chapterId, 'chapter-001');
  assert.equal(bundle?.runs[1].chapterId, 'chapter-001');
});

test('browser fallback refuses content cards and cannot forge ResultArtifact references', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const conversation = await taskConversationService.create('novel-001', '产物边界');
  const base = {
    conversationId: conversation.conversationId,
    artifactType: 'chapter_text' as const,
    title: '候选',
    summary: '候选',
    status: 'candidate' as const,
    createdAt: new Date().toISOString(),
  };
  await assert.rejects(
    taskConversationService.createArtifactCard({ ...base, content: '第二份正文' }),
    /必须引用 ResultArtifact/,
  );
  await assert.rejects(
    taskConversationService.createArtifactCard({
      ...base,
      artifactId: 'artifact-not-authoritative-in-browser',
      content: '',
    }),
    /不创建或伪造 ResultArtifact/,
  );
});

test('browser runtime descriptor is explicitly unavailable and labelled fallback', () => {
  const descriptor = taskSessionAdapter.describeRuntime();
  assert.equal(descriptor.status, 'unavailable');
  const session = taskSessionAdapter.getSession({
    conversationId: 'conversation-browser-marker',
    novelId: 'novel-001',
    turnId: 'turn-browser-marker',
    goal: '检查 fallback 标识',
  });
  assert.equal(session.runtime, 'ans-provider-fallback');
  taskSessionAdapter.clear(session.conversationId);
});

test('tool argument summaries redact query and candidate text payloads', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  localStorage.setItem('ai_novel_studio_novels', JSON.stringify(mockNovels));
  const secret = 'fixture-sensitive-query-value';
  const conversation = await taskConversationService.create('novel-001', '安全摘要');
  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    secret,
  );
  await taskRuntimeAdapter.start({
    conversationId: conversation.conversationId,
    novelId: 'novel-001',
    turnId: turn.turnId,
    goal: secret,
  });
  const bundle = await taskConversationService.get(conversation.conversationId);
  assert.equal(JSON.stringify(bundle?.toolEvents).includes(secret), false);
  assert.deepEqual(
    bundle?.toolEvents.find((event) => event.toolName === 'search_memory')?.argumentsSummary.query,
    { length: secret.length },
  );
});

test('a task rejects model replacement and mismatched runs after its model is frozen', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const lockedModel = mockModel('Mock-A');
  const conversation = await taskConversationService.create(
    'novel-001',
    '快照不可改写',
    lockedModel,
  );
  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '冻结模型',
  );
  const run = await taskConversationService.createRun(
    conversation.conversationId,
    turn.turnId,
    lockedModel,
    'worker-snapshot',
  );
  await assert.rejects(
    taskConversationService.updateDefaultModel(conversation.conversationId, mockModel('Mock-B')),
    /任务模型已在创建时固定/,
  );
  const secondTurn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '尝试更换模型',
  );
  await assert.rejects(
    taskConversationService.createRun(
      conversation.conversationId,
      secondTurn.turnId,
      mockModel('Mock-B'),
      'worker-mismatched-model',
    ),
    /运行模型与任务创建时固定的模型不一致/,
  );
  const bundle = await taskConversationService.get(conversation.conversationId);
  assert.equal(bundle?.conversation.defaultModel?.modelId, 'Mock-A');
  assert.equal(
    bundle?.runs.find((item) => item.runId === run.runId)?.modelSnapshot.modelId,
    'Mock-A',
  );
  assert.equal(JSON.stringify(bundle?.runs).includes('apiKey'), false);
});
