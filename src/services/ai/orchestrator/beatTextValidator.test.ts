import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GENERIC_COVERAGE_ACTIONS,
  actionOccurrences,
  actionStatusAt,
  beatCovered,
  beatRequiresCompletedAction,
  externalRepairBeatCovered,
  lexicalEvidenceCount,
  lexicalTerms,
  meaningfulTerms,
  mergeSceneContinuation,
  missingBeatClauses,
  normalizeBeatCoverageText,
  normalizedParagraphs,
  normalizedTextWithRawEnds,
  pendingSceneBeats,
  requiredCompletedActions,
  semanticBeatClauses,
  stateAnchorTerms,
  statusSatisfies,
  trimNormalizedBoundaryOverlap,
  validateBeatNovelty,
  validateSceneContinuity,
  validateSceneRepetition,
  validateSceneText,
} from './beatTextValidator';
import type { OrchestratedScene } from './types';

function family(id: string) {
  const found = GENERIC_COVERAGE_ACTIONS.find((action) => action.id === id);
  assert.ok(found, `missing coverage family: ${id}`);
  return found;
}

function scene(overrides: Partial<OrchestratedScene> = {}): OrchestratedScene {
  return {
    sceneNo: 1,
    title: '场景',
    location: '检查室',
    characters: ['他'],
    goal: '目标',
    conflict: '冲突',
    beats: [],
    result: '',
    transition: '',
    contextCapsule: '',
    constraints: [],
    expectedEndState: '',
    targetCharacters: undefined,
    ...overrides,
  };
}

test('meaningfulTerms slides a window over Chinese runs and keeps long ASCII tokens', () => {
  assert.deepEqual(meaningfulTerms('走进检查室'), ['走进检', '进检查', '检查室']);
  assert.deepEqual(meaningfulTerms('门口'), ['门口']);
  assert.deepEqual(meaningfulTerms('abc de fghi'), ['abc', 'fghi']);
});

test('meaningfulTerms deduplicates repeated windows and honours the window size', () => {
  assert.deepEqual(meaningfulTerms('好好好好'), ['好好好']);
  assert.deepEqual(meaningfulTerms('检查室', 2), ['检查', '查室']);
});

test('semanticBeatClauses splits on punctuation and drops fragments under four characters', () => {
  assert.deepEqual(semanticBeatClauses('他走进房间，她发现了线索。'), [
    '他走进房间',
    '她发现了线索',
  ]);
  assert.deepEqual(semanticBeatClauses('好，他走进了检查室'), ['他走进了检查室']);
  assert.deepEqual(semanticBeatClauses('“他走进房间”'), ['他走进房间']);
  assert.deepEqual(semanticBeatClauses('好。坏。'), []);
});

test('normalizeBeatCoverageText strips whitespace and quotes and lowercases', () => {
  assert.equal(normalizeBeatCoverageText(' Hello “世界” '), 'hello世界');
  assert.equal(normalizeBeatCoverageText('他 走 进\n房间'), '他走进房间');
});

test('actionStatusAt reports actual, negated and prospective status from the local context', () => {
  const actual = '他进入房间';
  assert.equal(actionStatusAt(actual, actual.indexOf('进入')), 'actual');

  const negated = '他没有进入房间';
  assert.equal(actionStatusAt(negated, negated.indexOf('进入')), 'negated');

  const prospective = '他打算进入房间';
  assert.equal(actionStatusAt(prospective, prospective.indexOf('进入')), 'prospective');
});

test('actionStatusAt treats a negated suffix as negated and stops at sentence boundaries', () => {
  const suffix = '调查失败了';
  assert.equal(actionStatusAt(suffix, suffix.indexOf('失败')), 'negated');

  // The negation belongs to the previous sentence, so it must not leak across the boundary.
  const reset = '他没有回来。他进入房间';
  assert.equal(actionStatusAt(reset, reset.indexOf('进入')), 'actual');
});

