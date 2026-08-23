import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chapterRequiredError,
  classifyWorkbenchFailure,
  formatWorkbenchFailure,
} from './workbenchFailure';

test('classifies missing chapter, candidate, service and model failures', () => {
  assert.equal(classifyWorkbenchFailure(chapterRequiredError()).code, 'WORKBENCH_CHAPTER_REQUIRED');
  assert.equal(classifyWorkbenchFailure(new Error('candidateText must be a non-empty string')).layer, 'parameter');
  assert.equal(classifyWorkbenchFailure(new Error('chapter not found in novel')).layer, 'data');
  assert.equal(classifyWorkbenchFailure(new Error('generate_chapter 缺少实际治理请求身份')).layer, 'service');
  assert.equal(classifyWorkbenchFailure(new Error('模型拒绝输出')).layer, 'model');
  assert.match(formatWorkbenchFailure(chapterRequiredError()), /选择目标章节/);
});
