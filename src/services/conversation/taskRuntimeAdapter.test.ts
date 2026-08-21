import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mockNovels } from '../../features/novels/mockNovels';
import { ArtifactCard, ToolEventRow } from '../../pages/Workbench/WorkbenchComponents';
import { taskConversationService } from './taskConversationService';
import { taskRuntimeAdapter } from './taskRuntimeAdapter';
import { taskSessionAdapter } from '../dsh/taskSessionAdapter';

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
  assert.ok((firstBundle?.toolEvents.length ?? 0) >= 2);
  assert.ok((secondBundle?.toolEvents.length ?? 0) >= 2);
  assert.notEqual(firstBundle?.runs[0].workerId, secondBundle?.runs[0].workerId);
  assert.deepEqual(
    firstBundle?.toolEvents.map((event) => event.status),
    firstBundle?.toolEvents.map(() => 'succeeded'),
  );
  assert.equal(firstBundle?.artifacts.length, 0);
  assert.match(
    firstBundle?.turns.find((turn) => turn.role === 'assistant')?.content ?? '',
    /不会冒充 DSH 或 ResultArtifact/,
  );
  assert.ok(firstBundle?.toolEvents.some((event) => event.toolName === 'generate_chapter'));
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
    { goal: '为本作品生成角色候选', tool: 'search_memory' },
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
    assert.equal(run.status, 'completed', fixture.goal);
    const bundle = await taskConversationService.get(conversation.conversationId);
    assert.ok(
      bundle?.toolEvents.some((event) => event.toolName === fixture.tool),
      `${fixture.goal} should invoke ${fixture.tool}`,
    );
    assert.ok(bundle?.toolEvents.every((event) => event.status === 'succeeded'));
    assert.equal(bundle?.artifacts.length, 0);
    if (!fixture.chapterId) {
      assert.equal(
        bundle?.toolEvents.some((event) => event.toolName === 'generate_characters'),
        false,
      );
    }
  }
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
  );
  await taskConversationService.updateRun(first.runId, 'failed', {
    error: 'fixture failure',
    finishedAt: new Date().toISOString(),
  });
  const retryTurn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '重试',
  );
  const retry = await taskConversationService.createRun(
    conversation.conversationId,
    retryTurn.turnId,
    mockModel('Mock-B'),
    'worker-retry',
  );
  const bundle = await taskConversationService.get(conversation.conversationId);
  assert.notEqual(retry.runId, first.runId);
  assert.equal(bundle?.runs.length, 2);
  assert.equal(bundle?.runs[0].status, 'failed');
  assert.equal(bundle?.runs[0].modelSnapshot.modelId, 'Mock-A');
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

test('a run keeps its frozen model snapshot after the conversation default changes', async () => {
  (globalThis as typeof globalThis & { localStorage: Storage }).localStorage =
    new MemoryStorage() as unknown as Storage;
  const conversation = await taskConversationService.create(
    'novel-001',
    '快照不可改写',
    mockModel('Mock-A'),
  );
  const turn = await taskConversationService.appendTurn(
    conversation.conversationId,
    'user',
    '冻结模型',
  );
  const run = await taskConversationService.createRun(
    conversation.conversationId,
    turn.turnId,
    mockModel('Mock-A'),
    'worker-snapshot',
  );
  await taskConversationService.updateDefaultModel(
    conversation.conversationId,
    mockModel('Mock-B'),
  );
  const bundle = await taskConversationService.get(conversation.conversationId);
  assert.equal(bundle?.conversation.defaultModel?.modelId, 'Mock-B');
  assert.equal(
    bundle?.runs.find((item) => item.runId === run.runId)?.modelSnapshot.modelId,
    'Mock-A',
  );
  assert.equal(JSON.stringify(bundle?.runs).includes('apiKey'), false);
});
