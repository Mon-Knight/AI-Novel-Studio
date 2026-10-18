import assert from 'node:assert/strict';
import test from 'node:test';
import type { Chapter } from '../../types/chapter';
import type {
  ModelToolCallingAttestation,
  TaskModelSnapshot,
  TaskRun,
} from '../../types/conversation';
import { runHostGatedChapterTurn } from '../agents/writingSubAgentChapterGate';
import { chapterRepository } from '../database/chapterRepository';
import { volumeRepository } from '../database/volumeRepository';
import { dshTaskRuntimeService, type DshTaskRuntimeResult } from '../dsh/taskRuntimeService';
import { taskSessionAdapter } from '../dsh/taskSessionAdapter';
import { taskConversationService } from './taskConversationService';
import {
  getTurnRunProjection,
  observeTurnRunProjection,
  scopeTurnRunProjection,
  turnRunProjectionCommand,
  turnRunProjectionReader,
} from './turnRunProjection';

const snapshot: TaskModelSnapshot = {
  providerId: 'deepseek-official',
  modelId: 'deepseek-chat',
  runtimeMode: 'api',
  capabilities: ['conversation_turn', 'tool_calling'],
  options: {},
  capturedAt: '2026-08-28T00:00:00.000Z',
};

const attestation: ModelToolCallingAttestation = {
  protocol: 'ans_model_tool_attestation_v1',
  provider: 'deepseek-official',
  model: 'deepseek-chat',
  verified: true,
  cached: false,
  verifiedAt: '2026-08-28T00:00:00.000Z',
  expiresAt: '2026-08-28T00:10:00.000Z',
  cacheTtlMs: 600_000,
  finishKind: 'tool-calls',
  observedToolCalls: 1,
};

function run(
  patch: Partial<TaskRun> & Pick<TaskRun, 'runId' | 'conversationId' | 'turnId'>,
): TaskRun {
  return {
    status: 'running',
    modelSnapshot: snapshot,
    workerId: 'worker',
    createdAt: '2026-08-28T00:00:00.000Z',
    updatedAt: '2026-08-28T00:00:01.000Z',
    ...patch,
  };
}

function mockTauriWindow(): PropertyDescriptor | undefined {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
  return original;
}

function restoreWindow(original: PropertyDescriptor | undefined): void {
  if (original) Object.defineProperty(globalThis, 'window', original);
  else Reflect.deleteProperty(globalThis, 'window');
}

test('turn projection command names the existing IPC and blank ids do not read', async () => {
  const original = taskConversationService.get;
  let fullReads = 0;
  taskConversationService.get = async () => {
    fullReads += 1;
    return null;
  };
  try {
    assert.equal(turnRunProjectionCommand('  ', 'turn-1'), null);
    assert.equal(turnRunProjectionCommand('conversation-1', ' '), null);
    assert.deepEqual(turnRunProjectionCommand(' conversation-1 ', ' turn-1 '), {
      command: 'get_task_turn_run_projection',
      args: { conversationId: 'conversation-1', turnId: 'turn-1' },
    });
    assert.equal(await getTurnRunProjection(' ', 'turn-1'), null);
    assert.equal(await getTurnRunProjection('conversation-1', ' '), null);
    assert.equal(fullReads, 0);
  } finally {
    taskConversationService.get = original;
  }
});

test('projection scope keeps only runs of the requested turn', () => {
  const scoped = scopeTurnRunProjection(
    {
      turn: {
        turnId: 'turn-1',
        conversationId: 'conversation-1',
        sequence: 0,
        role: 'user',
        content: '生成本章正文',
        createdAt: '2026-08-28T00:00:00.000Z',
      },
      runs: [
        run({ runId: 'run-this', conversationId: 'conversation-1', turnId: 'turn-1' }),
        run({ runId: 'run-other-turn', conversationId: 'conversation-1', turnId: 'turn-2' }),
        run({ runId: 'run-other-task', conversationId: 'conversation-2', turnId: 'turn-1' }),
      ],
    },
    'conversation-1',
    'turn-1',
  );
  assert.deepEqual(
    scoped?.runs.map((item) => item.runId),
    ['run-this'],
  );
  assert.equal(
    scopeTurnRunProjection(
      {
        turn: {
          turnId: 'turn-2',
          conversationId: 'conversation-1',
          sequence: 1,
          role: 'user',
          content: '另一回合',
          createdAt: '2026-08-28T00:00:00.000Z',
        },
        runs: [],
      },
      'conversation-1',
      'turn-1',
    ),
    null,
  );
});

