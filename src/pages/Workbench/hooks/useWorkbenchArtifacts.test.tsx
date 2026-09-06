import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { PropsWithChildren } from 'react';
// @ts-expect-error jsdom has no bundled declarations; this import is test-only.
import { JSDOM } from 'jsdom';
import type { ArtifactDecision, ConversationArtifactCard } from '../../../types/conversation';
import type { RecordDecisionInput } from '../../../services/conversation/artifactDecisionService';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/#/',
});

Object.defineProperties(globalThis, {
  window: { value: dom.window, configurable: true },
  document: { value: dom.window.document, configurable: true },
  localStorage: { value: dom.window.localStorage, configurable: true },
  navigator: { value: dom.window.navigator, configurable: true },
  HTMLElement: { value: dom.window.HTMLElement, configurable: true },
  Node: { value: dom.window.Node, configurable: true },
  MutationObserver: { value: dom.window.MutationObserver, configurable: true },
  IS_REACT_ACT_ENVIRONMENT: { value: true, configurable: true, writable: true },
});

const { useRef } = await import('react');
const { MemoryRouter } = await import('react-router-dom');
const { act, cleanup, renderHook } = await import('@testing-library/react');
const { artifactDecisionService } =
  await import('../../../services/conversation/artifactDecisionService');
const { appendArtifactRevisionDraft, buildArtifactRevisionDraft } =
  await import('../artifactRevisionPrompt');
const { useConversationScopedState } = await import('./useConversationScopedState');
const { useWorkbenchArtifacts } = await import('./useWorkbenchArtifacts');

const original = {
  record: artifactDecisionService.record,
  applyStructured: artifactDecisionService.applyStructured,
};

const ARTIFACT: ConversationArtifactCard = {
  cardId: 'card-review-1',
  conversationId: 'conversation-review-1',
  artifactId: 'artifact-review-1',
  artifactType: 'character_candidates',
  title: '人物候选',
  summary: '用于隔离审阅测试的候选。',
  content: JSON.stringify({ characters: [{ name: '林夏', goal: '查明真相' }] }),
  status: 'candidate',
  createdAt: '2026-09-05T00:00:00.000Z',
  artifactEvidence: {
    sourceNovelId: 'novel-review-1',
    baseContentHash: 'base-review-1',
    processingStatus: 'valid',
    validationIssues: [],
  },
};

