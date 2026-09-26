import assert from 'node:assert/strict';
import test from 'node:test';
import type { TaskConversationBundle, TaskRun } from '../../types/conversation';
import type { ChapterAssetRecovery } from '../../services/conversation/chapterAssetReadiness';
import { encodeWorkbenchTurnContent } from '../../services/conversation/workbenchTurnOrigin';
import {
  completedReadDisclosureKey,
  groupWorkbenchDisplaySegments,
  groupWorkbenchRounds,
  projectWorkbenchEvents,
  presentationWindowStart,
  resolvePreparationCandidate,
  workbenchCandidateNumbers,
} from './workbenchPresentation';
import {
  clearWorkbenchPresentationReading,
  readWorkbenchPresentationReading,
  saveWorkbenchPresentationReading,
  workbenchReadingKey,
} from './workbenchPresentationReading';

const at = (second: number) => new Date(Date.UTC(2026, 8, 10, 0, 0, second)).toISOString();
const model: TaskRun['modelSnapshot'] = {
  providerId: 'mock',
  modelId: 'Mock',
  runtimeMode: 'mock',
  capabilities: [],
  options: {},
  capturedAt: at(0),
};
function replayBundle(): TaskConversationBundle {
  return {
    conversation: {
      conversationId: 'c',
      novelId: 'n',
      title: '公开事实',
      status: 'waiting_user',
      createdAt: at(0),
      updatedAt: at(20),
    },
    turns: [
      {
        turnId: 'u1',
        conversationId: 'c',
        role: 'user',
        sequence: 1,
        content: '第一次要求',
        createdAt: at(0),
      },
      {
        turnId: 'a1',
        conversationId: 'c',
        role: 'assistant',
        runId: 'r1',
        sequence: 2,
        content: '先读取再生成',
        createdAt: at(2),
      },
      {
        turnId: 'u2',
        conversationId: 'c',
        role: 'user',
        sequence: 3,
        content: '后来的要求',
        createdAt: at(10),
      },
      {
        turnId: 'a2',
        conversationId: 'c',
        role: 'assistant',
        runId: 'r2',
        sequence: 4,
        content: '本次重试说明',
        createdAt: at(13),
      },
    ],
    runs: [
      {
        runId: 'r1',
        conversationId: 'c',
        turnId: 'u1',
        status: 'failed',
        modelSnapshot: model,
        workerId: 'w1',
        createdAt: at(1),
        updatedAt: at(8),
        finishedAt: at(8),
        error: 'Provider 独立失败',
      },
      {
        runId: 'r2',
        conversationId: 'c',
        turnId: 'u1',
        status: 'completed',
        modelSnapshot: model,
        workerId: 'w2',
        createdAt: at(12),
        updatedAt: at(16),
        finishedAt: at(16),
      },
    ],
    toolEvents: [
      {
        eventId: 't1',
        runId: 'r1',
        sequence: 1,
        toolName: 'novel.read_context',
        argumentsSummary: {},
        status: 'failed',
        error: '读取失败',
        createdAt: at(3),
        finishedAt: at(4),
      },
      {
        eventId: 't2',
        runId: 'r2',
        sequence: 1,
        toolName: 'generate_chapter',
        argumentsSummary: {},
        status: 'succeeded',
        createdAt: at(14),
        finishedAt: at(15),
      },
    ],
    artifacts: [
      {
        cardId: 'c1',
        conversationId: 'c',
        turnId: 'u1',
        runId: 'r1',
        artifactId: 'artifact1',
        artifactType: 'chapter_text',
        title: '初次候选',
        summary: '',
        status: 'candidate',
        createdAt: at(5),
      },
      {
        cardId: 'local',
        conversationId: 'c',
        artifactId: 'local-artifact',
        artifactType: 'generic_json',
        title: '本地候选',
        summary: '',
        status: 'candidate',
        createdAt: at(11),
      },
      {
        cardId: 'c2',
        conversationId: 'c',
        turnId: 'u1',
        runId: 'r2',
        artifactId: 'artifact2',
        artifactType: 'chapter_text',
        title: '重试候选',
        summary: '',
        status: 'candidate',
        createdAt: at(15),
      },
    ],
  };
}