test('ordinary DSH notices project one turn and do not read the full conversation', async () => {
  const originalWindow = mockTauriWindow();
  const originalStart = dshTaskRuntimeService.start;
  const originalGet = taskConversationService.get;
  const originalRead = turnRunProjectionReader.read;
  let fullReads = 0;
  const projections: Array<[string, string]> = [];
  const observed: string[] = [];
  taskConversationService.get = async () => {
    fullReads += 1;
    return null;
  };
  turnRunProjectionReader.read = async (conversationId, turnId) => {
    projections.push([conversationId, turnId]);
    return scopeTurnRunProjection(
      {
        turn: {
          turnId,
          conversationId,
          sequence: 0,
          role: 'user',
          content: '生成角色',
          createdAt: '2026-08-28T00:00:00.000Z',
        },
        runs: [
          run({ runId: 'run-this', conversationId, turnId: 'turn-other' }),
          run({ runId: 'run-this', conversationId, turnId }),
          run({ runId: 'run-other', conversationId, turnId }),
        ],
      },
      conversationId,
      turnId,
    );
  };
  dshTaskRuntimeService.start = async (input, onProjection) => {
    onProjection?.({
      conversationId: input.conversationId,
      runId: 'run-this',
      kind: 'run',
      occurredAt: '2026-08-28T00:00:02.000Z',
    });
    onProjection?.({
      conversationId: input.conversationId,
      runId: 'run-missing',
      kind: 'tool',
      occurredAt: '2026-08-28T00:00:03.000Z',
    });
    await Promise.resolve();
    const result: DshTaskRuntimeResult = {
      run: run({
        runId: 'run-final',
        conversationId: input.conversationId,
        turnId: input.turnId,
        status: 'completed',
      }),
      sessionId: 'session',
      agentId: 'agent',
      workerId: 'worker',
      runtime: 'dsh-headless-persistent',
      modelToolAttestation: attestation,
    };
    return result;
  };
  try {
    const completed = await taskSessionAdapter.startTurn(
      {
        conversationId: 'conversation-structured',
        novelId: 'novel-1',
        turnId: 'turn-structured',
        goal: '为本作品生成角色候选',
        modelSnapshot: snapshot,
      },
      (event) => observed.push(event.run.runId),
    );
    assert.deepEqual(projections, [
      ['conversation-structured', 'turn-structured'],
      ['conversation-structured', 'turn-structured'],
    ]);
    assert.equal(fullReads, 0);
    assert.deepEqual(observed, ['run-this', 'run-final']);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.runId, 'run-final');
  } finally {
    dshTaskRuntimeService.start = originalStart;
    taskConversationService.get = originalGet;
    turnRunProjectionReader.read = originalRead;
    taskSessionAdapter.clear('conversation-structured');
    restoreWindow(originalWindow);
  }
});

test('a DSH notice without an observer does not read, and a failed projection does not change the run', async () => {
  const originalWindow = mockTauriWindow();
  const originalStart = dshTaskRuntimeService.start;
  const originalGet = taskConversationService.get;
  const originalRead = turnRunProjectionReader.read;
  let fullReads = 0;
  let projections = 0;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  taskConversationService.get = async () => {
    fullReads += 1;
    return null;
  };
  turnRunProjectionReader.read = async () => {
    projections += 1;
    throw new Error('projection down');
  };
  dshTaskRuntimeService.start = async (input, onProjection) => {
    onProjection?.({
      conversationId: input.conversationId,
      runId: 'run-live',
      kind: 'run',
      occurredAt: '2026-08-28T00:00:02.000Z',
    });
    return {
      run: run({
        runId: 'run-live',
        conversationId: input.conversationId,
        turnId: input.turnId,
        status: 'completed',
      }),
      sessionId: 'session',
      agentId: 'agent',
      workerId: 'worker',
      runtime: 'dsh-headless-persistent',
      modelToolAttestation: attestation,
    };
  };
  try {
    const silent = await taskSessionAdapter.startTurn({
      conversationId: 'conversation-silent',
      novelId: 'novel-1',
      turnId: 'turn-silent',
      goal: '为本作品生成角色候选',
      modelSnapshot: snapshot,
    });
    assert.equal(projections, 0);
    assert.equal(fullReads, 0);
    assert.equal(silent.status, 'completed');

    const events: string[] = [];
    const completed = await taskSessionAdapter.startTurn(
      {
        conversationId: 'conversation-failed-projection',
        novelId: 'novel-1',
        turnId: 'turn-failed',
        goal: '为本作品生成角色候选',
        modelSnapshot: snapshot,
      },
      (event) => events.push(event.run.runId),
    );
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(projections, 1);
    assert.equal(fullReads, 0);
    assert.deepEqual(events, ['run-live']);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.error, undefined);
    assert.equal(unhandled.length, 0);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    dshTaskRuntimeService.start = originalStart;
    taskConversationService.get = originalGet;
    turnRunProjectionReader.read = originalRead;
    taskSessionAdapter.clear('conversation-silent');
    taskSessionAdapter.clear('conversation-failed-projection');
    restoreWindow(originalWindow);
  }
});

