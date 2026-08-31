import assert from 'node:assert/strict';
import test from 'node:test';
import type { ConversationTurn } from '../../types/conversation';
import {
  composeWorkbenchInstruction,
  derivePersistentTaskConstraints,
} from './taskConstraintBrief';
import { encodeWorkbenchTurnContent } from './workbenchTurnOrigin';

function userTurn(turnId: string, sequence: number, content: string): ConversationTurn {
  return {
    turnId,
    conversationId: 'conversation-001',
    sequence,
    role: 'user',
    content,
    createdAt: `2026-08-28T00:00:${String(sequence).padStart(2, '0')}.000Z`,
  };
}

test('task brief keeps explicit task-wide constraints without carrying chapter beats', () => {
  const constraints = derivePersistentTaskConstraints(
    [
      userTurn(
        'turn-001',
        1,
        [
          '全书大纲：主角从旧城一路追查到中央塔，并在第十五章作出选择。',
          '全程使用第三人称限知，始终保持克制冷峻的叙述。',
          '本章必须让主角拿到铜钥匙。',
          '第十二章不要揭示馆长身份。',
          '下一章从钟楼外开始。',
        ].join('\n'),
      ),
      userTurn('turn-002', 2, '继续写'),
    ],
    'turn-002',
  );

  assert.deepEqual(constraints, ['全程使用第三人称限知，始终保持克制冷峻的叙述。']);
});

test('ordinary detailed instructions do not become persistent without explicit scope', () => {
  const constraints = derivePersistentTaskConstraints([
    userTurn('turn-001', 1, '雨夜开场，主角进入旧档案馆，在结尾听到楼上传来脚步声。'),
    userTurn('turn-002', 2, '继续写'),
  ]);
  assert.deepEqual(constraints, []);
});

test('workbench automatic turns never become persistent user constraints', () => {
  const constraints = derivePersistentTaskConstraints([
    userTurn('turn-001', 1, '全程使用第三人称限知。'),
    userTurn(
      'turn-asset',
      2,
      encodeWorkbenchTurnContent('生成全书规划候选。', 'workbench_asset_preparation'),
    ),
    userTurn(
      'turn-summary',
      3,
      encodeWorkbenchTurnContent('总结本章。', 'workbench_chapter_summary'),
    ),
    userTurn('turn-004', 4, '继续写'),
  ]);

  assert.deepEqual(constraints, ['全程使用第三人称限知。']);
});

test('task brief deduplicates repeated constraints and gives the current goal precedence', () => {
  const turns = [
    userTurn('turn-001', 1, '所有章节都不要使用第一人称。'),
    userTurn('turn-002', 2, '所有章节都不要使用第一人称。'),
    userTurn('turn-003', 3, '继续写'),
  ];
  const constraints = derivePersistentTaskConstraints(turns, 'turn-003');
  assert.deepEqual(constraints, ['所有章节都不要使用第一人称。']);
  assert.equal(
    composeWorkbenchInstruction('继续写', constraints),
    [
      '【当前用户指令】',
      '继续写',
      '',
      '【任务持续约束】',
      '以下约束来自本任务此前用户回合。若与当前指令或正式小说资产冲突，以当前指令和正式小说资产为准：',
      '- 所有章节都不要使用第一人称。',
    ].join('\n'),
  );
});
