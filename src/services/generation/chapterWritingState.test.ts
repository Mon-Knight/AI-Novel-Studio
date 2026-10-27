import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '../ai/compilation/canonical';
import { renderActualBeatState, validateActualBeatState } from './chapterWritingState';

const prose = '守卫收起了通行证，只准沈岚徒步进城。沈岚摸着空衣袋，仍不知道接头人的姓名。';

async function payload() {
  const quote = '守卫收起了通行证';
  const start = prose.indexOf(quote);
  const fact = {
    text: '通行证留在守卫手中。',
    epistemic: 'explicit',
    evidence: [{ start, end: start + quote.length, quote }],
  };
  return {
    schemaVersion: 1,
    sourceTextHash: await sha256(prose),
    actualStateChange: [fact],
    endState: fact,
    unknowns: ['接头人的姓名仍未知。'],
    semanticValidation: 'not_checked',
  };
}

test('actual Beat state preserves uncertainty and exact immutable prose evidence', async () => {
  const state = await validateActualBeatState(await payload(), prose);
  assert.equal(state.actualStateChange[0].text, '通行证留在守卫手中。');
  assert.equal(state.sourceTextHash, await sha256(prose));
  assert.match(renderActualBeatState(state), /未采用候选/);
  assert.match(renderActualBeatState(state), /语义一致性未自动证明/);
});

test('planned but unwritten end state is not accepted as actual prose evidence', async () => {
  const value = await payload();
  value.endState.evidence[0].quote = '沈岚持证入住了客栈';
  await assert.rejects(validateActualBeatState(value, prose), /CHAPTER_BEAT_STATE_INVALID/);
});

test('state rejects a different source hash, wrong offsets and false semantic claims', async () => {
  const hashChanged = await payload();
  hashChanged.sourceTextHash = await sha256(prose + '改动');
  await assert.rejects(validateActualBeatState(hashChanged, prose), /哈希不匹配/);
  const offsetsChanged = await payload();
  offsetsChanged.actualStateChange[0].evidence[0].start += 1;
  await assert.rejects(validateActualBeatState(offsetsChanged, prose), /逐字匹配/);
  const semanticClaim = { ...(await payload()), semanticValidation: 'passed' };
  await assert.rejects(validateActualBeatState(semanticClaim, prose), /语义证明/);
});

test('unknown end state stays unknown and is never filled from the plan', async () => {
  const value = { ...(await payload()), actualStateChange: [], endState: null };
  const state = await validateActualBeatState(value, prose);
  assert.equal(state.endState, null);
  assert.match(renderActualBeatState(state), /结束状态未确认/);
  await assert.rejects(validateActualBeatState({ ...value, unknowns: [] }, prose), /说明未知项/);
});

test('every asserted fact needs evidence, while uncertain assertions retain their label', async () => {
  const value = await payload();
  const missing = { ...value, actualStateChange: [{ ...value.endState, evidence: [] }] };
  await assert.rejects(validateActualBeatState(missing, prose), /每项状态事实/);
  const state = await validateActualBeatState(
    { ...value, actualStateChange: [{ ...value.endState, epistemic: 'uncertain' }] },
    prose,
  );
  assert.match(renderActualBeatState(state), /未确认：通行证留在守卫手中/);
});
