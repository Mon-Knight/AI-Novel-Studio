import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ConversationArtifactCard,
  ConversationTurn,
  TaskConversationBundle,
  TaskModelSnapshot,
  TaskRun,
} from '../../types/conversation';
import { buildCoreAssetGenerationGoal, chapterAssetRecoveryStore } from './chapterAssetReadiness';
import {
  ensurePersistedChapterGoalTurn,
  recoverPersistedChapterAssetRecovery,
  resolvePreflightAssetPreparationRetryTurn,
} from './chapterAssetRecoveryPersistence';
import { encodeWorkbenchTurnContent } from './workbenchTurnOrigin';

const conversationId = 'conversation-recovery';
const novelId = 'novel-recovery';
const sparseGoal = '写个六万字左右的悬疑故事。';
const modelSnapshot: TaskModelSnapshot = {
  providerId: 'provider-fixed',
  modelId: 'model-fixed',
  runtimeMode: 'api',
  baseUrl: 'http://localhost:12074/v1',
  capabilities: ['chat', 'tool-calling'],
  options: {},
  capturedAt: '2026-08-28T00:00:00.000Z',
};

function userTurn(
  turnId: string,
  sequence: number,
  content: string,
  createdAt = `2026-08-28T00:00:0${sequence}.000Z`,
): ConversationTurn {
  return {
    turnId,
    conversationId,
    sequence,
    role: 'user',
    content,
    createdAt,
  };
}

function run(
  runId: string,
  turnId: string,
  status: TaskRun['status'],
  createdAt: string,
  error?: string,
): TaskRun {
  return {
    runId,
    conversationId,
    turnId,
    status,
    modelSnapshot,
    workerId: 'worker-recovery',
    error,
    createdAt,
    updatedAt: createdAt,
    finishedAt: ['completed', 'failed', 'cancelled'].includes(status) ? createdAt : undefined,
  };
}

function artifact(
  artifactId: string,
  turnId: string,
  runId: string,
  artifactType: ConversationArtifactCard['artifactType'],
  createdAt: string,
): ConversationArtifactCard {
  return {
    cardId: `card-${artifactId}`,
    conversationId,
    turnId,
    runId,
    artifactId,
    artifactType,
    title: '结构化候选',
    summary: '等待应用',
    status: 'candidate',
    createdAt,
  };
}

function bundle(input: Partial<TaskConversationBundle> = {}): TaskConversationBundle {
  return {
    conversation: {
      conversationId,
      novelId,
      title: sparseGoal,
      status: 'waiting_user',
      defaultModel: modelSnapshot,
      createdAt: '2026-08-28T00:00:00.000Z',
      updatedAt: '2026-08-28T00:00:05.000Z',
    },
    turns: [],
    runs: [],
    toolEvents: [],
    artifacts: [],
    decisions: [],
    ...input,
  };
}

test('rebuilds an awaiting candidate from the persisted conversation when session recovery is empty', async () => {
  assert.equal(chapterAssetRecoveryStore.get(conversationId), null);
  const source = userTurn('turn-source', 0, sparseGoal);
  const preparation = userTurn(
    'turn-world',
    1,
    encodeWorkbenchTurnContent(
      buildCoreAssetGenerationGoal('world_setting', sparseGoal),
      'workbench_asset_preparation',
    ),
  );
  const persisted = bundle({
    turns: [source, preparation],
    runs: [run('run-world', preparation.turnId, 'completed', '2026-08-28T00:00:02.000Z')],
    artifacts: [
      artifact(
        'artifact-world',
        preparation.turnId,
        'run-world',
        'setting_candidates',
        '2026-08-28T00:00:03.000Z',
      ),
    ],
  });

  const recovery = await recoverPersistedChapterAssetRecovery(
    { conversationId },
    {
      getConversation: async () => persisted,
      inspectReadiness: async () => ({ ready: false, missingAssets: ['world_setting'] }),
      now: () => '2026-08-28T00:00:04.000Z',
    },
  );

  assert.equal(recovery?.sourceTurnId, source.turnId);
  assert.equal(recovery?.originalGoal, sparseGoal);
  assert.deepEqual(recovery?.modelSnapshot, modelSnapshot);
  assert.deepEqual(recovery?.orchestration, {
    phase: 'awaiting_apply',
    asset: 'world_setting',
    preparationTurnId: preparation.turnId,
    preparationRunId: 'run-world',
    candidateArtifactId: 'artifact-world',
    updatedAt: '2026-08-28T00:00:03.000Z',
  });
});