test('statusSatisfies enforces the required status matrix', () => {
  assert.equal(statusSatisfies('negated', 'negated'), true);
  assert.equal(statusSatisfies('negated', 'actual'), false);
  assert.equal(statusSatisfies('prospective', 'actual'), true);
  assert.equal(statusSatisfies('prospective', 'prospective'), true);
  assert.equal(statusSatisfies('prospective', 'negated'), false);
  assert.equal(statusSatisfies('actual', 'actual'), true);
  assert.equal(statusSatisfies('actual', 'prospective'), false);
});

test('actionOccurrences finds bare single-character entry but skips 进行-style compounds', () => {
  const enter = family('enter');
  assert.ok(actionOccurrences(normalizeBeatCoverageText('他进屋'), enter).length > 0);
  assert.equal(actionOccurrences(normalizeBeatCoverageText('他进行检查'), enter).length, 0);
});

test('actionOccurrences recognises contextual disguise phrasing', () => {
  const disguise = family('disguise');
  assert.ok(actionOccurrences(normalizeBeatCoverageText('他以患者身份挂号'), disguise).length > 0);
  assert.equal(actionOccurrences(normalizeBeatCoverageText('他坐在椅子上'), disguise).length, 0);
});

test('requiredCompletedActions only demands the terminal planned action', () => {
  assert.deepEqual(
    requiredCompletedActions('他打算进入检查室').map((item) => item.id),
    ['enter'],
  );
  assert.equal(beatRequiresCompletedAction('他打算进入检查室'), true);

  // Already completed actions are not "planned", so nothing extra is required.
  assert.deepEqual(requiredCompletedActions('他进入检查室'), []);
  assert.equal(beatRequiresCompletedAction('他进入检查室'), false);
});

test('requiredCompletedActions excludes observation-style families', () => {
  assert.deepEqual(requiredCompletedActions('他打算发现线索'), []);
  assert.equal(beatRequiresCompletedAction('他打算发现线索'), false);
});

test('lexicalTerms drops generic function bigrams', () => {
  assert.deepEqual(lexicalTerms('他的房间'), ['的房', '房间']);
  assert.equal(lexicalEvidenceCount('房间', '他走进房间'), 1);
  assert.equal(lexicalEvidenceCount('房间', '他站在门外'), 0);
});

test('trimNormalizedBoundaryOverlap only trims overlaps of at least twelve characters', () => {
  const existing = '一二三四五六七八九十甲乙';
  const trimmed = trimNormalizedBoundaryOverlap(existing, `${existing}丙丁`);
  assert.equal(trimmed.overlap, 12);
  assert.equal(trimmed.text, '丙丁');

  const short = trimNormalizedBoundaryOverlap('一二三四五', '一二三四五六');
  assert.equal(short.overlap, 0);
  assert.equal(short.text, '一二三四五六');

  const none = trimNormalizedBoundaryOverlap('abc', 'xyz');
  assert.equal(none.overlap, 0);
  assert.equal(none.text, 'xyz');
});

test('normalizedParagraphs and normalizedTextWithRawEnds keep raw offsets addressable', () => {
  const paragraphs = normalizedParagraphs('第一段\n\n第二段');
  assert.deepEqual(
    paragraphs.map((paragraph) => paragraph.normalized),
    ['第一段', '第二段'],
  );

  assert.deepEqual(normalizedParagraphs('第 一 段')[0], { raw: '第 一 段', normalized: '第一段' });
  assert.deepEqual(normalizedTextWithRawEnds('a b'), { normalized: 'ab', rawEnds: [1, 3] });
});

test('validateSceneRepetition rejects a long paragraph repeated three times', () => {
  const paragraph = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯';
  assert.equal(paragraph.length, 24);
  assert.throws(
    () => validateSceneRepetition([paragraph, paragraph, paragraph].join('\n\n'), 3),
    /Scene 3 出现大段循环重复/u,
  );
});

