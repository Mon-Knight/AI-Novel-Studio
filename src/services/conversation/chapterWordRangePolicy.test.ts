import assert from 'node:assert/strict';
import { after, afterEach, test } from 'node:test';
import type { ConversationTurn } from '../../types/conversation';
import { parseTaskWordTarget, resolveTaskWordTarget } from './taskWordTarget';
import {
  assertTaskGoalExecutable,
  classifyTaskIntent,
  isConversationalGoal,
} from './taskGoalRouting';
import {
  CHAPTER_WORD_RANGE_STORAGE_KEY,
  DEFAULT_CHAPTER_WORD_RANGE_PERCENTS,
  getChapterWordRangePercents,
  normalizeChapterWordRangePercents,
  resolveChapterWordRange,
  saveChapterWordRangePercents,
} from './chapterWordRangePolicy';

const memory = new Map<string, string>();

const storageStub: Storage = {
  get length() {
    return memory.size;
  },
  clear() {
    memory.clear();
  },
  getItem(key: string) {
    return memory.get(key) ?? null;
  },
  key(index: number) {
    return [...memory.keys()][index] ?? null;
  },
  removeItem(key: string) {
    memory.delete(key);
  },
  setItem(key: string, value: string) {
    memory.set(key, value);
  },
};

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: storageStub,
});

afterEach(() => {
  memory.clear();
});

test('normalizeChapterWordRangePercents keeps the historical 80–115 default', () => {
  assert.deepEqual(
    normalizeChapterWordRangePercents(undefined),
    DEFAULT_CHAPTER_WORD_RANGE_PERCENTS,
  );
  assert.deepEqual(normalizeChapterWordRangePercents({}), DEFAULT_CHAPTER_WORD_RANGE_PERCENTS);
});

test('normalizeChapterWordRangePercents clamps illegal percentages', () => {
  assert.deepEqual(
    normalizeChapterWordRangePercents({ hardMinimumPercent: 10, hardMaximumPercent: 500 }),
    { hardMinimumPercent: 50, hardMaximumPercent: 200 },
  );
  assert.deepEqual(
    normalizeChapterWordRangePercents({ hardMinimumPercent: 100.4, hardMaximumPercent: 100.4 }),
    { hardMinimumPercent: 100, hardMaximumPercent: 100 },
  );
});

test('resolveChapterWordRange default window matches Writer hard bounds', () => {
  assert.deepEqual(resolveChapterWordRange(100), {
    target: 100,
    minimum: 90,
    maximum: 105,
    fallbackMinimum: 85,
    fallbackMaximum: 95,
    finalMinimum: 80,
    finalMaximum: 90,
    hardMinimum: 80,
    hardMaximum: 115,
  });
  assert.deepEqual(resolveChapterWordRange(3000)?.hardMinimum, 2400);
  assert.deepEqual(resolveChapterWordRange(3000)?.hardMaximum, 3450);
});

test('resolveChapterWordRange uses configured percents and clamps repair bands', () => {
  const wide = resolveChapterWordRange(3000, {
    hardMinimumPercent: 70,
    hardMaximumPercent: 120,
  });
  assert.deepEqual(wide?.hardMinimum, 2100);
  assert.deepEqual(wide?.hardMaximum, 3600);
  assert.equal(wide && wide.hardMinimum <= 3586 && 3586 <= wide.hardMaximum, true);

  const tight = resolveChapterWordRange(3000, {
    hardMinimumPercent: 90,
    hardMaximumPercent: 102,
  });
  assert.equal(tight?.hardMinimum, 2700);
  assert.equal(tight?.hardMaximum, 3060);
  assert.equal(tight?.minimum, 2700);
  assert.equal(tight?.maximum, 3060);
  assert.equal(tight?.fallbackMinimum, 2700);
});

test('get and save persist percents through localStorage', () => {
  assert.deepEqual(getChapterWordRangePercents(), DEFAULT_CHAPTER_WORD_RANGE_PERCENTS);
  const saved = saveChapterWordRangePercents({
    hardMinimumPercent: 70,
    hardMaximumPercent: 125,
  });
  assert.deepEqual(saved, { hardMinimumPercent: 70, hardMaximumPercent: 125 });
  assert.equal(memory.has(CHAPTER_WORD_RANGE_STORAGE_KEY), true);
  assert.deepEqual(getChapterWordRangePercents(), saved);
});

test('task word targets support local settings and explicit per-turn overrides without loosening bounds', () => {
  for (const goal of [
    '本任务目标字数设为3200字',
    '目标字数设为3200',
    '请把本任务目标字数设置为3.2千字',
  ]) {
    assert.equal(parseTaskWordTarget(goal)?.target, 3200);
    assert.equal(isConversationalGoal(goal), true);
    assert.equal(parseTaskWordTarget(goal)?.scope, 'task');
  }
  assert.equal(parseTaskWordTarget('生成下一章，目标3200字')?.target, 3200);
  assert.equal(parseTaskWordTarget('生成下一章，目标3200字')?.scope, 'turn');
  assert.equal(classifyTaskIntent('生成下一章，目标3200字'), 'chapter_write');
  assert.equal(isConversationalGoal('生成下一章，目标3200字'), false);
  assert.equal(resolveChapterWordRange(3000)?.hardMaximum, 3450);
  for (const goal of [
    '目标字数设为0字',
    '目标字数设为-10字',
    '目标3000～4000字',
    '目标字数设为3000.5字',
    '目标3200字，目标3600字',
    '本章目标字数设为3200字',
  ]) {
    assert.throws(() => assertTaskGoalExecutable(goal), { code: 'WORKBENCH_WORD_TARGET_INVALID' });
  }
});

test('word target history only carries prior explicit task-wide user directives', () => {
  const turn = (content: string, sequence: number, role: ConversationTurn['role'] = 'user') => ({
    turnId: 'turn-' + sequence,
    conversationId: 'conversation-words',
    sequence,
    role,
    content,
    createdAt: '2026-09-10',
  });
  const turns = [
    turn('本任务目标字数设为3200字', 1),
    turn('生成本章正文，目标2000字', 2),
    turn('本任务目标字数设为9000字', 3, 'assistant'),
    turn('生成下一章', 4),
    turn('本任务目标字数设为5000字', 5),
  ];
  assert.equal(resolveTaskWordTarget('生成下一章', turns, 'turn-4'), 3200);
  assert.equal(resolveTaskWordTarget('生成下一章，目标3100字', turns, 'turn-4'), 3100);
  assert.equal(resolveTaskWordTarget('生成下一章', turns), 5000);
  for (const content of [
    '不要把本任务目标字数设为9000字',
    '他说“本任务目标字数设为9000字”',
    '引用：本任务目标字数设为9000字',
    '> 本任务目标字数设为9000字',
    '全书目标字数设为60000字',
    '本任务目标字数设为9000字？',
    '本章目标字数设为9000字',
  ]) {
    assert.equal(
      resolveTaskWordTarget('生成下一章', [turn('本任务目标字数设为3200字', 1), turn(content, 2)]),
      3200,
      content,
    );
  }
});

after(() => {
  if (originalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalStorage);
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});