test('first run and retry interleave only public explanations, tools, errors and candidates by persisted time', () => {
  const bundle = replayBundle();
  const projection = projectWorkbenchEvents(bundle);
  assert.deepEqual(
    projection.map((entry) => entry.id),
    [
      'turn:u1',
      'run:r1',
      'turn:a1',
      'tool:t1',
      'tool-error:t1',
      'artifact:c1',
      'run-error:r1',
      'run-end:r1',
      'turn:u2',
      'artifact:local',
      'run:r2',
      'turn:a2',
      'tool:t2',
      'artifact:c2',
      'run-end:r2',
    ],
  );
  for (const entry of projection.filter((item) => item.runId === 'r2')) {
    assert.equal(entry.attempt, 2);
    assert.equal(entry.conversationId, 'c');
    if (entry.kind !== 'turn') assert.equal(entry.turnId, 'u1');
  }
  assert.equal(projection.filter((entry) => entry.id === 'turn:u1').length, 1);
  assert.equal(projection.find((entry) => entry.id === 'turn:a2')?.turnId, 'a2');
  assert.deepEqual(
    bundle.turns.map((turn) => turn.turnId),
    ['u1', 'a1', 'u2', 'a2'],
  );
});

test('refresh, reordered arrays and repeated snapshots replay identical IDs and attempt ownership', () => {
  const bundle = replayBundle();
  const expected = projectWorkbenchEvents(bundle);
  const shuffled: TaskConversationBundle = JSON.parse(JSON.stringify(bundle));
  shuffled.turns = [...shuffled.turns, shuffled.turns[1]].reverse();
  shuffled.runs = [...shuffled.runs, shuffled.runs[0]].reverse();
  shuffled.toolEvents = [...shuffled.toolEvents, shuffled.toolEvents[0]].reverse();
  shuffled.artifacts = [...shuffled.artifacts, shuffled.artifacts[0]].reverse();
  assert.deepEqual(projectWorkbenchEvents(shuffled), expected);
  shuffled.artifacts[0] = {
    ...shuffled.artifacts[0],
    content: '迟到的正文水合',
    contentLoadError: undefined,
  };
  assert.deepEqual(
    projectWorkbenchEvents(shuffled).map((entry) => entry.id),
    expected.map((entry) => entry.id),
  );
});

test('equal timestamps use deterministic causal tie breaks and shared tool/run error appears once', () => {
  const bundle = replayBundle();
  bundle.runs[0].error = '读取失败';
  bundle.turns[1].createdAt = bundle.runs[0].createdAt;
  const expected = projectWorkbenchEvents(bundle).map((entry) => entry.id);
  assert.ok(expected.indexOf('run:r1') < expected.indexOf('turn:a1'));
  assert.equal(expected.includes('run-error:r1'), false);
  assert.ok(expected.includes('tool-error:t1'));
  bundle.turns.reverse();
  bundle.runs.reverse();
  bundle.toolEvents.reverse();
  bundle.artifacts.reverse();
  assert.deepEqual(
    projectWorkbenchEvents(bundle).map((entry) => entry.id),
    expected,
  );
});

