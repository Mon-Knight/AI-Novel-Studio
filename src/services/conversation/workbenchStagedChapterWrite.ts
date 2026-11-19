import type { AiSettings } from '../../types/ai';
import type { ScenePlanItem } from '../../types/chapterEngineering';
import type { ChapterGenerationSnapshot } from '../../types/generationContext';
import type { ChapterWritingWorkflowCheckpoint } from '../../types/chapterWritingWorkflow';
import { canonicalHash, sha256 } from '../ai/compilation/canonical';
import { executeAiTask, type AiExecutionResult } from '../ai/aiExecutionPipeline';
import { extractActualBeatState } from '../ai/chapterBeatStateService';
import { generateSceneBeatPlan } from '../ai/chapterSceneBeatPlanService';
import { narrativeCharacterCount } from '../ai/orchestrator/types';
import { isScenePlanV2 } from '../engineering/chapterEngineeringService';
import { inspectChapterCandidateIntegrity } from '../generation/chapterCandidateIntegrity';
import { runChapterWritingWorkflow } from '../generation/chapterWritingWorkflow';
import type { ChapterWritingWorkflowPorts } from '../generation/chapterWritingWorkflowPorts';
import { ChapterWritingWorkflowError } from '../generation/chapterWritingState';

const checkpoints = new Map<string, ChapterWritingWorkflowCheckpoint>();

/** The candidate must be the planned beats in order, not a rewritten whole chapter. */
export function assertStagedChapterOrder(input: {
  scenes: readonly { id: string }[];
  beatPlans: readonly { sceneId: string; beats: readonly { id: string }[] }[];
  prose: readonly { sceneId: string; beatId: string; text: string }[];
  text: string;
}): void {
  const expected: string[] = [];
  let proseIndex = 0;
  for (const scene of input.scenes) {
    const plan = input.beatPlans.find((item) => item.sceneId === scene.id);
    if (!plan?.beats.length) {
      throw new ChapterWritingWorkflowError(
        'CHAPTER_WORKFLOW_ORDER_INVALID',
        '章节候选缺少某个场景的 Beat 计划，拒绝整章拼装。',
      );
    }
    for (const beat of plan.beats) {
      const record = input.prose[proseIndex];
      if (!record || record.sceneId !== scene.id || record.beatId !== beat.id) {
        throw new ChapterWritingWorkflowError(
          'CHAPTER_WORKFLOW_ORDER_INVALID',
          '章节候选的正文顺序与 Scene/Beat 计划不一致。',
        );
      }
      expected.push(record.text);
      proseIndex += 1;
    }
  }
  if (proseIndex !== input.prose.length || input.text !== expected.join('\n\n')) {
    throw new ChapterWritingWorkflowError(
      'CHAPTER_WORKFLOW_ORDER_INVALID',
      '章节候选不是按顺序拼接的已校验 Beat 正文。',
    );
  }
}

export function stagedScenePlanFromSnapshot(
  snapshot: Pick<ChapterGenerationSnapshot, 'compiledContext'>,
): ScenePlanItem[] | undefined {
  const scenes = snapshot.compiledContext?.activeEngineeringState?.scenePlan;
  if (!scenes?.length) return undefined;
  if (
    scenes.some(
      (scene) =>
        !isScenePlanV2(scene) ||
        scene.beats.length > 0 ||
        !Number.isSafeInteger(scene.targetCharacters),
    )
  ) {
    return undefined;
  }
  return scenes;
}

export interface RunWorkbenchStagedChapterInput {
  novelId: string;
  chapterId: string;
  operationId: string;
  attemptId: string;
  authorizeResume?: boolean;
  settings: AiSettings;
  snapshot: ChapterGenerationSnapshot;
  signal?: AbortSignal;
  checkpoints?: Map<string, ChapterWritingWorkflowCheckpoint>;
  planBeats?: ChapterWritingWorkflowPorts['planBeats'];
  writeBeat?: ChapterWritingWorkflowPorts['writeBeat'];
  extractState?: ChapterWritingWorkflowPorts['extractState'];
  validateChapter?: ChapterWritingWorkflowPorts['validateChapter'];
}

