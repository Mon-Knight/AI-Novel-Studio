import { webcrypto } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import type { AiSettings } from '../../types/ai';
import type { ChapterGenerationSnapshot } from '../../types/generationContext';
import type { AiExecutionResult } from '../../services/ai/aiExecutionPipeline';
import type { ChapterPlanningTaskExecutor } from '../../services/ai/chapterPlanningCandidate';
import {
  CHAPTER_SCENE_PLAN_V2_TASK_TYPE,
  generateChapterScenePlanV2,
  normalizeChapterScenePlanV2Candidate,
  parseChapterScenePlanV2Candidate,
} from '../../services/ai/chapterSceneOnlyPlanService';

vi.stubGlobal('crypto', webcrypto);

const settings: AiSettings = {
  runtimeMode: 'api',
  provider: 'deepseek',
  baseUrl: 'https://provider.example.invalid',
  apiKey: 'planning-test-secret',
  modelName: 'deepseek-v4-flash',
  temperature: 0.4,
  maxTokens: 4096,
  timeoutSeconds: 30,
  mockMode: false,
};

function snapshot(overrides: Partial<ChapterGenerationSnapshot> = {}): ChapterGenerationSnapshot {
  return {
    id: 'snapshot-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    contextHash: 'a'.repeat(64),
    compiledPromptText: '冻结章节上下文：城门盘查与客栈接头。',
    promptSummary: 'summary',
    sources: [],
    createdAt: '2026-10-19T00:00:00.000Z',
    compiledContext: {
      chapterId: 'chapter-1',
      novelId: 'novel-1',
      baseContext: {
        novelTitle: '测试小说',
        chapterTitle: '第十二章 城门',
        targetWordCount: 2_000,
      },
      sections: [],
      sources: [],
      warnings: [],
      compiledAt: '2026-10-19T00:00:00.000Z',
    },
    ...overrides,
  };
}

function executionResult(text: string): AiExecutionResult {
  return {
    persistence: 'ephemeral_browser',
    text,
    provider: {
      text,
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      durationMs: 1,
    },
    structuredPayloadJson: JSON.parse(text) as unknown,
  };
}

const scenesPayload = JSON.stringify({
  scenes: [
    {
      sceneNo: 1,
      title: '城门盘查',
      contextCapsule: '沈岚带着木匣抵达城门。',
      location: '城门',
      characters: ['沈岚'],
      goal: '通过盘查',
      conflict: '守卫索要路引',
      constraints: ['保持第三人称限知'],
      expectedEndState: '沈岚进入城门，但守卫记住了她的脸。',
      result: '进入城内',
      transition: '转入客栈',
      targetCharacters: 800,
    },
    {
      sceneNo: 2,
      title: '客栈接头',
      contextCapsule: '沈岚进入客栈寻找接头人。',
      location: '客栈',
      characters: ['沈岚', '掌柜'],
      goal: '确认接头暗号',
      conflict: '掌柜试探',
      constraints: ['不提前揭示接头人身份'],
      expectedEndState: '沈岚确认暗号有效。',
      result: '完成接头',
      transition: '转入下一章',
    },
  ],
});