test('complete user-round pagination includes assistants and automatic steps without charging extra slots', () => {
  const bundle = replayBundle();
  bundle.turns.push({
    turnId: 'auto',
    conversationId: 'c',
    role: 'user',
    sequence: 5,
    content: encodeWorkbenchTurnContent('生成主角候选', 'workbench_asset_preparation'),
    createdAt: at(18),
  });
  bundle.turns.unshift({
    turnId: 'welcome',
    conversationId: 'c',
    role: 'assistant',
    sequence: 0,
    content: '欢迎',
    createdAt: at(-1),
  });
  const rounds = groupWorkbenchRounds(projectWorkbenchEvents(bundle));
  assert.deepEqual(
    rounds.map((round) => round.id),
    ['turn:u1', 'turn:u2'],
  );
  assert.ok(rounds[0].events.some((entry) => entry.id === 'turn:a1'));
  assert.ok(rounds[1].events.some((entry) => entry.id === 'turn:auto'));
  assert.ok(rounds[1].events.some((entry) => entry.id === 'run:r2'));
  assert.equal(presentationWindowStart(rounds, null, 1), 1);
  assert.equal(presentationWindowStart(rounds, 'turn:u1', 1), 0);
});

test('compression preview is scoped to this action rather than fixed above historical messages', () => {
  const bundle = replayBundle();
  const metadata = { conversationId: 'c', actionId: 'compress-1', createdAt: at(11.5) };
  const projection = projectWorkbenchEvents(bundle, { compression: metadata });
  const ids = projection.map((entry) => entry.id);
  assert.ok(ids.indexOf('compression:compress-1') > ids.indexOf('turn:u2'));
  assert.ok(ids.indexOf('compression:compress-1') < ids.indexOf('run:r2'));
  assert.equal(
    projectWorkbenchEvents(bundle, { compression: { ...metadata, conversationId: 'other' } }).some(
      (entry) => entry.kind === 'compression',
    ),
    false,
  );
});

test('preparation candidate lookup rejects missing, ambiguous and cross-scope links rather than choosing the newest card', () => {
  const bundle = replayBundle();
  const recovery: ChapterAssetRecovery = {
    conversationId: 'c',
    novelId: 'n',
    originalGoal: '目标',
    missingAssets: ['protagonist'],
    sourceTurnId: 'u1',
    createdAt: at(0),
    checkedAt: at(20),
    orchestration: {
      phase: 'awaiting_apply',
      asset: 'protagonist',
      preparationTurnId: 'u1',
      preparationRunId: 'r1',
      candidateArtifactId: 'artifact1',
      updatedAt: at(6),
    },
  };
  assert.equal(resolvePreparationCandidate(bundle, recovery)?.cardId, 'c1');
  assert.equal(resolvePreparationCandidate(bundle, { ...recovery, novelId: 'other' }), null);
  assert.equal(resolvePreparationCandidate(bundle, { ...recovery, conversationId: 'other' }), null);
  assert.equal(
    resolvePreparationCandidate(bundle, {
      ...recovery,
      orchestration: { ...recovery.orchestration, preparationRunId: 'r2' },
    }),
    null,
  );
  assert.equal(
    resolvePreparationCandidate(bundle, {
      ...recovery,
      orchestration: { ...recovery.orchestration, candidateArtifactId: undefined },
    }),
    null,
  );
  bundle.artifacts.push({ ...bundle.artifacts[0], cardId: 'ambiguous' });
  assert.equal(resolvePreparationCandidate(bundle, recovery), null);
});

test('public projection rejects facts from another conversation or a conflicting source novel', () => {
  const bundle = replayBundle();
  bundle.turns.push({ ...bundle.turns[0], turnId: 'foreign-turn', conversationId: 'other' });
  bundle.runs.push({ ...bundle.runs[0], runId: 'foreign-run', conversationId: 'other' });
  bundle.toolEvents.push({
    ...bundle.toolEvents[0],
    eventId: 'foreign-tool',
    runId: 'foreign-run',
  });
  bundle.artifacts.push({
    ...bundle.artifacts[0],
    cardId: 'foreign-card',
    artifactEvidence: { sourceNovelId: 'other', processingStatus: 'valid', validationIssues: [] },
  });
  assert.equal(
    projectWorkbenchEvents(bundle).some((entry) => entry.id.includes('foreign')),
    false,
  );
});