/** Uses an applied Scene-only plan. It does not replace DSH whole-chapter writing. */
export async function runWorkbenchStagedChapter(
  input: RunWorkbenchStagedChapterInput,
): Promise<AiExecutionResult> {
  const scenes = stagedScenePlanFromSnapshot(input.snapshot);
  const sourceContext = input.snapshot.compiledPromptText?.trim() ?? '';
  if (!scenes || !sourceContext) {
    throw new ChapterWritingWorkflowError(
      'CHAPTER_WORKFLOW_PLAN_INVALID',
      '分阶段写章需要已应用的 Scene-only 计划和冻结章节资料。',
    );
  }
  const targetCharacters = scenes.reduce((sum, scene) => sum + (scene.targetCharacters ?? 0), 0);
  const contextHash = await sha256(sourceContext);
  const store = input.checkpoints ?? checkpoints;
  const key = `${input.novelId}\u0000${input.chapterId}\u0000${contextHash}`;
  const ports: ChapterWritingWorkflowPorts = {
    load: async () => store.get(key),
    save: async (next, expected) => {
      const current = store.get(key);
      if (expected === null ? current : current?.revision !== expected) {
        throw new ChapterWritingWorkflowError(
          'CHAPTER_WORKFLOW_STAGE_CONFLICT',
          '分阶段写章检查点已变化。',
        );
      }
      store.set(key, structuredClone(next));
    },
    assertBaseline: async () => undefined,
    planScenes: async () => ({ schemaVersion: 2, scenes }),
    planBeats:
      input.planBeats ??
      ((planInput) =>
        generateSceneBeatPlan({
          novelId: input.novelId,
          chapterId: input.chapterId,
          operationId: `${input.operationId}:beats:${planInput.scene.id}`,
          settings: input.settings,
          chapterTitle: input.snapshot.compiledContext.baseContext.chapterTitle,
          scene: planInput.scene,
          sourceContext,
          actual: {
            acceptedProse: planInput.acceptedProse,
            actualEntryState: planInput.actualEntryState,
          },
          remainingCalls: planInput.remainingCalls,
          signal: planInput.signal,
        })),
    writeBeat:
      input.writeBeat ??
      (async (beat) => {
        const execution = await executeAiTask({
          operationId: `${input.operationId}:${beat.scene.id}:${beat.beat.id}:${beat.attempt}`,
          taskType: 'chapter_scene_generate',
          scopeType: 'chapter',
          novelId: input.novelId,
          chapterId: input.chapterId,
          settings: input.settings,
          signal: beat.signal,
          compilation: {
            taskInput: {
              chapterTitle: input.snapshot.compiledContext.baseContext.chapterTitle,
              contextHash,
              sceneGoal: beat.fields.goal,
              sceneBeats: [beat.fields.beat],
              sceneConstraints: beat.fields.constraints,
            },
            sources: [
              {
                sourceType: 'request_context',
                sourceId: beat.beat.id,
                sourceVersion: await sha256(beat.fields.context),
                origin: 'request',
                label: '当前 Beat 的实际上下文',
                content: beat.fields.context,
                order: 0,
                priority: 100,
                required: true,
                requireFull: true,
                maxTokens: 24_000,
              },
            ],
          },
        });
        return {
          text: execution.text,
          finishReason: execution.provider.finishReason ?? '',
          taskId: execution.taskId,
          attemptId: execution.attemptId,
          artifactId: execution.artifactBundle?.artifact.artifactId,
        };
      }),
    validateBeat: (output, beat) => {
      const count = narrativeCharacterCount(output.text);
      const target = beat.beat.targetCharacters ?? 650;
      if (count < Math.max(500, target - 150) || count > Math.min(900, target + 150)) {
        throw new Error(`Beat 正文 ${count} 字，未落在本 Beat 预算附近。`);
      }
    },
    extractState:
      input.extractState ??
      (async (stateInput) => {
        const extracted = await extractActualBeatState({
          novelId: input.novelId,
          chapterId: input.chapterId,
          operationId: `${input.operationId}:state:${stateInput.sourceTextHash.slice(0, 12)}`,
          settings: input.settings,
          prose: stateInput.prose,
          previousState: stateInput.previousState
            ? JSON.stringify(stateInput.previousState)
            : undefined,
          signal: stateInput.signal,
        });
        return extracted.state;
      }),
    validateChapter:
      input.validateChapter ??
      ((text) => {
        const issues = inspectChapterCandidateIntegrity({ candidateText: text });
        if (issues.some((issue) => issue.severity === 'error')) {
          throw new ChapterWritingWorkflowError(
            'WORKBENCH_CHAPTER_INTEGRITY_FAILED',
            '分阶段章节候选未通过完整性检查，未改写整章。',
          );
        }
      }),
  };
  const result = await runChapterWritingWorkflow(
    {
      identity: {
        schemaVersion: 'chapter_writing_workflow_v1',
        workflowId: `workbench:${input.novelId}:${input.chapterId}`,
        novelId: input.novelId,
        chapterId: input.chapterId,
        contextHash,
        modelSnapshotHash: await canonicalHash({
          provider: input.settings.provider,
          model: input.settings.modelName,
        }),
      },
      attemptId: input.attemptId,
      authorizeResume: input.authorizeResume,
      sourceContext,
      targetCharacters,
      chapterConstraints: [],
      budget: { maxCalls: 48, maxWallClockMs: 480_000, maxBeatAttempts: 2, maxBeats: 24 },
      signal: input.signal,
    },
    ports,
  );
  assertStagedChapterOrder({
    scenes: result.checkpoint.scenePlan?.scenes ?? [],
    beatPlans: result.checkpoint.beatPlans,
    prose: result.checkpoint.prose,
    text: result.text,
  });
  return {
    persistence: 'sqlite',
    text: result.text,
    provider: {
      text: result.text,
      providerId: input.settings.provider,
      modelId: input.settings.modelName,
      finishReason: 'stop',
      durationMs: 0,
    },
  };
}