test('reconciles an applied asset by advancing to the next formally missing asset', async () => {
  const source = userTurn('turn-source', 0, sparseGoal);
  const preparation = userTurn(
    'turn-world',
    1,
    encodeWorkbenchTurnContent('生成世界与规则设定候选', 'workbench_asset_preparation'),
  );
  const candidate = artifact(
    'artifact-world',
    preparation.turnId,
    'run-world',
    'setting_candidates',
    '2026-08-28T00:00:03.000Z',
  );
  const persisted = bundle({
    turns: [source, preparation],
    runs: [run('run-world', preparation.turnId, 'completed', '2026-08-28T00:00:02.000Z')],
    artifacts: [candidate],
    decisions: [
      {
        decisionId: 'decision-world',
        artifactId: candidate.artifactId!,
        artifactHash: 'hash-world',
        cardId: candidate.cardId,
        conversationId,
        decision: 'request_apply',
        idempotencyKey: 'apply-world',
        actor: 'user',
        targetType: 'asset',
        targetId: novelId,
        applyTransactionId: 'transaction-world',
        createdAt: '2026-08-28T00:00:04.000Z',
      },
    ],
  });

  const recovery = await recoverPersistedChapterAssetRecovery(
    { conversationId },
    {
      getConversation: async () => persisted,
      inspectReadiness: async () => ({ ready: false, missingAssets: ['protagonist'] }),
      now: () => '2026-08-28T00:00:05.000Z',
    },
  );

  assert.deepEqual(recovery?.orchestration, {
    phase: 'queued',
    asset: 'protagonist',
    updatedAt: '2026-08-28T00:00:05.000Z',
  });
});

test('rebuild uses the latest failed preparation retry instead of an older attempt', async () => {
  const source = userTurn('turn-source', 0, sparseGoal);
  const first = userTurn(
    'turn-world-first',
    1,
    encodeWorkbenchTurnContent('生成世界与规则设定候选', 'workbench_asset_preparation'),
  );
  const retry = userTurn(
    'turn-world-retry',
    2,
    encodeWorkbenchTurnContent('生成世界与规则设定候选', 'workbench_asset_preparation'),
  );
  const persisted = bundle({
    turns: [source, first, retry],
    runs: [
      run('run-world-first', first.turnId, 'failed', '2026-08-28T00:00:02.000Z', '首次失败'),
      run(
        'run-world-retry',
        retry.turnId,
        'failed',
        '2026-08-28T00:00:04.000Z',
        'Provider 暂时不可用',
      ),
    ],
  });

  const recovery = await recoverPersistedChapterAssetRecovery(
    { conversationId },
    {
      getConversation: async () => persisted,
      inspectReadiness: async () => ({ ready: false, missingAssets: ['world_setting'] }),
      now: () => '2026-08-28T00:00:05.000Z',
    },
  );

  assert.equal(recovery?.orchestration.phase, 'failed');
  assert.equal(recovery?.orchestration.preparationTurnId, retry.turnId);
  assert.equal(recovery?.orchestration.preparationRunId, 'run-world-retry');
  assert.equal(recovery?.orchestration.error, 'Provider 暂时不可用');
});

test('rebuild resumes the original source turn after all formal assets are present', async () => {
  const source = userTurn('turn-source', 0, sparseGoal);
  const recovery = await recoverPersistedChapterAssetRecovery(
    { conversationId, preferredChapterId: 'chapter-1' },
    {
      getConversation: async () => bundle({ turns: [source] }),
      inspectReadiness: async () => ({ ready: true, missingAssets: [] }),
      now: () => '2026-08-28T00:00:05.000Z',
    },
  );

  assert.equal(recovery?.chapterId, 'chapter-1');
  assert.equal(recovery?.sourceTurnId, source.turnId);
  assert.deepEqual(recovery?.orchestration, {
    phase: 'resuming',
    updatedAt: '2026-08-28T00:00:05.000Z',
  });
});

test('persisting a chapter goal reuses the latest unexecuted source turn without duplicates', async () => {
  const previous = userTurn('turn-previous', 0, '写上一章正文');
  const persisted = bundle({
    turns: [previous],
    runs: [run('run-previous', previous.turnId, 'completed', '2026-08-28T00:00:01.000Z')],
  });
  let appendCount = 0;
  const dependencies = {
    getConversation: async () => persisted,
    appendTurn: async (
      _conversationId: string,
      role: ConversationTurn['role'],
      content: string,
    ) => {
      appendCount += 1;
      const turn = userTurn('turn-source', 1, content);
      turn.role = role;
      persisted.turns.push(turn);
      return turn;
    },
  };

  const first = await ensurePersistedChapterGoalTurn(
    { conversationId, goal: sparseGoal },
    dependencies,
  );
  const second = await ensurePersistedChapterGoalTurn(
    { conversationId, goal: sparseGoal },
    dependencies,
  );

  assert.equal(appendCount, 1);
  assert.equal(first.turnId, 'turn-source');
  assert.equal(second.turnId, first.turnId);
  assert.equal(persisted.turns.filter((turn) => turn.content === sparseGoal).length, 1);
});

