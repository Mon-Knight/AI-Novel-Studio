import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { AiGenerateRequest } from '../../types/ai';
import { summarizeChapterContentInSegments } from '../../services/ai/chapterSummarizeService';
import { buildChapterSummarizePrompt } from '../../services/ai/promptBuilder';

function summaryJson(markers: string[]): string {
  return JSON.stringify({
    summaryTitle: '长章节上下文',
    summary: markers.join(' → '),
    keyEvents: markers,
    coreEvents: markers,
    protagonistStateChange: '',
    importantCharacterChanges: [],
    characterChanges: [],
    relationshipChanges: [],
    settingChanges: [],
    newLocations: [],
    newItemsOrAbilities: [],
    newForeshadows: [],
    resolvedForeshadows: [],
    foreshadowing: [],
    unresolvedQuestions: [],
    factsMustRemember: markers,
    nextChapterHints: '',
    nextChapterHook: '',
    contextRecords: [],
  });
}

function summarizeBody(request: AiGenerateRequest): string {
  const system = request.messages.find((message) => message.role === 'system')?.content ?? '';
  const marker = system.includes('当前连续分段正文：') ? '当前连续分段正文：\n' : '已采用正文：\n';
  const body = system.split(marker)[1];
  assert.ok(body, '分段总结提示词应包含当前正文');
  return body;
}

test('长章节总结映射每个连续分段并按顺序归并为全章结果', async () => {
  const source = Array.from(
    { length: 3 },
    (_, index) => `${'正文'.repeat(3_300)}SEGMENT_MARKER_${index + 1}`,
  ).join('\n\n');
  const mapBodies: string[] = [];
  const reducePrompts: string[] = [];

  const generation = await summarizeChapterContentInSegments(
    {
      novelTitle: '测试作品',
      chapterTitle: '超长章节',
      adoptedContent: source,
    },
    async (request) => {
      const system = request.messages.find((message) => message.role === 'system')?.content ?? '';
      if (system.includes('【按原文顺序排列的分段总结 JSON】')) {
        reducePrompts.push(system);
        const markers = [...new Set(system.match(/SEGMENT_MARKER_\d+/g) ?? [])];
        return { text: summaryJson(markers), tokenInput: 3, tokenOutput: 4, tokenTotal: 7 };
      }
      const body = summarizeBody(request);
      mapBodies.push(body);
      const marker = body.match(/SEGMENT_MARKER_\d+/)?.[0];
      assert.ok(marker, '每个待总结分段都应保留自己的尾部标记');
      return { text: summaryJson([marker]), tokenInput: 1, tokenOutput: 2, tokenTotal: 3 };
    },
  );

  assert.equal(generation.sourceSegmentCount, 3);
  assert.equal(mapBodies.length, 3);
  assert.equal(mapBodies.join(''), source);
  assert.ok(reducePrompts.length >= 1);
  assert.deepEqual(generation.result.keyEvents, [
    'SEGMENT_MARKER_1',
    'SEGMENT_MARKER_2',
    'SEGMENT_MARKER_3',
  ]);
  assert.equal(generation.requestCount, mapBodies.length + reducePrompts.length);
  assert.equal(generation.tokenTotal, mapBodies.length * 3 + reducePrompts.length * 7);
});

test('单段章节总结提示词保留超过 10000 字符后的真实结尾', () => {
  const content = `${'前文'.repeat(5_200)}SUMMARY_REAL_TAIL`;
  const request = buildChapterSummarizePrompt({
    chapterTitle: '测试章节',
    adoptedContent: content,
  });
  const system = request.messages.find((message) => message.role === 'system')?.content ?? '';
  assert.ok(system.includes('SUMMARY_REAL_TAIL'));
  assert.ok(system.endsWith(content));
});