test('reading cache isolates novel/conversation, restores the loaded boundary, and never stores mutable candidate facts', () => {
  clearWorkbenchPresentationReading();
  const key = workbenchReadingKey('n', 'c');
  const first = readWorkbenchPresentationReading(key);
  assert.equal(first.followLatest, true);
  assert.equal(first.visibleRoundCount, 8);
  const state = {
    ...first,
    firstRoundId: 'turn:u1',
    visibleRoundCount: 16,
    followLatest: false,
    anchor: { eventId: 'artifact:c1', offset: -45 },
    scrollTop: 1234,
    disclosures: { 'completed-read:tool:read-1,tool:read-2': true },
  };
  saveWorkbenchPresentationReading(key, state);
  state.disclosures['completed-read:tool:read-1,tool:read-2'] = false;
  assert.equal(
    readWorkbenchPresentationReading(key).disclosures['completed-read:tool:read-1,tool:read-2'],
    true,
  );
  assert.equal(readWorkbenchPresentationReading(key).anchor?.eventId, 'artifact:c1');
  assert.equal(
    readWorkbenchPresentationReading(workbenchReadingKey('other', 'c')).followLatest,
    true,
  );
  clearWorkbenchPresentationReading();
});

test('display grouping compresses only contiguous successful reads and preserves event IDs', () => {
  const bundle = replayBundle();
  bundle.toolEvents = [
    ...bundle.toolEvents,
    {
      eventId: 'read-1',
      runId: 'r2',
      sequence: 0,
      toolName: 'novel.read_context',
      argumentsSummary: {},
      status: 'succeeded',
      durationMs: 100,
      createdAt: at(12.1),
      finishedAt: at(12.2),
    },
    {
      eventId: 'read-2',
      runId: 'r2',
      sequence: 1,
      toolName: 'structure.read',
      argumentsSummary: {},
      status: 'succeeded',
      durationMs: 120,
      createdAt: at(12.3),
      finishedAt: at(12.4),
    },
    {
      eventId: 'read-warning',
      runId: 'r2',
      sequence: 2,
      toolName: 'memory.search',
      argumentsSummary: {},
      result: { warnings: ['预算未纳入'] },
      status: 'succeeded',
      createdAt: at(12.5),
      finishedAt: at(12.6),
    },
    {
      eventId: 'read-3',
      runId: 'r2',
      sequence: 3,
      toolName: 'context.read',
      argumentsSummary: {},
      status: 'succeeded',
      createdAt: at(12.7),
      finishedAt: at(12.8),
    },
  ];
  const projection = projectWorkbenchEvents(bundle);
  const segments = groupWorkbenchDisplaySegments(projection);
  const ids = segments.flatMap((segment) =>
    segment.kind === 'completed-read'
      ? segment.events.map((entry) => entry.id)
      : [segment.event.id],
  );
  assert.deepEqual(
    ids,
    projection.map((entry) => entry.id),
  );
  const compact = segments.find((segment) => segment.kind === 'completed-read');
  assert.equal(compact?.kind, 'completed-read');
  if (compact?.kind === 'completed-read') {
    assert.deepEqual(
      compact.events.map((entry) => entry.id),
      ['tool:read-1', 'tool:read-2'],
    );
  }
  assert.equal(segments.filter((segment) => segment.kind === 'completed-read').length, 1);
  assert.equal(
    segments.some(
      (segment) => segment.kind === 'event' && segment.event.id === 'tool:read-warning',
    ),
    true,
  );
  assert.equal(
    segments.some((segment) => segment.kind === 'event' && segment.event.id === 'tool:read-3'),
    true,
  );
  assert.equal(
    completedReadDisclosureKey(['tool:read-1', 'tool:read-2']),
    'completed-read:tool:read-1,tool:read-2',
  );
});

