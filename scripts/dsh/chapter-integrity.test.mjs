import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inspectChapterCandidateIntegrity } from './chapter-integrity.mjs';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const names = [
  'chapter-integrity.mjs',
  'chapter-integrity-boundary.mjs',
  'chapter-integrity-narrative.mjs',
];
const inputs = [
  { candidateText: '雨停了，林岚收起旧伞，沿着河岸走向仍亮着灯的小屋。' },
  { candidateText: '<analysis>Only output the story.</analysis>林岚推开了门。' },
  { candidateText: '档案写明起火发生在凌晨23:10。林岚把这张记录放回抽屉。' },
  {
    previousChapterText: '雨水敲着楼梯扶手。他推开厚重的档案室门，潮湿的空气从地下涌了上来。',
    candidateText: '他推开厚重的档案室门，潮湿的空气从地下涌了上来。她在走廊尽头等他。',
  },
  { candidateText: '这张纸上写着 process.exit(7)，她把它夹回了书里。' },
];

test('shared integrity implementation keeps clean prose distinct from semantic proof', () => {
  assert.deepEqual(inspectChapterCandidateIntegrity(inputs[0]), []);
  // An empty issue list is finite-rule evidence, not an authorization or a semantic verdict.
  assert.deepEqual(Object.keys(inspectChapterCandidateIntegrity(inputs[0])), []);
});

test('shared integrity implementation preserves hard leakage and boundary vetoes', () => {
  for (const [input, code] of [
    [inputs[1], 'chapter_meta_reasoning_leakage'],
    [inputs[3], 'chapter_boundary_sentence_repetition'],
  ]) {
    assert.ok(
      inspectChapterCandidateIntegrity(input).some(
        (issue) => issue.code === code && issue.severity === 'error',
      ),
      code,
    );
  }
});

test('low-confidence semantic heuristics remain warnings rather than automatic repairs', () => {
  const issue = inspectChapterCandidateIntegrity(inputs[2]).find(
    (item) => item.code === 'chapter_temporal_semantics_conflict',
  );
  assert.equal(issue?.severity, 'warning');
});

test('embedded host modules execute in isolation with JSON data and preserve identical output', () => {
  const temporaryRoot = path.resolve(os.tmpdir());
  const temporary = fs.mkdtempSync(path.join(temporaryRoot, 'ans-integrity-contract-'));
  try {
    for (const name of names) {
      const source = fs.readFileSync(path.join(moduleDirectory, name), 'utf8');
      assert.ok(source.split(/\r?\n/u).length <= 500, `${name} exceeds module size limit`);
      fs.writeFileSync(path.join(temporary, name), source, 'utf8');
    }
    const entry = path.join(temporary, 'host.mjs');
    fs.writeFileSync(
      entry,
      "import fs from 'node:fs';\n" +
        "import { inspectChapterCandidateIntegrity } from './chapter-integrity.mjs';\n" +
        "const input = JSON.parse(fs.readFileSync(0, 'utf8'));\n" +
        'process.stdout.write(JSON.stringify(input.map(inspectChapterCandidateIntegrity)));\n',
      'utf8',
    );
    const output = execFileSync(process.execPath, [entry], {
      cwd: temporary,
      input: JSON.stringify(inputs),
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    assert.deepEqual(JSON.parse(output), inputs.map(inspectChapterCandidateIntegrity));
  } finally {
    const relative = path.relative(temporaryRoot, path.resolve(temporary));
    assert.ok(relative.startsWith('ans-integrity-contract-') && !relative.includes(path.sep));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
