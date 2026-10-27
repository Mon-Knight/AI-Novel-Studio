import { describe, expect, test } from 'vitest';
import type { AiSettings } from '../../types/ai';
import type { ChapterWorkflowBindingV1 } from '../../types/chapterWorkflowBinding';
import type { ChapterGenerationSnapshot } from '../../types/generationContext';
import type { ChapterPlanningTaskExecutor } from '../../services/ai/chapterPlanningCandidate';
import { generateChapterScenePlanV2 } from '../../services/ai/chapterSceneOnlyPlanService';
import { generateSceneBeatPlan } from '../../services/ai/chapterSceneBeatPlanService';
import { extractActualBeatState } from '../../services/ai/chapterBeatStateService';
import { compileProductionAiExecution } from '../../services/ai/compilation/productionCompilationRegistry';
import { mockChapterStagedResponse } from '../../services/ai/mockChapterStagedResponses';
import { sha256 } from '../../services/ai/compilation/canonical';
import {
  CHAPTER_WORKFLOW_BINDING_START,
  CHAPTER_WORKFLOW_BINDING_END,
  renderChapterWorkflowBinding,
} from '../../services/generation/chapterWorkflowBinding';

const settings: AiSettings = {
  runtimeMode: 'api',
  provider: 'deepseek',
  modelName: 'deepseek-v4-flash',
  baseUrl: 'https://provider.example.invalid',
  apiKey: 'binding-test-only',
  temperature: 0.3,
  maxTokens: 4096,
  timeoutSeconds: 30,
  mockMode: false,
};
const baseBinding: ChapterWorkflowBindingV1 = {
  schemaVersion: 1,
  workflowId: 'user-turn-1',
  stageKey: 'scene_plan',
  inputHash: 'a'.repeat(64),
  planHash: 'b'.repeat(64),
};
function snapshot(): ChapterGenerationSnapshot {
  return {
    id: 'snapshot-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    contextHash: 'c'.repeat(64),
    compiledPromptText: '正式规则：证件被扣不能住宿；限知视角，不提前揭示接头人。',
    promptSummary: '冻结材料',
    sources: [],
    createdAt: '2026-10-20T00:00:00Z',
    compiledContext: {
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      baseContext: { novelTitle: '测试', chapterTitle: '第十二章', targetWordCount: 1200 },
      sections: [],
      sources: [],
      warnings: [],
      compiledAt: '2026-10-20T00:00:00Z',
    },
  };
}

describe('workflow-bound planning request compilation', () => {
  test('all three governed services put the same frozen binding into metadata and actual messages', async () => {
    const captured: Parameters<ChapterPlanningTaskExecutor>[0][] = [];
    const execute: ChapterPlanningTaskExecutor = async (input) => {
      captured.push(input);
      const contract = await compileProductionAiExecution({
        taskType: input.taskType,
        scope: { scopeType: input.scopeType, novelId: input.novelId, chapterId: input.chapterId },
        compilation: input.compilation,
        settings: input.settings,
        providerId: 'deepseek',
        modelId: settings.modelName,
      });
      const binding = input.compilation.taskInput?.chapterWorkflow as ChapterWorkflowBindingV1;
      const messages = contract.request.messages.map((message) => message.content);
      expect(
        messages.some((content) => content.includes(renderChapterWorkflowBinding(binding))),
      ).toBe(true);
      expect(messages.join('\n').split(CHAPTER_WORKFLOW_BINDING_START)).toHaveLength(2);
      expect(messages.join('\n').split(CHAPTER_WORKFLOW_BINDING_END)).toHaveLength(2);
      const body = await mockChapterStagedResponse(
        input.taskType,
        contract.request.messages,
        { chapterTitle: '第十二章', targetWords: 1200 },
        () => {
          throw new Error('unexpected mock fallback');
        },
      );
      return {
        persistence: 'ephemeral_browser',
        text: body,
        structuredPayloadJson: JSON.parse(body) as unknown,
        provider: {
          text: body,
          providerId: 'mock',
          modelId: 'fixed-test-model',
          durationMs: 0,
          finishReason: 'stop',
        },
      };
    };
    const scenePlan = await generateChapterScenePlanV2({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      operationId: 'bound-scenes',
      settings,
      snapshot: snapshot(),
      chapterWorkflow: baseBinding,
      execute,
    });
    const beatBinding = { ...baseBinding, stageKey: 'beat_plan:scene-1' };
    await generateSceneBeatPlan({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      operationId: 'bound-beats',
      settings,
      scene: scenePlan.scenes[0],
      sourceContext: snapshot().compiledPromptText,
      actual: { acceptedProse: '', actualEntryState: '主角抵达城门，守卫尚未放行。' },
      chapterWorkflow: beatBinding,
      execute,
    });
    const prose = '守卫扣下通行证，只准主角徒步入城。';
    const stateBinding = { ...baseBinding, stageKey: 'beat_state:scene-1:beat-1' };
    const result = await extractActualBeatState({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      operationId: 'bound-state',
      settings,
      prose,
      chapterWorkflow: stateBinding,
      execute,
    });
    expect(result.state.sourceTextHash).toBe(await sha256(prose));
    expect(captured).toHaveLength(3);
    expect(captured.map((input) => input.compilation.taskInput?.chapterWorkflow)).toEqual([
      baseBinding,
      beatBinding,
      stateBinding,
    ]);
    for (const input of captured) {
      const source = input.compilation.sources.find((item) =>
        item.content.includes(CHAPTER_WORKFLOW_BINDING_START),
      );
      expect(source).toMatchObject({
        required: true,
        requireFull: true,
        sourceType: 'request_context',
      });
    }
    const stateContext = JSON.parse(captured[2].compilation.sources[0].content) as Record<
      string,
      unknown
    >;
    expect(Object.keys(stateContext)).toEqual(['previousState', 'prose']);
  });

  test('invalid workflow identity is rejected before the provider executor', async () => {
    let calls = 0;
    const execute: ChapterPlanningTaskExecutor = async () => {
      calls += 1;
      throw new Error('must not dispatch');
    };
    const chapterWorkflow = { ...baseBinding, inputHash: 'weak' };
    await expect(
      generateChapterScenePlanV2({
        novelId: 'novel-1',
        chapterId: 'chapter-1',
        operationId: 'invalid-binding',
        settings,
        snapshot: snapshot(),
        chapterWorkflow,
        execute,
      }),
    ).rejects.toMatchObject({ code: 'CHAPTER_WORKFLOW_BINDING_INVALID' });
    await expect(
      extractActualBeatState({
        novelId: 'novel-1',
        chapterId: 'chapter-1',
        operationId: 'invalid-state-binding',
        settings,
        prose: '已写正文。',
        chapterWorkflow,
        execute,
      }),
    ).rejects.toMatchObject({ code: 'CHAPTER_WORKFLOW_BINDING_INVALID' });
    expect(calls).toBe(0);
  });
});
