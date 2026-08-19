import assert from 'node:assert/strict';
import test from 'node:test';
import { extractJsonCandidates, parseJsonCandidates } from '../ai/jsonUtils';
import { parseChapterProposals } from './autonomousResponseParser';

function chapter(chapterNumber: number) {
  return {
    chapterNumber,
    title: `第 ${chapterNumber} 章`,
    outline: `主角在标记 {${chapterNumber}} 旁说："继续"，保留字面量 ,} 与 ,]，并推进当前冲突。`,
    goal: '推进调查',
    endingHook: '出现新的证据',
    focusCharacters: ['主角'],
    conflictTitles: ['调查冲突'],
    worldElementNames: ['旧车站'],
  };
}

test('Chapter Batch Planner skips earlier prose objects and unrelated fences', () => {
  const response = [
    '推理草稿 {"attempt":1}',
    '```json',
    '{"note":"这不是最终结果"}',
    '```',
    '最终结果：',
    '```json',
    JSON.stringify({ chapters: [chapter(1), chapter(2)] }),
    '```',
    '附注 {"done":true}',
  ].join('\n');

  const parsed = parseChapterProposals(response);
  assert.deepEqual(
    parsed.map((item) => item.chapterNumber),
    [1, 2],
  );
});

test('balanced scanning survives an unmatched earlier brace and repairs only trailing commas', () => {
  const valid = JSON.stringify({ chapters: [chapter(1)] });
  const trailingCommas = valid.replace(/}\]}$/, '},],}');
  const response = `未完成的草稿 { "outline": "discard"\n${trailingCommas}`;

  const candidates = extractJsonCandidates(response);
  assert.ok(candidates.some((candidate) => candidate.includes('"chapters"')));
  assert.ok(parseJsonCandidates(response).some((candidate) => candidate.repairedTrailingComma));

  const parsed = parseChapterProposals(response);
  assert.equal(parsed[0].outline, chapter(1).outline);
});

test('when multiple chapter objects exist the most complete expected root wins', () => {
  const response = [
    JSON.stringify({ chapters: [chapter(99)] }),
    JSON.stringify({ chapters: [chapter(1), chapter(2), chapter(3)] }),
  ].join('\n');

  const parsed = parseChapterProposals(response);
  assert.deepEqual(
    parsed.map((item) => item.chapterNumber),
    [1, 2, 3],
  );
});

test('truncated JSON and schema type drift still fail closed', () => {
  const truncated = JSON.stringify({ chapters: [chapter(1)] }).slice(0, -1);
  assert.throws(() => parseChapterProposals(truncated));

  const wrongType = JSON.stringify({
    chapters: [{ ...chapter(1), chapterNumber: '1' }],
  });
  assert.throws(() => parseChapterProposals(wrongType), /chapterNumber必须是数字/);
});