describe('Scene-only v2 planning', () => {
  test('normalizes Scene-only candidates, fills missing targets and keeps Beats empty', () => {
    const parsed = parseChapterScenePlanV2Candidate(`\`\`\`json\n${scenesPayload}\n\`\`\``);
    expect(parsed).toBeDefined();
    const plan = normalizeChapterScenePlanV2Candidate(parsed!, undefined, 2_000);
    expect(plan.schemaVersion).toBe(2);
    expect(plan.scenes).toHaveLength(2);
    expect(plan.scenes.map((scene) => scene.planVersion)).toEqual([2, 2]);
    expect(plan.scenes.map((scene) => scene.beats)).toEqual([[], []]);
    expect(plan.scenes[0].targetCharacters).toBe(800);
    expect(plan.scenes[1].targetCharacters).toBeGreaterThan(0);
    expect(plan.scenes[1].targetCharacters).toBe(1_200);
  });

  test('distributes remainder without changing the chapter total and rejects inconsistent budgets', () => {
    const source = JSON.parse(scenesPayload) as { scenes: Array<Record<string, unknown>> };
    const missing = Array.from({ length: 3 }, (_, index) => {
      const value: Record<string, unknown> = { ...source.scenes[0], sceneNo: index + 1 };
      delete value.targetCharacters;
      return value;
    });
    const plan = normalizeChapterScenePlanV2Candidate({ scenes: missing }, undefined, 2_000);
    expect(plan.scenes.map((scene) => scene.targetCharacters)).toEqual([667, 667, 666]);
    expect(plan.scenes.reduce((sum, scene) => sum + scene.targetCharacters!, 0)).toBe(2_000);
    const inconsistent = source.scenes.map((scene) => ({ ...scene, targetCharacters: 800 }));
    expect(() =>
      normalizeChapterScenePlanV2Candidate({ scenes: inconsistent }, undefined, 2_000),
    ).toThrow(/总和必须等于章节目标/u);
    source.scenes[0].targetCharacters = 2_500;
    expect(() => normalizeChapterScenePlanV2Candidate(source, undefined, 2_000)).toThrow(
      /剩余章节预算不足/u,
    );
  });

  test('rejects v2 model output that already contains Beats', () => {
    const payload = JSON.parse(scenesPayload) as { scenes: Array<Record<string, unknown>> };
    payload.scenes[0].beats = [{ order: 1, text: '提前细化', required: true }];
    expect(() =>
      normalizeChapterScenePlanV2Candidate({ scenes: payload.scenes }, undefined, 2_000),
    ).toThrow(/不得提前包含 Beats/u);
  });

  test('rejects a Scene missing required planning fields', () => {
    const payload = JSON.parse(scenesPayload) as { scenes: Array<Record<string, unknown>> };
    delete payload.scenes[0].expectedEndState;
    expect(() =>
      normalizeChapterScenePlanV2Candidate({ scenes: payload.scenes }, undefined, 2_000),
    ).toThrow(/expectedEndState/u);
  });

  test('governance input carries the frozen context as a required full source', async () => {
    let captured: Parameters<ChapterPlanningTaskExecutor>[0] | undefined;
    const execute: ChapterPlanningTaskExecutor = async (input) => {
      captured = input;
      return executionResult(scenesPayload);
    };
    const result = await generateChapterScenePlanV2({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      operationId: 'scene-plan-v2',
      settings,
      snapshot: snapshot(),
      execute,
    });

    expect(result.schemaVersion).toBe(2);
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes.every((scene) => scene.beats.length === 0)).toBe(true);
    expect(captured?.taskType).toBe(CHAPTER_SCENE_PLAN_V2_TASK_TYPE);
    expect(captured?.compilation.sources).toHaveLength(1);
    expect(captured?.compilation.sources[0]).toMatchObject({
      sourceType: 'request_context',
      required: true,
      requireFull: true,
    });
    expect(captured?.compilation.sources[0].content).toContain('城门盘查');
    expect(captured?.compilation.taskInput).toMatchObject({
      chapterTitle: '第十二章 城门',
      targetWordCount: 2_000,
      scenePlanVersion: 2,
      maxScenes: 12,
    });
  });

  test('retries invalid Scene-only output exactly within the bounded attempts', async () => {
    let calls = 0;
    const execute: ChapterPlanningTaskExecutor = async () => {
      calls += 1;
      if (calls === 1) {
        const invalid = JSON.parse(scenesPayload) as { scenes: Array<Record<string, unknown>> };
        invalid.scenes[0].beats = [{ order: 1, text: '提前细化', required: true }];
        return executionResult(JSON.stringify(invalid));
      }
      return executionResult(scenesPayload);
    };
    const result = await generateChapterScenePlanV2({
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      operationId: 'scene-plan-v2-retry',
      settings,
      snapshot: snapshot(),
      execute,
    });
    expect(calls).toBe(2);
    expect(result.scenes).toHaveLength(2);
  });

  test('fails before any Provider call when the frozen context is empty', async () => {
    let calls = 0;
    const execute: ChapterPlanningTaskExecutor = async () => {
      calls += 1;
      return executionResult(scenesPayload);
    };
    await expect(
      generateChapterScenePlanV2({
        novelId: 'novel-1',
        chapterId: 'chapter-1',
        operationId: 'scene-plan-v2-missing-context',
        settings,
        snapshot: snapshot({ compiledPromptText: '   ' }),
        execute,
      }),
    ).rejects.toMatchObject({ code: 'CHAPTER_SCENE_PLAN_V2_CONTEXT_MISSING' });
    expect(calls).toBe(0);
  });
});