test('writing notices use the same turn projection and do not add a full conversation read', async () => {
  const originalGetChapter = chapterRepository.getById;
  const originalChapters = chapterRepository.getByNovelId;
  const originalVolumes = volumeRepository.getByNovelId;
  const originalGet = taskConversationService.get;
  const originalStart = dshTaskRuntimeService.start;
  const originalRead = turnRunProjectionReader.read;
  let fullReads = 0;
  const projections: Array<[string, string]> = [];
  chapterRepository.getById = async () =>
    ({ id: 'chapter-1', novelId: 'novel-1', targetWordCount: 0 }) as Chapter;
  chapterRepository.getByNovelId = async () => [
    { id: 'chapter-1', novelId: 'novel-1', targetWordCount: 0 } as Chapter,
  ];
  volumeRepository.getByNovelId = async () => [];
  taskConversationService.get = async (conversationId) => {
    fullReads += 1;
    return {
      conversation: {
        conversationId,
        novelId: 'novel-1',
        title: '写章',
        status: 'idle',
        createdAt: '2026-08-28T00:00:00.000Z',
        updatedAt: '2026-08-28T00:00:00.000Z',
      },
      turns: [
        {
          turnId: 'turn-write',
          conversationId,
          sequence: 0,
          role: 'user',
          content: '生成本章正文',
          createdAt: '2026-08-28T00:00:00.000Z',
        },
      ],
      runs: [],
      toolEvents: [],
      artifacts: [],
    };
  };
  turnRunProjectionReader.read = async (conversationId, turnId) => {
    projections.push([conversationId, turnId]);
    return {
      turn: {
        turnId,
        conversationId,
        sequence: 0,
        role: 'user',
        content: '生成本章正文',
        createdAt: '2026-08-28T00:00:00.000Z',
      },
      runs: [run({ runId: 'run-draft', conversationId, turnId })],
    };
  };
  dshTaskRuntimeService.start = async (input, onProjection) => {
    const readsBeforeNotice = fullReads;
    onProjection?.({
      conversationId: input.conversationId,
      runId: 'run-draft',
      kind: 'run',
      occurredAt: '2026-08-28T00:00:02.000Z',
    });
    await Promise.resolve();
    assert.equal(fullReads, readsBeforeNotice);
    throw new Error('STOP_AFTER_PROJECTION');
  };
  try {
    const seen: string[] = [];
    await assert.rejects(
      runHostGatedChapterTurn(
        {
          conversationId: 'conversation-write',
          novelId: 'novel-1',
          turnId: 'turn-write',
          chapterId: 'chapter-1',
          goal: '生成本章正文',
          modelSnapshot: snapshot,
        },
        (event) => seen.push(event.run.runId),
        async () => undefined,
      ),
      /STOP_AFTER_PROJECTION/u,
    );
    assert.deepEqual(projections, [['conversation-write', 'turn-write']]);
    assert.deepEqual(seen, ['run-draft']);
    observeTurnRunProjection('conversation-write', 'turn-write', 'run-draft', undefined);
    assert.deepEqual(projections, [['conversation-write', 'turn-write']]);
  } finally {
    chapterRepository.getById = originalGetChapter;
    chapterRepository.getByNovelId = originalChapters;
    volumeRepository.getByNovelId = originalVolumes;
    taskConversationService.get = originalGet;
    dshTaskRuntimeService.start = originalStart;
    turnRunProjectionReader.read = originalRead;
  }
});
