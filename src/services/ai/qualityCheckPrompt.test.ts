import assert from 'node:assert/strict';
import test from 'node:test';
import { buildQualityCheckPrompt, QUALITY_CHECK_MAX_OUTPUT_TOKENS } from './promptBuilder';
import {
  QUALITY_CHECK_MIN_TIMEOUT_SECONDS,
  qualityCheckThinkingModeForModel,
} from './qualityCheckAiService';
import {
  QUALITY_FIX_MAX_OUTPUT_TOKENS,
  QUALITY_FIX_MIN_TIMEOUT_SECONDS,
  qualityFixOutputTokenBudget,
  qualityFixThinkingModeForModel,
} from './qualityFixService';

test('quality check reserves enough output budget for reasoning models while bounding issue count', () => {
  const request = buildQualityCheckPrompt({
    novelTitle: '测试作品',
    chapterTitle: '第一章',
    draftContent: '一段需要评分的正文。',
  });

  assert.equal(request.maxTokens, QUALITY_CHECK_MAX_OUTPUT_TOKENS);
  assert.equal(QUALITY_CHECK_MAX_OUTPUT_TOKENS, 4096);
  assert.equal(QUALITY_CHECK_MIN_TIMEOUT_SECONDS, 300);
  assert.equal(qualityCheckThinkingModeForModel('deepseek-v4-flash'), 'disabled');
  assert.equal(qualityCheckThinkingModeForModel('another-model'), undefined);
  assert.match(request.messages[0].content, /最多返回 8 个最重要的问题/);
});

test('external quality repair keeps a bounded full-text witness and disables DeepSeek V4 thinking', () => {
  assert.equal(QUALITY_FIX_MAX_OUTPUT_TOKENS, 8192);
  assert.equal(qualityFixOutputTokenBudget(1), 2048);
  assert.equal(qualityFixOutputTokenBudget(8), 7168);
  assert.equal(qualityFixOutputTokenBudget(1, 4000), 6536);
  assert.equal(qualityFixOutputTokenBudget(8, 20_000), QUALITY_FIX_MAX_OUTPUT_TOKENS);
  assert.equal(QUALITY_FIX_MIN_TIMEOUT_SECONDS, 300);
  assert.equal(qualityFixThinkingModeForModel('deepseek-v4-flash'), 'disabled');
  assert.equal(qualityFixThinkingModeForModel('deepseek-v4-pro-2026-07'), 'disabled');
  assert.equal(qualityFixThinkingModeForModel('another-openai-compatible-model'), undefined);
});