test('validateSceneRepetition accepts a single repeat below the duplicate budget', () => {
  const paragraph = '一二三四五六七八九十甲乙丙丁戊己庚辛壬癸子丑寅卯';
  assert.doesNotThrow(() => validateSceneRepetition([paragraph, paragraph].join('\n\n'), 3));
});

test('validateBeatNovelty rejects wholesale reuse of the accepted prefix', () => {
  const paragraph = '甲乙丙丁戊己庚辛壬癸'.repeat(20);
  assert.throws(
    () => validateBeatNovelty(paragraph, paragraph, 2, 4),
    /Scene 2 \/ Beat 4 大面积重复已接受的前文/u,
  );
});

test('validateBeatNovelty ignores an empty prefix and small overlaps', () => {
  const paragraph = '甲乙丙丁戊己庚辛壬癸'.repeat(20);
  assert.doesNotThrow(() => validateBeatNovelty('', paragraph, 2, 4));
  assert.doesNotThrow(() => validateBeatNovelty('甲乙丙丁戊己庚辛壬癸', paragraph, 2, 4));
});

test('validateSceneText rejects empty prose, leaked reasoning and truncated output', () => {
  const bare = scene({ sceneNo: 5, beats: [] });
  assert.throws(() => validateSceneText('   ', bare), /Scene 5 返回空正文/u);
  assert.throws(
    () => validateSceneText('<think>推理</think>正文', bare),
    /Scene 5 返回了思考过程/u,
  );
  assert.throws(
    () => validateSceneText('他推开门，走进检查室。', bare, 'length'),
    /Scene 5 在输出上限处截断/u,
  );
});

test('validateSceneText rejects outline leakage, copied beat lines and early end markers', () => {
  const bare = scene({ sceneNo: 6, beats: [] });
  assert.throws(() => validateSceneText('本章目标：让他进入检查室', bare), /混入了提纲或写作指令/u);
  assert.throws(
    () => validateSceneText('他推开门，走进检查室。（本章完）', bare),
    /提前输出章节结束标记/u,
  );

  const instruction = '他走进检查室并完成全部登记';
  assert.ok(instruction.length >= 12);
  const withBeat = scene({ sceneNo: 6, beats: [{ order: 1, text: instruction, required: true }] });
  assert.throws(
    () => validateSceneText(`开场描写。\n\n${instruction}`, withBeat),
    /原样输出了 Beat 规划句/u,
  );
});

test('validateSceneText only treats beat lines of twelve characters or more as copied', () => {
  const short = '他走进检查室';
  assert.ok(short.length < 12);
  const withShortBeat = scene({
    sceneNo: 6,
    beats: [{ order: 1, text: short, required: true }],
  });
  assert.doesNotThrow(() => validateSceneText(`开场描写。\n\n${short}`, withShortBeat));
});

test('validateSceneText enforces the character budget', () => {
  const bare = scene({ sceneNo: 7, beats: [] });
  const short = '他推开门，走进检查室。';
  assert.throws(() => validateSceneText(short, bare, undefined, 500), /正文不足最低篇幅 500 字/u);
  assert.throws(
    () => validateSceneText(short, bare, undefined, undefined, 5),
    /正文超过最高篇幅 5 字/u,
  );
  assert.doesNotThrow(() => validateSceneText(short, bare, undefined, 1, 100));
});

test('validateSceneText accepts prose that covers every required beat', () => {
  const covered = scene({
    sceneNo: 8,
    beats: [{ order: 1, text: '他走进检查室', required: true }],
  });
  assert.doesNotThrow(() => validateSceneText('他推开门，走进检查室，灯光很亮。', covered));
});

test('validateSceneText reports the uncovered clauses of a required beat', () => {
  const uncovered = scene({
    sceneNo: 9,
    beats: [{ order: 1, text: '他走进检查室', required: true }],
  });
  assert.throws(
    () => validateSceneText('他站在门外等待着。', uncovered),
    /Scene 9 未覆盖必需 Beat：他走进检查室（缺少分句：他走进检查室）/u,
  );
});

