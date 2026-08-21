import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTaskIntent,
  findTaskTargetConflict,
  isConversationalGoal,
  selectCandidateTool,
} from './taskGoalRouting';

test('candidate tool routing covers domain, style and foreshadowing goals', () => {
  assert.equal(selectCandidateTool('生成下一章', 'ch-1')?.name, 'generate_chapter');
  assert.equal(selectCandidateTool('扩展本章大纲', 'ch-1')?.name, 'generate_outline');
  assert.equal(selectCandidateTool('为本作品生成角色候选', 'ch-1')?.name, 'generate_characters');
  assert.equal(selectCandidateTool('生成世界设定候选', 'ch-1')?.name, 'expand_settings');
  assert.equal(selectCandidateTool('建议本章事件', 'ch-1')?.name, 'suggest_events');
  assert.equal(selectCandidateTool('润色本章正文', 'ch-1')?.name, 'polish_chapter');
  assert.equal(selectCandidateTool('按风格润色本章', 'ch-1')?.name, 'polish_chapter');
  assert.equal(selectCandidateTool('风格分析当前章节', 'ch-1')?.name, 'check_quality');
  assert.equal(selectCandidateTool('审计人物一致性', 'ch-1')?.name, 'check_quality');
  assert.equal(selectCandidateTool('检查伏笔回收', 'ch-1')?.name, 'check_quality');
  assert.equal(selectCandidateTool('生成伏笔候选', 'ch-1')?.name, 'suggest_events');
  assert.equal(selectCandidateTool('总结本章', 'ch-1')?.name, 'summarize_chapter');
  assert.equal(selectCandidateTool('为本作品生成角色候选'), undefined);
  assert.equal(selectCandidateTool('你好', 'ch-1'), undefined);
  assert.equal(selectCandidateTool('你能做什么', 'ch-1'), undefined);
  assert.equal(selectCandidateTool('hello', 'ch-1'), undefined);
  assert.equal(isConversationalGoal('你好'), true);
  assert.equal(isConversationalGoal('你能做什么？'), true);
  assert.equal(isConversationalGoal('生成下一章'), false);
  assert.equal(classifyTaskIntent('你好'), 'read');
});

test('write tasks on the same novel warn without blocking concurrency', () => {
  assert.equal(classifyTaskIntent('生成下一章'), 'chapter_write');
  assert.equal(classifyTaskIntent('审计人物一致性'), 'audit');
  const overlap = findTaskTargetConflict({
    novelId: 'novel-001',
    chapterId: 'ch-003',
    conversationId: 'task-a',
    goal: '生成下一章',
    peers: [
      {
        conversationId: 'task-b',
        novelId: 'novel-001',
        title: '另一章生成',
        chapterId: 'ch-003',
      },
    ],
  });
  assert.equal(overlap?.code, 'TASK_TARGET_OVERLAP');
  assert.match(overlap?.message ?? '', /另一章生成/);
  const audit = findTaskTargetConflict({
    novelId: 'novel-001',
    chapterId: 'ch-003',
    conversationId: 'task-a',
    goal: '审计人物一致性',
    peers: [
      {
        conversationId: 'task-b',
        novelId: 'novel-001',
        title: '另一章生成',
        chapterId: 'ch-003',
      },
    ],
  });
  assert.equal(audit, undefined);
  const otherNovel = findTaskTargetConflict({
    novelId: 'novel-001',
    conversationId: 'task-a',
    goal: '生成下一章',
    peers: [{ conversationId: 'task-b', novelId: 'novel-002', title: '别的作品' }],
  });
  assert.equal(otherNovel, undefined);
});
