import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationTurn, TaskConversationBundle } from '../../types/conversation';
import { encodeArtifactRevisionTurn } from './artifactRevisionSourceCodec';
import { encodeWorkbenchTurnContent } from './workbenchTurnOrigin';
import {
  conflictPeersFromRunningTargets,
  conversationWindowCommand,
  ConversationWindowQueryError,
  cursorAfterWindow,
  mergeConversationWindow,
  runningTaskTargetsCommand,
  sliceConversationWindow,
} from './conversationWindow';
import { findTaskTargetConflict } from './taskGoalRouting';
import {
  groupWorkbenchRounds,
  projectWorkbenchEvents,
  workbenchCandidateNumbers,
} from '../../features/workbench/workbenchPresentation';

const at = '2026-08-20T00:00:01.000Z';

function bundle(roundCount: number, extras?: Partial<TaskConversationBundle>): TaskConversationBundle {
  const turns: ConversationTurn[] = [];
  for (let index = 0; index < roundCount; index += 1) {
    turns.push({
      turnId: `user-${index}`,
      conversationId: 'task',
      sequence: index * 2,
      role: 'user',
      content: `继续写第${index + 1}章`,
      createdAt: at,
    });
    turns.push({
      turnId: `assistant-${index}`,
      conversationId: 'task',
      sequence: index * 2 + 1,
      role: 'assistant',
      content: '候选说明',
      createdAt: at,
    });
  }
  return {
    conversation: {
      conversationId: 'task',
      novelId: 'novel',
      title: '窗口任务',
      status: 'waiting_user',
      createdAt: at,
      updatedAt: at,
    },
    turns,
    runs: [],
    toolEvents: [],
    artifacts: [],
    decisions: [],
    authorizations: [],
    ...extras,
  };
}

test('window invocation rejects mixed cursors and locks the camelCase command', () => {
  assert.throws(
    () =>
      conversationWindowCommand({
        conversationId: 'task',
        beforeUserSequence: 2,
        focusTurnId: 'user-1',
      }),
    (error: unknown) => error instanceof ConversationWindowQueryError,
  );
  assert.throws(
    () => conversationWindowCommand({ conversationId: 'task', minUserSequence: 0, limit: 201 }),
    /200/,
  );
  assert.throws(() => conversationWindowCommand({ conversationId: 'task', limit: 33 }), /32/);
  assert.deepEqual(conversationWindowCommand({ conversationId: ' task ', focusCardId: ' card ' }), {
    command: 'get_task_conversation_window',
    args: { input: { conversationId: 'task', limit: 8, focusCardId: 'card' } },
  });
  assert.deepEqual(runningTaskTargetsCommand(' novel '), {
    command: 'list_running_task_targets',
    args: { input: { novelId: 'novel' } },
  });
});

test('latest page keeps eight user rounds and equal timestamps stay in sequence order', () => {
  const source = bundle(10);
  source.turns.unshift({
    turnId: 'automatic',
    conversationId: 'task',
    sequence: -1,
    role: 'user',
    content: encodeWorkbenchTurnContent('准备资产', 'workbench_asset_preparation'),
    createdAt: at,
  });
  const page = sliceConversationWindow(source, { conversationId: 'task', limit: 8 });
  const rounds = groupWorkbenchRounds(projectWorkbenchEvents(page.bundle));
  assert.equal(rounds.length, 8);
  assert.equal(page.page.hasOlder, true);
  assert.equal(page.page.hasNewer, false);
  assert.equal(page.bundle.turns.some((turn) => turn.turnId === 'automatic'), false);
  const ordered = projectWorkbenchEvents(page.bundle).filter((event) => event.kind === 'turn');
  const sequences = ordered.map((event) => event.turnSequence);
  assert.deepEqual(
    sequences,
    [...sequences].sort((left, right) => left - right),
  );
});