test('validateSceneText ignores beats that are not required', () => {
  const optional = scene({
    sceneNo: 10,
    beats: [{ order: 1, text: '他走进检查室', required: false }],
  });
  assert.doesNotThrow(() => validateSceneText('他站在门外等待着。', optional));
});

test('beatCovered and missingBeatClauses agree on covered and uncovered prose', () => {
  assert.equal(beatCovered('他推开门，走进检查室，灯光很亮。', '他走进检查室'), true);
  assert.deepEqual(missingBeatClauses('他推开门，走进检查室，灯光很亮。', '他走进检查室'), []);

  assert.equal(beatCovered('他站在门外等待着。', '他走进检查室'), false);
  assert.deepEqual(missingBeatClauses('他站在门外等待着。', '他走进检查室'), ['他走进检查室']);
});

test('missingBeatClauses returns nothing when the beat has no usable clause', () => {
  assert.deepEqual(missingBeatClauses('任意正文', '好。'), []);
});

test('beatCovered rejects prose that negates the required action', () => {
  assert.equal(beatCovered('他没有走进检查室，只是站在门口。', '他走进检查室'), false);
});

test('externalRepairBeatCovered additionally demands the planned action be completed', () => {
  const beatText = '他打算进入检查室';

  // Coverage alone is satisfied by restating the plan.
  assert.equal(beatCovered('他打算进入检查室。', beatText), true);
  assert.equal(externalRepairBeatCovered('他打算进入检查室。', beatText), false);

  // A later sentence actually completes the entry.
  const completed = '他打算进入检查室。他进入了检查室。';
  assert.equal(beatCovered(completed, beatText), true);
  assert.equal(externalRepairBeatCovered(completed, beatText), true);
});

test('stateAnchorTerms merges result, transition and expected end state', () => {
  assert.deepEqual(stateAnchorTerms({ result: '拿到钥匙', transition: '', expectedEndState: '' }), [
    '拿到钥',
    '到钥匙',
  ]);
  assert.deepEqual(stateAnchorTerms({ result: '', transition: '', expectedEndState: '' }), []);
});

test('validateSceneContinuity requires the previous scene state to be carried over', () => {
  const previous = { result: '拿到钥匙', transition: '', expectedEndState: '' };
  assert.doesNotThrow(() => validateSceneContinuity(previous, '他拿到钥匙后离开了房间。'));
  assert.throws(() => validateSceneContinuity(previous, '完全无关的内容。'), /未承接上一 Scene/u);
});

test('validateSceneContinuity is a no-op when the previous scene has no anchors', () => {
  assert.doesNotThrow(() =>
    validateSceneContinuity({ result: '', transition: '', expectedEndState: '' }, '任意正文'),
  );
});

test('mergeSceneContinuation appends new paragraphs and drops the repeated boundary', () => {
  assert.equal(mergeSceneContinuation('第一段内容', '第二段内容', 1), '第一段内容\n\n第二段内容');
  assert.equal(
    mergeSceneContinuation('第一段内容\n\n第二段内容', '第二段内容\n\n第三段内容', 1),
    '第一段内容\n\n第二段内容\n\n第三段内容',
  );
});

test('mergeSceneContinuation rejects empty and purely repeated continuations', () => {
  assert.throws(() => mergeSceneContinuation('第一段内容', '   ', 2), /Scene 2 续写返回空正文/u);
  assert.throws(
    () => mergeSceneContinuation('第一段内容', '第一段内容', 2),
    /Scene 2 续写只重复了已有正文/u,
  );
});

test('pendingSceneBeats lists only uncovered required beats', () => {
  const target = scene({
    beats: [
      { order: 1, text: '他走进检查室', required: true },
      { order: 2, text: '他拿到钥匙离开', required: true },
      { order: 3, text: '他回头看了一眼窗外', required: false },
    ],
  });
  assert.deepEqual(pendingSceneBeats('他推开门，走进检查室，灯光很亮。', target), [
    '他拿到钥匙离开',
  ]);
});
