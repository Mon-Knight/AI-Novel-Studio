import assert from 'node:assert/strict';
import test from 'node:test';
import { workflowFixture } from '../../test/chapter-writing/workflowFixture';
import { sha256 } from '../ai/compilation/canonical';
import { runChapterWritingWorkflow } from './chapterWritingWorkflow';

test('Scene 2 Beats are planned only after Scene 1 actual state and scene close', async () => {
  const fixture = await workflowFixture();
  const result = await runChapterWritingWorkflow(fixture.input, fixture.ports);
  const secondPlan = fixture.events.indexOf('beat-plan:scene-2');
  const firstState = fixture.events.findIndex((item) => item.startsWith('state:守卫扣下'));
  assert.ok(secondPlan > firstState && firstState > fixture.events.indexOf('write:scene-1'));
  assert.match(fixture.entries[1], /守卫扣下了通行证/);
  assert.doesNotMatch(fixture.entries[1], /计划假结果|持证入住/);
  assert.equal(result.checkpoint.scenes.length, 2);
  assert.equal(result.checkpoint.status, 'completed');
  assert.equal(result.checkpoint.assembledTextHash, await sha256(result.text));
  assert.equal(fixture.controls.writeCount, 2);
  assert.equal(fixture.checkpoint.callsUsed, 7);
});

test('state extraction failure retains accepted prose; explicit retry does not call Writer twice', async () => {
  const fixture = await workflowFixture();
  fixture.controls.failState = 1;
  await assert.rejects(runChapterWritingWorkflow(fixture.input, fixture.ports), /状态服务暂时失败/);
  assert.equal(fixture.checkpoint.status, 'waiting_retry');
  assert.equal(fixture.checkpoint.prose.length, 1);
  assert.equal(fixture.checkpoint.prose[0].actualState, undefined);
  assert.equal(fixture.events.includes('beat-plan:scene-2'), false);
  const before = fixture.controls.writeCount;
  await assert.rejects(
    runChapterWritingWorkflow(fixture.input, fixture.ports),
    /CHAPTER_WORKFLOW_RESUME_REQUIRED/,
  );
  assert.equal(fixture.controls.writeCount, before);
  const result = await runChapterWritingWorkflow(
    { ...fixture.input, authorizeResume: true, attemptId: 'attempt-2' },
    fixture.ports,
  );
  assert.equal(result.checkpoint.status, 'completed');
  assert.equal(fixture.events.filter((item) => item === 'write:scene-1').length, 1);
  assert.equal(fixture.events.filter((item) => item === 'scene-plan').length, 1);
  assert.equal(result.checkpoint.attemptHistory.length, 1);
  assert.equal(result.checkpoint.attemptHistory[0].callsUsed, 4);
});

test('optional undefined plan fields survive JSON persistence and replay without hash drift', async () => {
  const fixture = await workflowFixture();
  const original = fixture.ports.planScenes;
  fixture.ports.planScenes = async (input) => {
    const plan = await original(input);
    plan.scenes[0].constraints = undefined;
    return plan;
  };
  const first = await runChapterWritingWorkflow(fixture.input, fixture.ports);
  const second = await runChapterWritingWorkflow(fixture.input, fixture.ports);
  assert.equal(second.text, first.text);
  assert.equal(fixture.events.filter((item) => item === 'scene-plan').length, 1);
});

test('completed replay revalidates hashes and chapter without spending another model call', async () => {
  const fixture = await workflowFixture();
  const first = await runChapterWritingWorkflow(fixture.input, fixture.ports);
  const calls = fixture.controls.writeCount + fixture.controls.extractCount;
  const second = await runChapterWritingWorkflow(fixture.input, fixture.ports);
  assert.equal(first.text, second.text);
  assert.equal(fixture.controls.writeCount + fixture.controls.extractCount, calls);
  assert.equal(fixture.events.filter((item) => item === 'chapter-validation').length, 2);
});

test('tampered persisted prose and changed frozen request both fail before new Provider work', async () => {
  const fixture = await workflowFixture();
  await runChapterWritingWorkflow(fixture.input, fixture.ports);
  const valid = structuredClone(fixture.checkpoint);
  const changed = structuredClone(valid);
  changed.prose[0].text += '并且重新拿回了证件。';
  fixture.replaceCheckpoint(changed);
  const writes = fixture.controls.writeCount;
  await assert.rejects(
    runChapterWritingWorkflow(fixture.input, fixture.ports),
    /CHAPTER_WORKFLOW_CHECKPOINT_INVALID/,
  );
  assert.equal(fixture.controls.writeCount, writes);
  fixture.replaceCheckpoint(valid);
  await assert.rejects(
    runChapterWritingWorkflow({ ...fixture.input, targetCharacters: 1600 }, fixture.ports),
    /CHAPTER_WORKFLOW_BASELINE_MISMATCH/,
  );
  await assert.rejects(
    runChapterWritingWorkflow(
      { ...fixture.input, chapterConstraints: ['另一个指令'] },
      fixture.ports,
    ),
    /CHAPTER_WORKFLOW_BASELINE_MISMATCH/,
  );
  await assert.rejects(
    runChapterWritingWorkflow(
      {
        ...fixture.input,
        identity: { ...fixture.input.identity, modelSnapshotHash: await sha256('another model') },
      },
      fixture.ports,
    ),
    /CHAPTER_WORKFLOW_BASELINE_MISMATCH/,
  );
  assert.equal(fixture.controls.writeCount, writes);
});

