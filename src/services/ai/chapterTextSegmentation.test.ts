import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHAPTER_AI_SEGMENT_MAX_CHARS,
  mergePolishedSegments,
  splitChapterText,
} from './chapterTextSegmentation';
import {
  buildChapterGeneratePrompt,
  buildChapterPolishPrompt,
  buildQualityCheckPrompt,
} from './promptBuilder';

test('长章节按连续范围完整分段且不遗漏任何字符', () => {
  const source = Array.from(
    { length: 240 },
    (_, index) => `第${index + 1}段。${'正文内容'.repeat(22)}`,
  ).join('\n\n');
  const segments = splitChapterText(source);

  assert.ok(segments.length > 1);
  assert.ok(segments.every((segment) => segment.text.length <= CHAPTER_AI_SEGMENT_MAX_CHARS));
  assert.equal(segments.map((segment) => segment.text).join(''), source);
  assert.equal(segments[0].startOffset, 0);
  assert.equal(segments[segments.length - 1]?.endOffset, source.length);
});

test('分段润色只在全部结果存在时合并并保留顺序', () => {
  const source = `${'甲'.repeat(600)}\n\n${'乙'.repeat(600)}\n\n${'丙'.repeat(600)}`;
  const segments = splitChapterText(source, 700);
  const outputs = segments.map((segment, index) => `润色段${index + 1}:${segment.text.trim()}`);
  const merged = mergePolishedSegments(source, segments, outputs);

  assert.ok(merged.indexOf('润色段1') < merged.indexOf('润色段2'));
  assert.throws(
    () => mergePolishedSegments(source, segments, outputs.slice(0, -1)),
    /结果数量不完整/,
  );
  assert.throws(
    () =>
      mergePolishedSegments(
        source,
        segments,
        segments.map((segment, index) =>
          index === 0 ? segment.text.trim().slice(0, 100) : segment.text,
        ),
      ),
    /结果异常过短/,
  );
});

test('润色与质量提示词包含传入段落末尾而非静默截断前 8000 字符', () => {
  const content = `${'前'.repeat(8_100)}TAIL_MARKER`;
  const polish = buildChapterPolishPrompt({
    novelTitle: '作品',
    chapterTitle: '章节',
    draftContent: content,
    polishMode: 'keep_plot',
  });
  const quality = buildQualityCheckPrompt({
    novelTitle: '作品',
    chapterTitle: '章节',
    draftContent: content,
  });
  assert.ok(polish.messages.some((message) => message.content.includes('TAIL_MARKER')));
  assert.ok(quality.messages.some((message) => message.content.includes('TAIL_MARKER')));
});

test('章节改写提示词包含完整当前草稿而非只读取前 8000 字符', () => {
  const content = `${'前'.repeat(8_100)}REWRITE_REAL_TAIL`;
  const request = buildChapterGeneratePrompt({
    novelTitle: '作品',
    chapterTitle: '章节',
    targetWordCount: 4_000,
    draftContent: content,
  });
  assert.ok(request.messages.some((message) => message.content.includes('REWRITE_REAL_TAIL')));
});
