import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationArtifactCard } from '../../types/conversation';
import {
  settleStructuredArtifactDecision,
  type StructuredArtifactDecisionInput,
} from './structuredArtifactDecisionSettlement';

function createInput(
  overrides: {
    artifact?: Partial<ConversationArtifactCard>;
    decision?: StructuredArtifactDecisionInput['decision'];
    applied?: boolean;
  } = {},
): StructuredArtifactDecisionInput {
  return {
    artifact: {
      cardId: 'card-1',
      conversationId: 'conversation-1',
      artifactId: 'artifact-1',
      artifactType: 'setting_candidates',
      title: '设定候选',
      summary: '候选摘要',
      status: 'candidate',
      createdAt: '2026-09-01T00:00:00.000Z',
      ...overrides.artifact,
    } as ConversationArtifactCard,
    decision: overrides.decision ?? 'request_apply',
    applied: overrides.applied ?? true,
  };
}

type SettlementInput = Parameters<typeof settleStructuredArtifactDecision>[0];

function createHarness(input: StructuredArtifactDecisionInput) {
  const calls: string[] = [];
  const settled: unknown[] = [];
  const selectedNovelRef = { current: 'novel-1' };
  const selectedConversationRef = { current: input.artifact.conversationId };
  const value: SettlementInput = {
    ...input,
    selectedNovelId: 'novel-1',
    selectedConversationRef,
    selectedNovelRef,
    reloadChapters: async (): Promise<{ chapterId?: string } | null> => {
      calls.push('reload');
      return { chapterId: 'chapter-2' };
    },
    selectChapter: async (chapterId: string) => {
      calls.push(`select:${chapterId}`);
    },
    settleAssetCandidateDecision: async (settlement: unknown) => {
      calls.push('settle');
      settled.push(settlement);
    },
  };
  return {
    calls,
    settled,
    selectedNovelRef,
    selectedConversationRef,
    value,
  };
}

test('skips settlement when the artifact has no id', async () => {
  const harness = createHarness(createInput({ artifact: { artifactId: undefined } }));

  await settleStructuredArtifactDecision(harness.value);

  assert.deepEqual(harness.calls, []);
  assert.deepEqual(harness.settled, []);
});

test('settles a non-applied decision without refreshing or selecting a chapter', async () => {
  const harness = createHarness(createInput({ applied: false, decision: 'reject' }));

  await settleStructuredArtifactDecision(harness.value);

  assert.deepEqual(harness.calls, ['settle']);
  assert.deepEqual(harness.settled, [
    {
      conversationId: 'conversation-1',
      artifactId: 'artifact-1',
      decision: 'reject',
      applied: false,
      selectedChapterId: undefined,
    },
  ]);
});

test('refreshes, selects, then settles an applied decision in the current scope', async () => {
  const harness = createHarness(createInput());

  await settleStructuredArtifactDecision(harness.value);

  assert.deepEqual(harness.calls, ['reload', 'select:chapter-2', 'settle']);
  assert.equal(
    (harness.settled[0] as { selectedChapterId?: string }).selectedChapterId,
    'chapter-2',
  );
});

test('settles without refreshing when the conversation scope is stale', async () => {
  const harness = createHarness(createInput());
  harness.selectedConversationRef.current = 'conversation-2';

  await settleStructuredArtifactDecision(harness.value);

  assert.deepEqual(harness.calls, ['settle']);
  assert.equal((harness.settled[0] as { selectedChapterId?: string }).selectedChapterId, undefined);
});

test('does not select a chapter if the scope changes while chapters reload', async () => {
  const harness = createHarness(createInput());
  harness.value.reloadChapters = async (): Promise<{ chapterId?: string } | null> => {
    harness.calls.push('reload');
    harness.selectedNovelRef.current = 'novel-2';
    return { chapterId: 'chapter-2' };
  };

  await settleStructuredArtifactDecision(harness.value);

  assert.deepEqual(harness.calls, ['reload', 'settle']);
  assert.equal(
    (harness.settled[0] as { selectedChapterId?: string }).selectedChapterId,
    'chapter-2',
  );
});

test('settles an applied decision when chapter reload returns no chapter', async () => {
  const harness = createHarness(createInput());
  harness.value.reloadChapters = async () => {
    harness.calls.push('reload');
    return null;
  };

  await settleStructuredArtifactDecision(harness.value);

  assert.deepEqual(harness.calls, ['reload', 'settle']);
  assert.equal((harness.settled[0] as { selectedChapterId?: string }).selectedChapterId, undefined);
});