function decision(input: RecordDecisionInput): ArtifactDecision {
  return {
    decisionId: `decision-${input.cardId}`,
    artifactId: input.artifactId,
    artifactHash: 'artifact-hash-review-1',
    cardId: input.cardId,
    conversationId: input.conversationId,
    decision: input.decision,
    idempotencyKey: `${input.cardId}:${input.decision}`,
    actor: 'user',
    targetType: input.targetType,
    targetId: input.targetId,
    baseRevision: input.baseRevision,
    createdAt: ARTIFACT.createdAt,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

type HookInput = Parameters<typeof useWorkbenchArtifacts>[0];

function renderArtifacts(
  overrides: Partial<Pick<HookInput, 'refreshBundle' | 'loadConversations'>> = {},
) {
  const refreshed: string[] = [];
  const loaded: Array<string | undefined> = [];
  const view = renderHook(
    ({ conversationId, novelId }: { conversationId: string; novelId: string }) => {
      const selectedNovelRef = useRef(novelId);
      selectedNovelRef.current = novelId;
      const { value: draft, setValue: setDraft } = useConversationScopedState(conversationId, '');
      const { value: error, setValue: setComposerError } = useConversationScopedState(
        conversationId,
        '',
      );
      const artifacts = useWorkbenchArtifacts({
        selectedNovelId: novelId,
        chapterId: 'chapter-not-authoritative',
        selectedNovelRef,
        setDraft,
        setComposerError,
        refreshBundle: async (id) => {
          refreshed.push(id);
          await overrides.refreshBundle?.(id);
        },
        loadConversations: async (id) => {
          loaded.push(id);
          await overrides.loadConversations?.(id);
        },
      });
      return { ...artifacts, draft, setDraft, error };
    },
    {
      initialProps: { conversationId: ARTIFACT.conversationId, novelId: 'novel-review-1' },
      wrapper: ({ children }: PropsWithChildren) => <MemoryRouter>{children}</MemoryRouter>,
    },
  );
  return { ...view, refreshed, loaded };
}

beforeEach(() => {
  localStorage.clear();
  artifactDecisionService.record = async (input) => ({ decision: decision(input) });
  artifactDecisionService.applyStructured = async (input) => ({
    decision: { ...decision(input), applyTransactionId: 'apply-review-1' },
  });
});

afterEach(() => {
  cleanup();
  artifactDecisionService.record = original.record;
  artifactDecisionService.applyStructured = original.applyStructured;
});

test('artifact apply keeps its identity-only payload and does not consume review notes', async () => {
  const calls: RecordDecisionInput[] = [];
  artifactDecisionService.applyStructured = async (input) => {
    calls.push(input);
    return { decision: { ...decision(input), applyTransactionId: 'apply-review-1' } };
  };
  const originalContent = ARTIFACT.content;
  const { result } = renderArtifacts();
  await act(async () => result.current.setDraft('原有目标'));
  await act(async () => {
    await result.current.decideArtifact(ARTIFACT, 'request_apply', '仅用于修订的备注。');
  });

  assert.deepEqual(calls, [
    {
      conversationId: ARTIFACT.conversationId,
      cardId: ARTIFACT.cardId,
      artifactId: ARTIFACT.artifactId,
      decision: 'request_apply',
      targetType: 'asset',
      targetId: 'novel-review-1',
      novelId: 'novel-review-1',
      chapterId: undefined,
      baseRevision: 'base-review-1',
    },
  ]);
  assert.equal(ARTIFACT.content, originalContent);
  assert.equal(result.current.draft, '原有目标');
});

test('revision records only artifact identity and appends the complete notes to the existing draft', async () => {
  const calls: RecordDecisionInput[] = [];
  artifactDecisionService.record = async (input) => {
    calls.push(input);
    return { decision: decision(input) };
  };
  const { result, refreshed } = renderArtifacts();
  const existing = '  尚未发送的完整目标。\n尾行保留空格。  ';
  const notes = `候选：林夏\n建议摘要：${'保留原人物，只修订动机。'.repeat(1000)}\n  `;
  await act(async () => result.current.setDraft(existing));
  await act(async () => {
    await result.current.decideArtifact(ARTIFACT, 'request_revision', notes);
  });

  assert.deepEqual(Object.keys(calls[0]).sort(), [
    'artifactId',
    'baseRevision',
    'cardId',
    'chapterId',
    'conversationId',
    'decision',
    'novelId',
    'targetId',
    'targetType',
  ]);
  assert.equal(calls[0].decision, 'request_revision');
  assert.equal(
    result.current.draft,
    appendArtifactRevisionDraft(existing, buildArtifactRevisionDraft(ARTIFACT.artifactType, notes)),
  );
  assert.deepEqual(refreshed, [ARTIFACT.conversationId]);
});

test('a successful revision preserves text entered while the decision is pending', async () => {
  const pending = deferred<void>();
  artifactDecisionService.record = async (input) => {
    await pending.promise;
    return { decision: decision(input) };
  };
  const { result } = renderArtifacts();
  await act(async () => result.current.setDraft('原目标'));
  let operation!: Promise<void>;
  await act(async () => {
    operation = result.current.decideArtifact(ARTIFACT, 'request_revision', '补充动机。');
  });
  await act(async () => result.current.setDraft('原目标\n等待期间新输入的内容。'));
  await act(async () => {
    pending.resolve();
    await operation;
  });
  assert.equal(
    result.current.draft,
    appendArtifactRevisionDraft(
      '原目标\n等待期间新输入的内容。',
      buildArtifactRevisionDraft(ARTIFACT.artifactType, '补充动机。'),
    ),
  );
});

test('a late revision updates only its originating task after switching conversations', async () => {
  const pending = deferred<void>();
  artifactDecisionService.record = async (input) => {
    await pending.promise;
    return { decision: decision(input) };
  };
  const { result, rerender } = renderArtifacts();
  await act(async () => result.current.setDraft('任务一的目标'));
  let operation!: Promise<void>;
  await act(async () => {
    operation = result.current.decideArtifact(ARTIFACT, 'request_revision', '任务一的修订意见。');
  });
  await act(async () => {
    rerender({ conversationId: 'conversation-review-2', novelId: 'novel-review-1' });
  });
  await act(async () => result.current.setDraft('任务二的草稿不可被覆盖'));
  await act(async () => {
    pending.resolve();
    await operation;
  });
  assert.equal(result.current.draft, '任务二的草稿不可被覆盖');
  await act(async () => {
    rerender({ conversationId: ARTIFACT.conversationId, novelId: 'novel-review-1' });
  });
  assert.equal(
    result.current.draft,
    appendArtifactRevisionDraft(
      '任务一的目标',
      buildArtifactRevisionDraft(ARTIFACT.artifactType, '任务一的修订意见。'),
    ),
  );
});

test('a failed revision decision leaves the latest draft intact without appending notes', async () => {
  const pending = deferred<void>();
  artifactDecisionService.record = async () => {
    await pending.promise;
    throw new Error('隔离测试：决定写入失败');
  };
  const { result, refreshed } = renderArtifacts();
  await act(async () => result.current.setDraft('保留原目标'));
  let operation!: Promise<void>;
  await act(async () => {
    operation = result.current.decideArtifact(ARTIFACT, 'request_revision', '仍需保留的修订意见。');
  });
  await act(async () => result.current.setDraft('保留原目标，以及新输入。'));
  await act(async () => {
    pending.resolve();
    await operation;
  });
  assert.equal(result.current.draft, '保留原目标，以及新输入。');
  assert.match(result.current.error, /决定写入失败/);
  assert.deepEqual(refreshed, []);
});

for (const failingRefresh of ['refreshBundle', 'loadConversations'] as const) {
  test(`revision notes remain available after a successful decision but failed ${failingRefresh}`, async () => {
    const { result } = renderArtifacts({
      [failingRefresh]: async () => {
        throw new Error('隔离测试：刷新失败');
      },
    });
    await act(async () => result.current.setDraft('原目标'));
    await act(async () => {
      await result.current.decideArtifact(ARTIFACT, 'request_revision', '已记录的修订意见。');
    });
    assert.equal(
      result.current.draft,
      appendArtifactRevisionDraft(
        '原目标',
        buildArtifactRevisionDraft(ARTIFACT.artifactType, '已记录的修订意见。'),
      ),
    );
    assert.match(result.current.error, /刷新失败/);
  });
}

test('repeating a revision decision does not append identical notes twice', async () => {
  const { result } = renderArtifacts();
  await act(async () => {
    await result.current.decideArtifact(ARTIFACT, 'request_revision', '相同的修订意见。');
  });
  const once = result.current.draft;
  await act(async () => result.current.setDraft(`${once}\n继续输入的内容。`));
  await act(async () => {
    await result.current.decideArtifact(ARTIFACT, 'request_revision', '相同的修订意见。');
  });
  assert.equal(result.current.draft, `${once}\n继续输入的内容。`);
});

for (const firstOutcome of ['success', 'failure'] as const) {
  test(`decisions reject synchronous reentry and unlock the next operation after ${firstOutcome}`, async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const calls: RecordDecisionInput[] = [];
    artifactDecisionService.record = async (input) => {
      calls.push(input);
      await (input.cardId === ARTIFACT.cardId ? first.promise : second.promise);
      if (input.cardId === ARTIFACT.cardId && firstOutcome === 'failure') {
        throw new Error('隔离测试：首个决定失败');
      }
      return { decision: decision(input) };
    };
    const secondArtifact = {
      ...ARTIFACT,
      cardId: 'card-review-2',
      artifactId: 'artifact-review-2',
    };
    const { result } = renderArtifacts();
    let firstOperation!: Promise<void>;
    let secondOperation!: Promise<void>;
    let ignoredOperations!: Array<Promise<void>>;
    await act(async () => {
      firstOperation = result.current.decideArtifact(
        ARTIFACT,
        'request_revision',
        '首个修订意见。',
      );
      ignoredOperations = [
        result.current.decideArtifact(ARTIFACT, 'request_revision', '重复点击不得加入的意见。'),
        result.current.decideArtifact(secondArtifact, 'request_revision', '第二张卡片的修订意见。'),
      ];
    });
    assert.deepEqual(
      calls.map((input) => input.cardId),
      [ARTIFACT.cardId],
    );
    assert.equal(result.current.decisionBusyCardId, ARTIFACT.cardId);
    await act(async () => {
      await Promise.all(ignoredOperations);
      first.resolve();
      await firstOperation;
    });
    assert.equal(result.current.decisionBusyCardId, '');
    assert.doesNotMatch(result.current.draft, /重复点击|第二张卡片/);
    if (firstOutcome === 'failure') {
      assert.equal(result.current.draft, '');
      assert.match(result.current.error, /首个决定失败/);
    } else {
      assert.match(result.current.draft, /首个修订意见/);
    }
    await act(async () => {
      secondOperation = result.current.decideArtifact(
        secondArtifact,
        'request_revision',
        '第二张卡片的修订意见。',
      );
    });
    assert.deepEqual(
      calls.map((input) => input.cardId),
      [ARTIFACT.cardId, secondArtifact.cardId],
    );
    assert.equal(result.current.decisionBusyCardId, secondArtifact.cardId);
    await act(async () => {
      second.resolve();
      await secondOperation;
    });
    assert.equal(result.current.decisionBusyCardId, '');
    assert.match(result.current.draft, /第二张卡片的修订意见/);
  });
}

test('decisions remain locked while post-decision refresh is pending', async () => {
  const refresh = deferred<void>();
  const calls: RecordDecisionInput[] = [];
  artifactDecisionService.record = async (input) => {
    calls.push(input);
    return { decision: decision(input) };
  };
  const { result } = renderArtifacts({ refreshBundle: async () => refresh.promise });
  let operation!: Promise<void>;
  await act(async () => {
    operation = result.current.decideArtifact(ARTIFACT, 'request_revision', '已记录的修订意见。');
  });
  assert.equal(result.current.decisionBusyCardId, ARTIFACT.cardId);
  assert.match(result.current.draft, /已记录的修订意见/);
  await act(async () => {
    await result.current.decideArtifact(
      { ...ARTIFACT, cardId: 'card-review-2', artifactId: 'artifact-review-2' },
      'request_revision',
      '不得抢入的修订意见。',
    );
  });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(result.current.draft, /不得抢入/);
  await act(async () => {
    refresh.resolve();
    await operation;
  });
  assert.equal(result.current.decisionBusyCardId, '');
});