test('preflight retry resolves the same persisted preparation turn when it has no run', async () => {
  const goal = buildCoreAssetGenerationGoal('world_setting', sparseGoal);
  const preparation = userTurn(
    'turn-world-preflight',
    1,
    encodeWorkbenchTurnContent(goal, 'workbench_asset_preparation'),
  );

  const resolved = await resolvePreflightAssetPreparationRetryTurn(
    {
      conversationId,
      asset: 'world_setting',
      goal,
      orchestration: {
        errorCode: 'MODEL_TOOL_CALLING_NOT_VERIFIED',
        preparationTurnId: preparation.turnId,
      },
    },
    { getConversation: async () => bundle({ turns: [preparation], runs: [] }) },
  );

  assert.equal(resolved, preparation);
});

test('preflight retry fails closed when the original preparation turn id is missing', async () => {
  let getConversationCalls = 0;
  await assert.rejects(
    () =>
      resolvePreflightAssetPreparationRetryTurn(
        {
          conversationId,
          asset: 'world_setting',
          goal: buildCoreAssetGenerationGoal('world_setting', sparseGoal),
          orchestration: { errorCode: 'MODEL_TOOL_CALLING_NOT_VERIFIED' },
        },
        {
          getConversation: async () => {
            getConversationCalls += 1;
            return bundle();
          },
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { code?: string }).code, 'MODEL_TOOL_CALLING_NOT_VERIFIED');
      assert.match(error.message, /缺少原准备回合身份/);
      return true;
    },
  );
  assert.equal(getConversationCalls, 0);
});

test('preflight retry fails closed when the persisted turn identity, goal, or run history differs', async (t) => {
  const goal = buildCoreAssetGenerationGoal('world_setting', sparseGoal);
  const preparation = userTurn(
    'turn-world-preflight',
    1,
    encodeWorkbenchTurnContent(goal, 'workbench_asset_preparation'),
  );
  const resolve = (persisted: TaskConversationBundle) =>
    resolvePreflightAssetPreparationRetryTurn(
      {
        conversationId,
        asset: 'world_setting',
        goal,
        orchestration: {
          errorCode: 'MODEL_TOOL_CALLING_NOT_VERIFIED',
          preparationTurnId: preparation.turnId,
        },
      },
      { getConversation: async () => persisted },
    );

  await t.test('rejects a turn from another conversation', async () => {
    await assert.rejects(
      () =>
        resolve(
          bundle({
            turns: [{ ...preparation, conversationId: 'conversation-other' }],
            runs: [],
          }),
        ),
      /回合身份不匹配/,
    );
  });

  await t.test('rejects a different preparation goal', async () => {
    await assert.rejects(
      () =>
        resolve(
          bundle({
            turns: [
              {
                ...preparation,
                content: encodeWorkbenchTurnContent(
                  buildCoreAssetGenerationGoal('protagonist', sparseGoal),
                  'workbench_asset_preparation',
                ),
              },
            ],
            runs: [],
          }),
        ),
      /资产或创作目标不匹配/,
    );
  });

  await t.test('rejects a preparation turn with any run', async () => {
    await assert.rejects(
      () =>
        resolve(
          bundle({
            turns: [preparation],
            runs: [
              run('run-world-preflight', preparation.turnId, 'failed', '2026-08-28T00:00:02.000Z'),
            ],
          }),
        ),
      /已经存在运行记录/,
    );
  });
});

test('non-preflight failures do not enter same-turn reuse validation', async () => {
  let getConversationCalls = 0;
  const resolved = await resolvePreflightAssetPreparationRetryTurn(
    {
      conversationId,
      asset: 'world_setting',
      goal: buildCoreAssetGenerationGoal('world_setting', sparseGoal),
      orchestration: {
        errorCode: 'WORKBENCH_SERVICE_FAILED',
        preparationTurnId: 'turn-world-existing',
      },
    },
    {
      getConversation: async () => {
        getConversationCalls += 1;
        return bundle();
      },
    },
  );

  assert.equal(resolved, undefined);
  assert.equal(getConversationCalls, 0);
});

test('session parsing preserves a failed post-asset resume for explicit retry', () => {
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
      conversationId,
      novelId,
      chapterId: 'chapter-1',
      originalGoal: sparseGoal,
      missingAssets: [],
      sourceTurnId: 'turn-source',
      modelSnapshot,
      orchestration: {
        phase: 'failed',
        errorCode: 'MODEL_TOOL_CALLING_NOT_VERIFIED',
        error: '正文恢复尚未形成运行，请确认后重试。',
        updatedAt: '2026-08-28T00:00:05.000Z',
      },
      createdAt: '2026-08-28T00:00:00.000Z',
      checkedAt: '2026-08-28T00:00:05.000Z',
    });

    assert.deepEqual(chapterAssetRecoveryStore.get(conversationId)?.orchestration, {
      phase: 'failed',
      errorCode: 'MODEL_TOOL_CALLING_NOT_VERIFIED',
      error: '正文恢复尚未形成运行，请确认后重试。',
      updatedAt: '2026-08-28T00:00:05.000Z',
    });
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: previousWindow,
    });
  }
});
