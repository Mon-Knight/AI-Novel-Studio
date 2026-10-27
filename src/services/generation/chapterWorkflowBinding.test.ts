import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChapterWorkflowBindingV1 } from '../../types/chapterWorkflowBinding';
import { sha256, stableCanonicalJson } from '../ai/compilation/canonical';
import {
  CHAPTER_WORKFLOW_BINDING_START,
  CHAPTER_WORKFLOW_BINDING_END,
  chapterWorkflowBindingSources,
  renderChapterWorkflowBinding,
  validateChapterWorkflowBinding,
} from './chapterWorkflowBinding';

const binding: ChapterWorkflowBindingV1 = {
  schemaVersion: 1,
  workflowId: 'user-turn-12',
  stageKey: 'beat:scene-1:beat-1',
  inputHash: 'a'.repeat(64),
  planHash: 'b'.repeat(64),
};

test('workflow binding is a required full request source, not metadata-only evidence', async () => {
  const [source] = await chapterWorkflowBindingSources(binding);
  assert.equal(source.required, true);
  assert.equal(source.requireFull, true);
  assert.equal(source.sourceType, 'request_context');
  assert.equal(source.sourceVersion, await sha256(source.content));
  assert.equal(
    source.content,
    `${CHAPTER_WORKFLOW_BINDING_START}\n${stableCanonicalJson(binding)}\n${CHAPTER_WORKFLOW_BINDING_END}`,
  );
  assert.deepEqual(validateChapterWorkflowBinding(binding), binding);
});

test('legacy independent calls add no implicit workflow identity', async () => {
  assert.deepEqual(await chapterWorkflowBindingSources(undefined), []);
});

test('binding rejects unknown fields, unsupported versions and weak hashes', () => {
  for (const value of [
    { ...binding, schemaVersion: 2 },
    { ...binding, apiKey: 'must-not-leak' },
    { ...binding, inputHash: 'txt_weak' },
    { ...binding, planHash: 'A'.repeat(64) },
    { ...binding, stageKey: '' },
    { ...binding, workflowId: ' padded ' },
    { ...binding, stageKey: 'phase\nnewline' },
    { ...binding, workflowId: CHAPTER_WORKFLOW_BINDING_START },
    { ...binding, stageKey: CHAPTER_WORKFLOW_BINDING_END },
  ])
    assert.throws(() => validateChapterWorkflowBinding(value), /CHAPTER_WORKFLOW_BINDING_INVALID/);
});

test('identity size uses UTF-8 bytes, matching the native protocol', () => {
  assert.equal(
    validateChapterWorkflowBinding({ ...binding, workflowId: '😀'.repeat(50) }).workflowId.length,
    100,
  );
  assert.throws(
    () => validateChapterWorkflowBinding({ ...binding, workflowId: '😀'.repeat(51) }),
    /CHAPTER_WORKFLOW_BINDING_INVALID/,
  );
});

test('binding is copied before asynchronous hashing and cannot be changed through its caller', async () => {
  const original = { ...binding };
  const pending = chapterWorkflowBindingSources(original);
  original.stageKey = 'other-stage';
  const [source] = await pending;
  assert.ok(source.content.includes(stableCanonicalJson(binding)));
  assert.ok(!source.content.includes('other-stage'));
  const checked = validateChapterWorkflowBinding(binding);
  checked.stageKey = 'changed-copy';
  assert.equal(binding.stageKey, 'beat:scene-1:beat-1');
  assert.equal(renderChapterWorkflowBinding(binding).includes('changed-copy'), false);
});