test('refresh cap replaces only the returned span and keeps the earlier card', () => {
  const source = bundle(12);
  source.artifacts = [
    {
      cardId: 'early',
      conversationId: 'task',
      turnId: 'user-0',
      artifactId: 'artifact-early',
      artifactType: 'chapter_text',
      title: '早期候选',
      summary: '保留',
      content: '早期正文',
      status: 'candidate',
      createdAt: at,
      artifactEvidence: {
        sourceNovelId: 'novel',
        processingStatus: 'valid',
        validationIssues: [],
      },
    },
    {
      cardId: 'late',
      conversationId: 'task',
      turnId: 'user-11',
      artifactId: 'artifact-late',
      artifactType: 'chapter_text',
      title: '最新候选',
      summary: '更新',
      content: '',
      status: 'candidate',
      createdAt: at,
    },
  ];
  const loaded = sliceConversationWindow(source, { conversationId: 'task', limit: 32 });
  const first = loaded.page.oldestUserSequence;
  assert.equal(first, 0);
  const capped = sliceConversationWindow(source, {
    conversationId: 'task',
    minUserSequence: first ?? 0,
    limit: 8,
  });
  assert.equal(capped.page.userRoundCount, 8);
  assert.equal(capped.page.hasOlder, true);
  assert.equal(capped.page.hasNewer, false);
  assert.equal(capped.bundle.artifacts.some((card) => card.cardId === 'early'), false);
  const merged = mergeConversationWindow(loaded.bundle, capped.bundle, capped.page);
  assert.equal(merged.artifacts.some((card) => card.cardId === 'early'), true);
  assert.equal(merged.artifacts.find((card) => card.cardId === 'early')?.content, '早期正文');
  assert.equal(merged.turns.some((turn) => turn.turnId === 'user-0'), true);
  assert.equal(merged.turns.some((turn) => turn.turnId === 'user-11'), true);
  const cursor = cursorAfterWindow('task', merged, capped.page, {
    conversationId: 'task',
    oldestUserSequence: 0,
    loadedUserRounds: 12,
    hasOlder: false,
    hasNewer: false,
  }, 'refresh');
  assert.equal(cursor.hasOlder, false);
  assert.equal(cursor.oldestUserSequence, 0);
});

test('an empty older page does not wipe retained rounds', () => {
  const source = bundle(2);
  const latest = sliceConversationWindow(source, { conversationId: 'task', limit: 1 });
  const older = sliceConversationWindow(source, {
    conversationId: 'task',
    beforeUserSequence: 0,
    limit: 8,
  });
  assert.equal(older.page.userRoundCount, 0);
  assert.equal(older.page.startSequence, null);
  const merged = mergeConversationWindow(latest.bundle, older.bundle, older.page);
  assert.equal(merged.turns.length, latest.bundle.turns.length);
  const cursor = cursorAfterWindow('task', merged, older.page, {
    conversationId: 'task',
    oldestUserSequence: latest.page.oldestUserSequence,
    loadedUserRounds: 1,
    hasOlder: true,
    hasNewer: false,
  }, 'older');
  assert.equal(cursor.hasOlder, false);
});

test('a disjoint latest page replaces the parked window instead of leaving a gap', () => {
  const parked = sliceConversationWindow(bundle(24), {
    conversationId: 'task',
    focusTurnId: 'user-2',
    limit: 8,
  });
  const latest = sliceConversationWindow(bundle(24), { conversationId: 'task', limit: 8 });
  assert.equal(parked.page.hasNewer, true);
  assert.equal(latest.page.hasOlder, true);
  const lastParked = parked.bundle.turns[parked.bundle.turns.length - 1];
  assert.ok((latest.page.startSequence ?? 0) > (lastParked?.sequence ?? 0) + 1);
  const merged = mergeConversationWindow(parked.bundle, latest.bundle, latest.page);
  assert.equal(merged.turns.some((turn) => turn.turnId === 'user-2'), false);
  assert.equal(merged.turns.some((turn) => turn.turnId === 'user-23'), true);
  const cursor = cursorAfterWindow('task', merged, latest.page, {
    conversationId: 'task',
    oldestUserSequence: parked.page.oldestUserSequence,
    loadedUserRounds: parked.page.userRoundCount,
    hasOlder: parked.page.hasOlder,
    hasNewer: true,
  }, 'refresh');
  assert.equal(cursor.hasNewer, false);
  assert.equal(cursor.hasOlder, true);
});

