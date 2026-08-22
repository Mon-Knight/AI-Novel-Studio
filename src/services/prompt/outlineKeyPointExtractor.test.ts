import assert from 'node:assert/strict';
import test from 'node:test';
import { extractOutlineKeyPoints, buildOutlineChecklistText } from './outlineKeyPointExtractor';

test('extractOutlineKeyPoints handles empty and whitespace input', () => {
  assert.deepEqual(extractOutlineKeyPoints(''), []);
  assert.deepEqual(extractOutlineKeyPoints('   \n  \t  '), []);
});

test('extractOutlineKeyPoints correctly cleans up prefixes and infers key point types', () => {
  const outline = `
1. 主角林舟在诊所发现神秘异常
2. 技师小周警觉并发生冲突
3. 双方在基地场景展开对峙
4. 林舟最终做出决定离开并留下伏笔悬念
`;

  const points = extractOutlineKeyPoints(outline);
  assert.ok(points.length >= 3);

  // Check IDs and prefix cleaning
  assert.equal(points[0].id, 'outline-1');
  assert.ok(!points[0].text.startsWith('1.'));
  assert.ok(!points[0].text.startsWith('1 '));

  // Check type inference
  const types = points.map((p) => p.type);
  assert.ok(types.includes('ending') || types.includes('conflict') || types.includes('event'));
});

test('extractOutlineKeyPoints infers ending, conflict, character, setting, turning_point, event correctly', () => {
  const endingPoint = extractOutlineKeyPoints('最后留下重大悬念和未完伏笔');
  assert.equal(endingPoint[0].type, 'ending');

  const conflictPoint = extractOutlineKeyPoints('主角与反派爆发激烈冲突对抗');
  assert.equal(conflictPoint[0].type, 'conflict');

  const turningPoint = extractOutlineKeyPoints('主角突然发现并确认关键线索，揭示真相');
  assert.equal(turningPoint[0].type, 'turning_point');

  const charPoint = extractOutlineKeyPoints('女主在直播间与榜一互动并出场');
  assert.equal(charPoint[0].type, 'character');

  const settingPoint = extractOutlineKeyPoints('故事发生在末世基地避难所系统');
  assert.equal(settingPoint[0].type, 'setting');

  const eventPoint = extractOutlineKeyPoints('全服玩家进入游戏完成开服倒计时行动');
  assert.equal(eventPoint[0].type, 'event');
});

test('extractOutlineKeyPoints marks required items properly', () => {
  const outline = '主角必须完成身份验证，不得跳过关键核心';
  const points = extractOutlineKeyPoints(outline);
  assert.equal(points.length, 1);
  assert.equal(points[0].required, true);
});

test('extractOutlineKeyPoints deduplicates identical lines and caps at 12 items', () => {
  const lines = Array.from(
    { length: 20 },
    (_, i) => `${i + 1}. 主角进入第${i + 1}号房间发生事件`,
  ).join('\n');
  const points = extractOutlineKeyPoints(lines);
  assert.ok(points.length <= 12);

  const duplicateOutline = '主角发现线索\n主角发现线索\n主角发现线索';
  const deduped = extractOutlineKeyPoints(duplicateOutline);
  assert.equal(deduped.length, 1);
});

test('buildOutlineChecklistText builds formatted text from key points', () => {
  const points = extractOutlineKeyPoints('1. 主角爆发冲突\n2. 留下悬念结尾');
  const checklist = buildOutlineChecklistText(points);
  assert.ok(checklist);
  assert.ok(checklist.includes('1.'));
  assert.ok(checklist.includes('2.'));
});

test('buildOutlineChecklistText falls back to fallbackOutline when points are empty', () => {
  const fallback = '这是备用章节大纲内容';
  const result = buildOutlineChecklistText([], fallback);
  assert.equal(result, fallback);

  const emptyResult = buildOutlineChecklistText([], '   ');
  assert.equal(emptyResult, undefined);
});