test('cancelled late Writer result is not accepted and cannot start the next Scene', async () => {
  const fixture = await workflowFixture();
  const controller = new AbortController();
  fixture.controls.abortWriter = controller;
  await assert.rejects(
    runChapterWritingWorkflow({ ...fixture.input, signal: controller.signal }, fixture.ports),
    /AI_REQUEST_CANCELLED/,
  );
  assert.equal(fixture.checkpoint.status, 'cancelled');
  assert.equal(fixture.checkpoint.prose.length, 0);
  assert.equal(fixture.checkpoint.scenes.length, 0);
  assert.equal(fixture.events.includes('beat-plan:scene-2'), false);
  assert.equal(
    fixture.checkpoint.stages.find((item) => item.kind === 'beat_write')?.status,
    'cancelled',
  );
});

test('logical call and deadline budgets stop dispatch or refuse late results', async () => {
  const limited = await workflowFixture();
  limited.input.budget.maxCalls = 2;
  await assert.rejects(
    runChapterWritingWorkflow(limited.input, limited.ports),
    /CHAPTER_WORKFLOW_CALL_BUDGET_EXCEEDED/,
  );
  assert.equal(limited.controls.writeCount, 0);
  assert.equal(limited.checkpoint.errorCode, 'CHAPTER_WORKFLOW_CALL_BUDGET_EXCEEDED');
  const expired = await workflowFixture();
  expired.controls.writerDelay = 480_001;
  await assert.rejects(
    runChapterWritingWorkflow(expired.input, expired.ports),
    /CHAPTER_WORKFLOW_DEADLINE_EXCEEDED/,
  );
  assert.equal(expired.checkpoint.prose.length, 0);
  assert.equal(expired.checkpoint.status, 'waiting_retry');
});

test('lost save acknowledgement keeps the Scene plan and hash atomically reusable', async () => {
  const fixture = await workflowFixture();
  const originalSave = fixture.ports.save;
  let outage = false;
  let injected = false;
  fixture.ports.save = async (next, expected) => {
    if (outage) throw new Error('STORE_OFFLINE');
    await originalSave(next, expected);
    if (!injected && next.scenePlan) {
      injected = true;
      outage = true;
      throw new Error('SAVE_ACK_LOST');
    }
  };
  await assert.rejects(
    runChapterWritingWorkflow(fixture.input, fixture.ports),
    /STORE_OFFLINE|SAVE_ACK_LOST/,
  );
  assert.ok(fixture.checkpoint.scenePlanHash);
  assert.equal(fixture.checkpoint.status, 'running');
  fixture.ports.save = originalSave;
  const resumed = await runChapterWritingWorkflow(
    { ...fixture.input, authorizeResume: true, attemptId: 'attempt-2' },
    fixture.ports,
  );
  assert.equal(resumed.checkpoint.status, 'completed');
  assert.equal(fixture.events.filter((item) => item === 'scene-plan').length, 1);
  assert.equal(resumed.checkpoint.attemptHistory[0].status, 'interrupted');
});

test('clock rollback cannot extend the frozen attempt deadline', async () => {
  const fixture = await workflowFixture();
  fixture.controls.writerDelay = -1;
  await assert.rejects(
    runChapterWritingWorkflow(fixture.input, fixture.ports),
    /CHAPTER_WORKFLOW_CLOCK_CHANGED/,
  );
  assert.equal(fixture.checkpoint.prose.length, 0);
});

test('invalid Beat prose gets at most one complete rewrite; transport failures are not replayed', async () => {
  const fixture = await workflowFixture();
  fixture.controls.rejectBeat = 2;
  await assert.rejects(
    runChapterWritingWorkflow(fixture.input, fixture.ports),
    /CHAPTER_BEAT_TEXT_REJECTED/,
  );
  assert.equal(fixture.controls.writeCount, 2);
  assert.equal(fixture.checkpoint.prose.length, 0);
  assert.equal(fixture.checkpoint.stages.filter((item) => item.kind === 'beat_write').length, 2);
  const failed = await workflowFixture();
  let writes = 0;
  failed.ports.writeBeat = async () => {
    writes += 1;
    throw new Error('UPSTREAM_UNAVAILABLE');
  };
  await assert.rejects(
    runChapterWritingWorkflow(failed.input, failed.ports),
    /UPSTREAM_UNAVAILABLE/,
  );
  assert.equal(writes, 1);
});

test('Scene-only version, plan sources, and actual state quotes are checked before advancing', async () => {
  const old = await workflowFixture();
  const originalPlanner = old.ports.planScenes;
  old.ports.planScenes = async (input) => {
    const result = await originalPlanner(input);
    delete result.scenes[0].planVersion;
    return result;
  };
  await assert.rejects(
    runChapterWritingWorkflow(old.input, old.ports),
    /CHAPTER_WORKFLOW_PLAN_INVALID/,
  );
  assert.equal(old.controls.writeCount, 0);
  const wrongPlan = await workflowFixture();
  const beatPlanner = wrongPlan.ports.planBeats;
  wrongPlan.ports.planBeats = async (input) => ({
    ...(await beatPlanner(input)),
    previousTextHash: '0'.repeat(64),
  });
  await assert.rejects(
    runChapterWritingWorkflow(wrongPlan.input, wrongPlan.ports),
    /CHAPTER_WORKFLOW_BEAT_PLAN_INVALID/,
  );
  assert.equal(wrongPlan.controls.writeCount, 0);
  const wrongState = await workflowFixture();
  const extractor = wrongState.ports.extractState;
  wrongState.ports.extractState = async (input) => ({
    ...((await extractor(input)) as object),
    sourceTextHash: '0'.repeat(64),
  });
  await assert.rejects(
    runChapterWritingWorkflow(wrongState.input, wrongState.ports),
    /CHAPTER_BEAT_STATE_INVALID/,
  );
  assert.equal(wrongState.events.includes('beat-plan:scene-2'), false);
});
