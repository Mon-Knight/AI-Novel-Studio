import assert from 'node:assert/strict';
import test from 'node:test';
import { restoreDshRetry, taskRetryRecovery } from './taskRetryRecovery';
import type { TaskRuntimeInput } from '../conversation/taskRuntimeAdapter';

test('stage recovery restores frozen writing intent, model and range instead of replanning current prose', async () => {
  const original = taskRetryRecovery.resolve;
  const model = {
    providerId: 'frozen',
    modelId: 'real',
    runtimeMode: 'api' as const,
    capabilities: [],
    options: { maxTokens: 8000 },
    capturedAt: '2026-01-01',
  };
  const input: TaskRuntimeInput = {
    conversationId: 'c',
    novelId: 'n',
    turnId: 'u',
    chapterId: 'chapter',
    goal: '当前写法已经变化',
    retrySourceRunId: 'failed',
    explicitChapterRetry: true,
  };
  try {
    taskRetryRecovery.resolve = async (c, n, source) => {
      assert.deepEqual([c, n, source], ['c', 'n', 'failed']);
      return {
        sourceRunId: 'failed',
        turnId: 'u',
        chapterId: 'chapter',
        modelSnapshot: model,
        execution: {
          taskKind: 'chapter_write',
          expectedTool: 'generate_chapter',
          expectedArtifactType: 'chapter_text',
          requiredReadTools: [
            'novel.read_context',
            'chapter.read_outline',
            'get_character_states',
            'search_memory',
          ],
          goal: '生成本章正文\n原规划的完整指令',
          chapterWordRange: { minimum: 3060, target: 3400, maximum: 3740 },
        },
      };
    };
    const restored = await restoreDshRetry(input);
    assert.equal(restored.workflowAction, 'generate_chapter');
    assert.equal(restored.goal, '生成本章正文\n原规划的完整指令');
    assert.equal(restored.modelSnapshot, model);
    assert.equal(restored.retryExecution?.chapterWordRange?.minimum, 3060);
    assert.equal(restored.explicitChapterRetry, true);
    await assert.rejects(restoreDshRetry({ ...input, chapterId: 'other' }), /目标已变化/);
    await assert.rejects(restoreDshRetry({ ...input, turnId: 'other' }), /目标已变化/);
  } finally {
    taskRetryRecovery.resolve = original;
  }
});

test('missing native execution facts reject a retry instead of replanning its current goal', async () => {
  const original = taskRetryRecovery.resolve;
  try {
    taskRetryRecovery.resolve = async () => ({
      sourceRunId: 'failed',
      turnId: 'u',
      chapterId: 'chapter',
      modelSnapshot: {
        providerId: 'frozen',
        modelId: 'real',
        runtimeMode: 'api',
        capabilities: [],
        options: {},
        capturedAt: '2026-01-01',
      },
    });
    await assert.rejects(
      restoreDshRetry({
        conversationId: 'c',
        novelId: 'n',
        turnId: 'u',
        chapterId: 'chapter',
        goal: '重新写本章，目标改为2000字',
        retrySourceRunId: 'failed',
      }),
      /DSH_RETRY_SOURCE_INVALID.*执行契约/u,
    );
  } finally {
    taskRetryRecovery.resolve = original;
  }
});
