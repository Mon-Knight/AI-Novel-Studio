import assert from 'node:assert/strict';
import test from 'node:test';
import type { SanitizedConversationEvidence } from './production-app-helpers';
import { inspectWritingFaultRuns } from './writing-subagent-fault-evidence';

type Run = SanitizedConversationEvidence['runs'][number];
type Event = SanitizedConversationEvidence['toolEvents'][number];
const run = (runId: string, status = 'completed'): Run => ({
  runId,
  status,
  chapterId: 'chapter',
  providerId: 'fixture-api',
  modelId: 'fixture-model',
  runtimeMode: 'api',
  error: status === 'failed' ? 'preserved failure' : null,
});
const event = (runId: string, toolName: string, status = 'succeeded'): Event => ({
  runId,
  toolName,
  status,
  durationMs: null,
  error: null,
});
function evidence(): SanitizedConversationEvidence {
  return {
    conversationStatus: 'waiting_user',
    runs: [run('plan'), run('failed-write', 'failed'), run('retry-write')],
    toolEvents: [
      event('plan', 'novel.read_context'),
      event('plan', 'creative.plan_action'),
      event('plan', 'dsh.session.completed'),
      event('retry-write', 'generate_chapter'),
    ],
    artifacts: [{ runId: 'retry-write', artifactType: 'chapter_text', status: 'candidate' }],
    runtimeProjectionEvents: [],
    turns: [],
    decisionCount: 0,
  };
}

test('a completed request-only planner is separate from failed and successful writing runs', () => {
  const result = inspectWritingFaultRuns(evidence(), 2);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(
    result.planningRuns.map((item) => item.runId),
    ['plan'],
  );
  assert.deepEqual(
    result.writingRuns.map((item) => item.runId),
    ['failed-write', 'retry-write'],
  );
  assert.equal(result.writingRuns[0].error, 'preserved failure');
});

test('unknown completed runs cannot disappear as planners and extra plans fail the exact count', () => {
  const unknown = evidence();
  unknown.runs.splice(1, 0, run('unknown'));
  assert.match(inspectWritingFaultRuns(unknown, 2).failures.join(), /found 3/u);
  const duplicate = evidence();
  duplicate.runs.splice(1, 0, run('second-plan'));
  duplicate.toolEvents.push(event('second-plan', 'creative.plan_action'));
  assert.match(inspectWritingFaultRuns(duplicate, 2).failures.join(), /planning run, found 2/u);
});

test('failed or active planning runs and failed planning tools are not ignored', () => {
  for (const status of ['failed', 'running']) {
    const input = evidence();
    input.runs[0].status = status;
    const result = inspectWritingFaultRuns(input, 2);
    assert.equal(result.planningRuns.length, 0);
    assert.match(result.failures.join(), /planning run failed/u);
  }
  const input = evidence();
  input.toolEvents.find((item) => item.toolName === 'creative.plan_action')!.status = 'failed';
  assert.ok(inspectWritingFaultRuns(input, 2).failures.length > 0);
});

test('candidate calls or artifacts make a planning run ineligible even when a tool failed', () => {
  for (const status of ['succeeded', 'failed']) {
    const input = evidence();
    input.toolEvents.push(event('plan', 'generate_chapter', status));
    assert.equal(inspectWritingFaultRuns(input, 2).planningRuns.length, 0);
  }
  const input = evidence();
  input.artifacts.push({ runId: 'plan', artifactType: 'chapter_text' });
  assert.equal(inspectWritingFaultRuns(input, 2).planningRuns.length, 0);
});

test('unowned artifacts and tool events fail evidence classification', () => {
  const input = evidence();
  input.artifacts[0].runId = null;
  input.toolEvents.push(event('missing-run', 'generate_chapter'));
  const errors = inspectWritingFaultRuns(input, 2).failures.join();
  assert.match(errors, /artifact has no verified owning run/u);
  assert.match(errors, /tool event has no verified owning run/u);
});

test('only the identified completed local command without tools or artifacts is excluded', () => {
  const input = evidence();
  input.runs.unshift({ ...run('local'), providerId: 'ans-local', runtimeMode: 'local' });
  assert.deepEqual(inspectWritingFaultRuns(input, 2, ['local']).failures, []);
  assert.match(inspectWritingFaultRuns(input, 2).failures.join(), /found 3/u);
  input.toolEvents.push(event('local', 'generate_chapter'));
  assert.match(inspectWritingFaultRuns(input, 2, ['local']).failures.join(), /local command/u);
  assert.match(inspectWritingFaultRuns(evidence(), 2, ['missing']).failures.join(), /missing/u);
});

test('failed forbidden calls stay visible but a successful writer tool outside its roster fails', () => {
  const input = evidence();
  input.toolEvents.push(event('failed-write', 'expand_settings', 'failed'));
  assert.deepEqual(inspectWritingFaultRuns(input, 2).failures, []);
  input.toolEvents.at(-1)!.status = 'succeeded';
  assert.match(inspectWritingFaultRuns(input, 2).failures.join(), /outside its allowlist/u);
});

test('planning must precede writing and run ids must remain unique', () => {
  const input = evidence();
  [input.runs[0], input.runs[1]] = [input.runs[1], input.runs[0]];
  assert.match(inspectWritingFaultRuns(input, 2).failures.join(), /preceded/u);
  input.runs.push(input.runs[2]);
  assert.match(inspectWritingFaultRuns(input, 2).failures.join(), /duplicate run ids/u);
});
