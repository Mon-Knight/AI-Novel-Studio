import assert from 'node:assert/strict';
import test from 'node:test';
import { extractArtifactCandidateOptions } from './artifactCandidateOptions';

test('character_candidates parses a root array by identity name', () => {
  const result = extractArtifactCandidateOptions(
    'character_candidates',
    JSON.stringify([
      { name: '林夏', roleType: 'protagonist', goal: '查明真相' },
      { name: '沈砚', roleType: 'supporting', personality: '克制' },
    ]),
  );
  assert.equal(result.unparsed, false);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]?.title, '林夏');
  assert.match(result.items[0]?.summary ?? '', /查明真相/);
  assert.equal(result.items[1]?.title, '沈砚');
  assert.deepEqual(result.items[0]?.raw, {
    name: '林夏',
    roleType: 'protagonist',
    goal: '查明真相',
  });
});

test('character_candidates parses nested characters, candidates, and data keys', () => {
  const nestedCharacters = extractArtifactCandidateOptions(
    'character_candidates',
    JSON.stringify({ characters: [{ name: '林夏' }] }),
  );
  const nestedCandidates = extractArtifactCandidateOptions(
    'character_candidates',
    JSON.stringify({ candidates: [{ name: '沈砚' }] }),
  );
  const nestedData = extractArtifactCandidateOptions(
    'character_candidates',
    JSON.stringify({ data: { characters: [{ name: '顾衡' }] } }),
  );
  const dataArray = extractArtifactCandidateOptions(
    'character_candidates',
    JSON.stringify({ data: [{ name: '苏晚' }] }),
  );
  const identityObject = extractArtifactCandidateOptions(
    'character_candidates',
    JSON.stringify({ name: '单人候选', identity: '御史' }),
  );
  assert.deepEqual(
    nestedCharacters.items.map((item) => item.title),
    ['林夏'],
  );
  assert.deepEqual(
    nestedCandidates.items.map((item) => item.title),
    ['沈砚'],
  );
  assert.deepEqual(
    nestedData.items.map((item) => item.title),
    ['顾衡'],
  );
  assert.deepEqual(
    dataArray.items.map((item) => item.title),
    ['苏晚'],
  );
  assert.equal(identityObject.items[0]?.title, '单人候选');
  assert.match(identityObject.items[0]?.summary ?? '', /御史/);
});

test('event_candidates parses events, suggestions, and candidates by title', () => {
  const events = extractArtifactCandidateOptions(
    'event_candidates',
    JSON.stringify({ events: [{ title: '夜探密库', description: '潜入内库' }] }),
  );
  const suggestions = extractArtifactCandidateOptions(
    'event_candidates',
    JSON.stringify({ suggestions: [{ title: '当街对质' }] }),
  );
  const candidates = extractArtifactCandidateOptions(
    'event_candidates',
    JSON.stringify({ data: { candidates: [{ name: '误用名称', title: '雨夜追凶' }] } }),
  );
  assert.equal(events.items[0]?.title, '夜探密库');
  assert.match(events.items[0]?.summary ?? '', /潜入内库/);
  assert.equal(suggestions.items[0]?.title, '当街对质');
  assert.equal(candidates.items[0]?.title, '雨夜追凶');
});

test('setting_candidates parses settings and candidates by name', () => {
  const settings = extractArtifactCandidateOptions(
    'setting_candidates',
    JSON.stringify({
      settings: [{ name: '禁咒律法', description: '不可对人施咒', category: 'magic' }],
    }),
  );
  const candidates = extractArtifactCandidateOptions(
    'setting_candidates',
    JSON.stringify({ candidates: [{ title: '备用标题', name: '夜航灯塔' }] }),
  );
  assert.equal(settings.items[0]?.title, '禁咒律法');
  assert.match(settings.items[0]?.summary ?? '', /不可对人施咒/);
  assert.equal(candidates.items[0]?.title, '夜航灯塔');
});

test('outline parses sections, chapters, volumes, and candidates by title or name', () => {
  const sections = extractArtifactCandidateOptions(
    'outline',
    JSON.stringify({ sections: [{ title: '开端', summary: '入城' }] }),
  );
  const chapters = extractArtifactCandidateOptions(
    'outline',
    JSON.stringify({ chapters: [{ name: '第一章', outline: '夜宴' }] }),
  );
  const volumes = extractArtifactCandidateOptions(
    'outline',
    JSON.stringify({
      volumes: [
        {
          title: '第一卷',
          summary: '入局',
          chapters: [{ title: '第1章', outline: '雨夜', goal: '立住主角' }],
        },
      ],
    }),
  );
  const candidates = extractArtifactCandidateOptions(
    'outline',
    JSON.stringify({ candidates: [{ title: '备选大纲' }] }),
  );
  const single = extractArtifactCandidateOptions(
    'outline',
    JSON.stringify({ title: '工作台大纲候选', content: '全书主线' }),
  );
  assert.equal(sections.items[0]?.title, '开端');
  assert.equal(chapters.items[0]?.title, '第一章');
  assert.deepEqual(
    volumes.items.map((item) => item.title),
    ['第一卷', '第1章'],
  );
  assert.match(volumes.items[1]?.summary ?? '', /雨夜/);
  assert.equal(candidates.items[0]?.title, '备选大纲');
  assert.equal(single.items[0]?.title, '工作台大纲候选');
  assert.match(single.items[0]?.summary ?? '', /全书主线/);
});

test('chapter_summary extracts readable paragraph fields instead of a candidate list', () => {
  const result = extractArtifactCandidateOptions(
    'chapter_summary',
    JSON.stringify({
      summary: '主角在雨夜查明旧案。',
      keyEvents: ['夜探密库', '对质证人'],
      nextChapterHook: '密信未拆。',
    }),
  );
  assert.equal(result.unparsed, false);
  assert.deepEqual(
    result.items.map((item) => item.title),
    ['章节摘要', '关键事件', '下章钩子'],
  );
  assert.equal(result.items[0]?.summary, '主角在雨夜查明旧案。');
  assert.match(result.items[1]?.summary ?? '', /夜探密库/);
  assert.doesNotMatch(result.items[0]?.summary ?? '', /^\{/);
});

test('empty payloads return no items and are not marked unparsed', () => {
  for (const content of ['[]', '{}', '{"characters":[]}', '{"data":{"candidates":[]}}']) {
    const result = extractArtifactCandidateOptions('character_candidates', content);
    assert.equal(result.unparsed, false, content);
    assert.deepEqual(result.items, [], content);
  }
});

test('invalid JSON is marked unparsed without items', () => {
  const result = extractArtifactCandidateOptions('character_candidates', '{not json');
  assert.equal(result.unparsed, true);
  assert.deepEqual(result.items, []);
});

test('chapter_text skips JSON option parsing even when content is valid JSON', () => {
  const result = extractArtifactCandidateOptions(
    'chapter_text',
    JSON.stringify({ characters: [{ name: '不应当作候选项' }] }),
  );
  assert.equal(result.unparsed, false);
  assert.deepEqual(result.items, []);
});
