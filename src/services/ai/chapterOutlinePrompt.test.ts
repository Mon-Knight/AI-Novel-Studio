import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChapterOutlineGeneratePrompt } from './promptBuilder';

test('chapter outline prompt keeps a three-chapter batch within the configured output budget', () => {
  const request = buildChapterOutlineGeneratePrompt({
    novelTitle: '零点潮汐',
    volumeTitle: '第一卷：潮汐初痕',
    chapterCount: 3,
    activeMasterOutline: '作品总纲',
    volumeSummary: '分卷摘要',
  });

  const prompt = request.messages.map((message) => message.content).join('\n');
  assert.match(prompt, /只生成 3 个章节候选/);
  assert.match(prompt, /整个响应控制在 900 tokens 内/);
  assert.match(prompt, /targetWordCount 固定为 2500/);
  assert.doesNotMatch(prompt, /```/);
  assert.equal(request.maxTokens, 1200);
});

test('chapter outline prompt defaults to one compact three-chapter batch', () => {
  const request = buildChapterOutlineGeneratePrompt({ novelTitle: '默认批次测试' });
  const prompt = request.messages.map((message) => message.content).join('\n');

  assert.match(prompt, /只生成 3 个章节候选/);
});