test('grouping never folds activity, failure, generation, unknown receipt, coverage gaps or another run', () => {
  const bundle = replayBundle();
  bundle.toolEvents = [
    {
      eventId: 'ok-a',
      runId: 'r2',
      sequence: 1,
      toolName: 'novel.read_context',
      argumentsSummary: {},
      status: 'succeeded',
      createdAt: at(12.1),
      finishedAt: at(12.2),
    },
    {
      eventId: 'running-read',
      runId: 'r2',
      sequence: 2,
      toolName: 'structure.read',
      argumentsSummary: {},
      status: 'running',
      createdAt: at(12.3),
    },
    {
      eventId: 'ok-b',
      runId: 'r2',
      sequence: 3,
      toolName: 'context.read',
      argumentsSummary: {},
      status: 'succeeded',
      createdAt: at(12.4),
      finishedAt: at(12.5),
    },
    {
      eventId: 'failed-read',
      runId: 'r2',
      sequence: 4,
      toolName: 'memory.search',
      argumentsSummary: {},
      status: 'failed',
      error: '检索失败',
      createdAt: at(12.6),
      finishedAt: at(12.7),
    },
    {
      eventId: 'generate',
      runId: 'r2',
      sequence: 5,
      toolName: 'generate_chapter',
      argumentsSummary: {},
      status: 'succeeded',
      createdAt: at(12.8),
      finishedAt: at(12.9),
    },
    {
      eventId: 'unknown-receipt',
      runId: 'r2',
      sequence: 6,
      toolName: 'novel.read',
      argumentsSummary: {},
      result: { contextReceipt: { evidence: 'unavailable' } },
      status: 'succeeded',
      createdAt: at(13.1),
      finishedAt: at(13.2),
    },
    {
      eventId: 'coverage-gap',
      runId: 'r2',
      sequence: 7,
      toolName: 'structure.read',
      argumentsSummary: {},
      result: { generationContext: { incomplete: true } },
      status: 'succeeded',
      createdAt: at(13.3),
      finishedAt: at(13.4),
    },
    {
      eventId: 'other-run',
      runId: 'r1',
      sequence: 8,
      toolName: 'context.read',
      argumentsSummary: {},
      status: 'succeeded',
      createdAt: at(13.5),
      finishedAt: at(13.6),
    },
  ];
  const segments = groupWorkbenchDisplaySegments(projectWorkbenchEvents(bundle));
  assert.equal(
    segments.some((segment) => segment.kind === 'completed-read'),
    false,
  );
  const ids = segments.flatMap((segment) =>
    segment.kind === 'completed-read'
      ? segment.events.map((entry) => entry.id)
      : [segment.event.id],
  );
  assert.ok(ids.includes('tool:running-read'));
  assert.ok(ids.includes('tool:failed-read'));
  assert.ok(ids.includes('tool-error:failed-read'));
  assert.ok(ids.includes('tool:generate'));
  assert.ok(ids.includes('tool:unknown-receipt'));
  assert.ok(ids.includes('tool:coverage-gap'));
  assert.ok(ids.includes('tool:other-run'));
});

test('candidate numbers stay stable across shuffled replay of the complete set', () => {
  const bundle = replayBundle();
  const expected = [...workbenchCandidateNumbers(projectWorkbenchEvents(bundle)).entries()];
  const shuffled: TaskConversationBundle = JSON.parse(JSON.stringify(bundle));
  shuffled.artifacts = [...shuffled.artifacts].reverse();
  shuffled.turns = [...shuffled.turns].reverse();
  shuffled.runs = [...shuffled.runs].reverse();
  assert.deepEqual(
    [...workbenchCandidateNumbers(projectWorkbenchEvents(shuffled)).entries()],
    expected,
  );
  assert.equal(expected.find(([cardId]) => cardId === 'c1')?.[1], 1);
  assert.equal(expected.find(([cardId]) => cardId === 'c2')?.[1], 3);
});
