import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeWorkbenchTurnContent,
  describeWorkbenchAutomaticTurn,
  encodeWorkbenchTurnContent,
} from './workbenchTurnOrigin';

test('workbench automatic turn envelope round-trips without changing the runtime goal', () => {
  const goal = '生成世界设定候选。创意依据：一座城市正在删除人的记忆。';
  const stored = encodeWorkbenchTurnContent(goal, 'workbench_asset_preparation');

  assert.notEqual(stored, goal);
  assert.equal(
    stored.startsWith(goal),
    true,
    'the authoritative runtime goal keeps its action prefix',
  );
  assert.deepEqual(decodeWorkbenchTurnContent(stored), {
    content: goal,
    origin: 'workbench_asset_preparation',
  });
});

test('ordinary user content remains unclassified and unchanged', () => {
  assert.deepEqual(decodeWorkbenchTurnContent('继续写下一章'), {
    content: '继续写下一章',
  });
});

test('chapter summary origin keeps the visible automatic instruction minimal', () => {
  const stored = encodeWorkbenchTurnContent('总结本章', 'workbench_chapter_summary');

  assert.deepEqual(decodeWorkbenchTurnContent(stored), {
    content: '总结本章',
    origin: 'workbench_chapter_summary',
  });
  assert.match(stored, /不是用户的新消息/);
});

test('automatic preparation presentation exposes only a compact system step', () => {
  const creativeBrief = '永夜城正在失去时间，主角必须在七天内找到钟楼。';
  const cases = [
    ['生成世界与规则设定候选', '准备世界与规则设定'],
    ['生成主角候选', '准备主角设定'],
    ['生成全书规划候选', '准备全书规划'],
    ['生成本章大纲候选', '准备章节大纲'],
  ] as const;

  for (const [goal, label] of cases) {
    const decoded = decodeWorkbenchTurnContent(
      encodeWorkbenchTurnContent(
        `${goal}。创意依据：${creativeBrief}`,
        'workbench_asset_preparation',
      ),
    );
    const presentation = describeWorkbenchAutomaticTurn(decoded);
    assert.deepEqual(presentation, { badge: '自动准备', label });
    assert.doesNotMatch(JSON.stringify(presentation), new RegExp(creativeBrief, 'u'));
  }
});