test('the same card keeps its conversation ordinal across the first page, older page, focus and refresh', () => {
  const source = bundle(12);
  source.artifacts = [
    {
      cardId: 'early',
      conversationId: 'task',
      turnId: 'user-0',
      artifactType: 'generic',
      title: '早期候选',
      summary: '一',
      content: '早期正文',
      status: 'candidate',
      createdAt: at,
    },
    {
      cardId: 'late',
      conversationId: 'task',
      turnId: 'user-11',
      artifactType: 'generic',
      title: '最新候选',
      summary: '二',
      content: '最新正文',
      status: 'candidate',
      createdAt: at,
    },
  ];
  const full = workbenchCandidateNumbers(projectWorkbenchEvents(source));
  const latest = sliceConversationWindow(source, { conversationId: 'task', limit: 8 });
  const lateCard = latest.bundle.artifacts.find((card) => card.cardId === 'late');
  assert.equal(lateCard?.candidateOrdinal, full.get('late'));
  assert.equal(lateCard?.candidateOrdinal, 2);
  assert.equal(
    workbenchCandidateNumbers(projectWorkbenchEvents(latest.bundle)).get('late'),
    2,
  );
  const older = sliceConversationWindow(source, {
    conversationId: 'task',
    beforeUserSequence: latest.page.oldestUserSequence ?? 0,
    limit: 8,
  });
  const earlyCard = older.bundle.artifacts.find((card) => card.cardId === 'early');
  assert.equal(earlyCard?.candidateOrdinal, full.get('early'));
  assert.equal(earlyCard?.candidateOrdinal, 1);
  const focused = sliceConversationWindow(source, {
    conversationId: 'task',
    focusCardId: 'early',
    limit: 8,
  });
  assert.equal(
    focused.bundle.artifacts.find((card) => card.cardId === 'early')?.candidateOrdinal,
    1,
  );
  const refreshed = sliceConversationWindow(source, {
    conversationId: 'task',
    minUserSequence: 0,
    limit: 8,
  });
  const merged = mergeConversationWindow(
    mergeConversationWindow(latest.bundle, older.bundle, older.page),
    refreshed.bundle,
    refreshed.page,
  );
  assert.equal(merged.artifacts.find((card) => card.cardId === 'early')?.candidateOrdinal, 1);
  assert.equal(merged.artifacts.find((card) => card.cardId === 'late')?.candidateOrdinal, 2);
});

test('conflict peers use the run chapter and goal, never the selected chapter', () => {
  const peers = conflictPeersFromRunningTargets([
    {
      conversationId: 'other',
      novelId: 'novel',
      title: '另一章',
      runId: 'run-other',
      chapterId: 'chapter-2',
      latestGoal: encodeArtifactRevisionTurn('检查本章一致性'),
    },
    {
      conversationId: 'same',
      novelId: 'novel',
      title: '同一章',
      runId: 'run-same',
      chapterId: 'chapter-1',
      latestGoal: '继续写第一章正文',
    },
  ]);
  assert.equal(
    findTaskTargetConflict({
      novelId: 'novel',
      chapterId: 'chapter-1',
      conversationId: 'current',
      goal: '继续写第一章',
      peers,
    })?.peerTitle,
    '同一章',
  );
  assert.equal(peers[0]?.chapterId, 'chapter-2');
  assert.equal(peers.some((peer) => peer.chapterId === 'chapter-1' && peer.conversationId === 'other'), false);
});
