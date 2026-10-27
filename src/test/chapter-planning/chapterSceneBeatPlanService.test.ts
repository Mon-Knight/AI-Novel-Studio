import { webcrypto } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import type { AiSettings } from '../../types/ai';
import { SCENE_PLAN_VERSION_V2, type ScenePlanItem } from '../../types/chapterEngineering';
import type { AiExecutionResult } from '../../services/ai/aiExecutionPipeline';
import type { ChapterPlanningTaskExecutor } from '../../services/ai/chapterPlanningCandidate';
import {
  CHAPTER_BEAT_PLAN_TASK_TYPE,
  generateSceneBeatPlan,
  type GenerateSceneBeatPlanInput,
} from '../../services/ai/chapterSceneBeatPlanService';
import { canonicalHash, sha256 } from '../../services/ai/compilation/canonical';

vi.stubGlobal('crypto', webcrypto);

const settings: AiSettings = {
  runtimeMode: 'api',
  provider: 'deepseek',
  baseUrl: 'https://provider.example.invalid',
  apiKey: 'planning-test-secret',
  modelName: 'deepseek-v4-flash',
  temperature: 0.45,
  maxTokens: 3072,
  timeoutSeconds: 30,
  mockMode: false,
};

function scene(overrides: Partial<ScenePlanItem> = {}): ScenePlanItem {
  return {
    id: 'scene-1',
    sceneNo: 1,
    title: '城门盘查',
    location: '城门',
    characters: ['沈岚'],
    goal: '通过盘查',
    conflict: '守卫索要路引',
    keyActions: [],
    keyDialogue: '',
    informationRelease: ['路引上的印章有异'],
    result: '进入城内',
    transition: '转入客栈',
    beats: [],
    contextCapsule: '沈岚带着不能示人的木匣抵达城门。',
    constraints: ['保持第三人称限知'],
    expectedEndState: '沈岚进入城门，但守卫记住了她的脸。',
    targetCharacters: 2_500,
    planVersion: SCENE_PLAN_VERSION_V2,
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

function beatPayload(count: number): string {
  return JSON.stringify({
    beats: Array.from({ length: count }, (_, index) => ({
      order: index + 1,
      text: `第 ${index + 1} 个 Beat 的事件要求`,
      required: true,
      stateChange: `第 ${index + 1} 个 Beat 的计划变化`,
      ...(index > 0 ? { startState: `第 ${index} 个 Beat 完成后的状态` } : {}),
    })),
  });
}

interface PlanOverrides {
  scene?: ScenePlanItem;
  sourceContext?: string;
  acceptedProse?: string;
  actualEntryState?: string;
  remainingCalls?: number;
}

async function runPlan(overrides: PlanOverrides = {}) {
  const captured: { input?: Parameters<ChapterPlanningTaskExecutor>[0] } = {};
  const execute: ChapterPlanningTaskExecutor = async (input) => {
    captured.input = input;
    return executionResult(beatPayload(4));
  };
  const input: GenerateSceneBeatPlanInput = {
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    operationId: 'beat-plan-1',
    settings,
    chapterTitle: '第十二章 城门',
    scene: overrides.scene ?? scene(),
    sourceContext:
      overrides.sourceContext ??
      '世界观：灵气复苏。视角：沈岚。人物：沈岚只信任掌柜。信息边界：不得提前揭示接头人身份。',
    actual: {
      acceptedProse: overrides.acceptedProse ?? '沈岚沿着雨后的长街走向城门。',
      actualEntryState: overrides.actualEntryState ?? '沈岚抵达城门外，木匣仍在手中。',
    },
    remainingCalls: overrides.remainingCalls,
    execute,
  };
  const result = await generateSceneBeatPlan(input);
  return { result, captured: captured.input, scene: input.scene };
}

describe('Scene Beat planning', () => {
  test('returns a hash-bound plan with exactly the dynamic Beat count', async () => {
    const { result, captured, scene: plannedScene } = await runPlan();
    const acceptedProse = '沈岚沿着雨后的长街走向城门。';
    const entryState = '沈岚抵达城门外，木匣仍在手中。';
    const sourceContext =
      '世界观：灵气复苏。视角：沈岚。人物：沈岚只信任掌柜。信息边界：不得提前揭示接头人身份。';

    expect(result.schemaVersion).toBe(1);
    expect(result.sceneId).toBe('scene-1');
    expect(result.beats).toHaveLength(4);
    expect(result.previousTextHash).toBe(await sha256(acceptedProse));
    expect(result.sourceContextHash).toBe(await sha256(sourceContext));
    expect(result.inputStateHash).toBe(await sha256(entryState));
    expect(result.planHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(result.planHash).toBe(
      await canonicalHash({
        schemaVersion: 1,
        scene: plannedScene,
        sourceContextHash: result.sourceContextHash,
        previousTextHash: result.previousTextHash,
        inputStateHash: result.inputStateHash,
        beats: result.beats,
      }),
    );
    expect(
      result.beats
        .map((beat) => beat.targetCharacters ?? 0)
        .reduce<number>((sum, value) => sum + value, 0),
    ).toBe(2_500);
    expect(
      result.beats.every(
        (beat) => (beat.targetCharacters ?? 0) >= 500 && (beat.targetCharacters ?? 0) <= 900,
      ),
    ).toBe(true);
    expect(result.beats[0].startState).toBe(entryState);
    expect(captured?.taskType).toBe(CHAPTER_BEAT_PLAN_TASK_TYPE);
  });

  test('sends the frozen baseline and marked actual prefix as required sources', async () => {
    const acceptedProse = `旧正文开头。${'甲'.repeat(2_500)}`;
    const { captured } = await runPlan({ acceptedProse });
    expect(captured?.compilation.sources).toHaveLength(2);
    expect(captured?.compilation.sources[0]).toMatchObject({
      sourceType: 'request_context',
      required: true,
      requireFull: true,
    });
    expect(captured?.compilation.sources[0].content).toContain('灵气复苏');
    expect(captured?.compilation.sources[1]).toMatchObject({
      sourceType: 'request_context',
      required: true,
      requireFull: true,
    });
    expect(captured?.compilation.sources[1].content).toContain('已截断');
    expect(captured?.compilation.sources[1].content).toContain('acceptedProseTruncated');
    expect(captured?.compilation.sources[1].content).toContain(await sha256(acceptedProse));
  });

  test('planHash is deterministic for an unchanged plan and binds all inputs', async () => {
    const base = await runPlan();
    const repeated = await runPlan();
    const changedProse = await runPlan({ acceptedProse: '另一段实际正文。' });
    const changedScene = await runPlan({ scene: scene({ goal: '强行闯门' }) });
    const changedBaseline = await runPlan({ sourceContext: '另一份冻结基线。' });

    expect(repeated.result.planHash).toBe(base.result.planHash);
    expect(changedProse.result.planHash).not.toBe(base.result.planHash);
    expect(changedScene.result.planHash).not.toBe(base.result.planHash);
    expect(changedBaseline.result.planHash).not.toBe(base.result.planHash);
  });

  test('rejects legacy merged scenes instead of overwriting their Beats', async () => {
    let calls = 0;
    const execute: ChapterPlanningTaskExecutor = async () => {
      calls += 1;
      return executionResult(beatPayload(4));
    };
    await expect(
      generateSceneBeatPlan({
        novelId: 'novel-1',
        chapterId: 'chapter-1',
        operationId: 'beat-plan-legacy',
        settings,
        scene: scene({ planVersion: undefined }),
        sourceContext: 'baseline',
        actual: { acceptedProse: '', actualEntryState: '起点' },
        execute,
      }),
    ).rejects.toMatchObject({ code: 'CHAPTER_BEAT_PLAN_SCENE_INVALID' });
    expect(calls).toBe(0);
  });

  test('fails before a Provider call when the remaining call budget cannot cover the Scene', async () => {
    let calls = 0;
    const execute: ChapterPlanningTaskExecutor = async () => {
      calls += 1;
      return executionResult(beatPayload(4));
    };
    await expect(
      generateSceneBeatPlan({
        novelId: 'novel-1',
        chapterId: 'chapter-1',
        operationId: 'beat-plan-budget',
        settings,
        scene: scene(),
        sourceContext: 'baseline',
        actual: { acceptedProse: '', actualEntryState: '起点' },
        remainingCalls: 2,
        execute,
      }),
    ).rejects.toMatchObject({ code: 'CHAPTER_BEAT_PLAN_CALL_BUDGET_INSUFFICIENT' });
    expect(calls).toBe(0);
  });

  test('fails before a Provider call when a Scene target is below the single-Beat envelope', async () => {
    let calls = 0;
    const execute: ChapterPlanningTaskExecutor = async () => {
      calls += 1;
      return executionResult(beatPayload(1));
    };
    await expect(
      generateSceneBeatPlan({
        novelId: 'novel-1',
        chapterId: 'chapter-1',
        operationId: 'beat-plan-under-envelope',
        settings,
        scene: scene({ targetCharacters: 400 }),
        sourceContext: 'baseline',
        actual: { acceptedProse: '', actualEntryState: '起点' },
        execute,
      }),
    ).rejects.toMatchObject({ code: 'CHAPTER_BEAT_POLICY_INVALID' });
    expect(calls).toBe(0);
  });

  test('rejects missing Beat start state or state change instead of silently using legacy defaults', async () => {
    for (const field of ['startState', 'stateChange'] as const) {
      let calls = 0;
      const value = JSON.parse(beatPayload(4)) as { beats: Array<Record<string, unknown>> };
      delete value.beats[1][field];
      const execute: ChapterPlanningTaskExecutor = async () => {
        calls += 1;
        return executionResult(JSON.stringify(value));
      };
      await expect(
        generateSceneBeatPlan({
          novelId: 'novel-1',
          chapterId: 'chapter-1',
          operationId: `missing-${field}`,
          settings,
          scene: scene(),
          sourceContext: '冻结规则',
          actual: { acceptedProse: '', actualEntryState: '实际入口' },
          execute,
        }),
      ).rejects.toMatchObject({ code: 'CHAPTER_BEAT_PLAN_INVALID' });
      expect(calls).toBe(3);
    }
  });

  test('retries an invalid Beat count and fails closed after bounded attempts', async () => {
    let calls = 0;
    const execute: ChapterPlanningTaskExecutor = async () => {
      calls += 1;
      return executionResult(beatPayload(3));
    };
    await expect(
      generateSceneBeatPlan({
        novelId: 'novel-1',
        chapterId: 'chapter-1',
        operationId: 'beat-plan-retry',
        settings,
        scene: scene(),
        sourceContext: 'baseline',
        actual: { acceptedProse: '', actualEntryState: '起点' },
        execute,
      }),
    ).rejects.toMatchObject({ code: 'CHAPTER_BEAT_PLAN_INVALID' });
    expect(calls).toBe(3);
  });
});
