import type { ChapterScenePlanV2, SceneBeatPlan } from '../../types/chapterWritingWorkflow';
import { canonicalHash, sha256 } from '../ai/compilation/canonical';
import { ChapterWritingWorkflowError, validateActualBeatState } from './chapterWritingState';
import {
  actualSceneEntry,
  buildWorkflowBeatFields,
  sceneBeatPlanHash,
  sceneBeatPlanSources,
} from './chapterWritingWorkflowContext';
import type {
  ChapterWritingWorkflowPorts,
  RunChapterWritingWorkflowInput,
} from './chapterWritingWorkflowPorts';
import type { ChapterWritingWorkflowCheckpoint } from '../../types/chapterWritingWorkflow';

export function workflowFailure(code: string, message: string): never {
  throw new ChapterWritingWorkflowError(code, message);
}

export function assertWorkflowScenePlan(plan: ChapterScenePlanV2): void {
  if (
    plan.schemaVersion !== 2 ||
    !Array.isArray(plan.scenes) ||
    !plan.scenes.length ||
    plan.scenes.length > 12
  ) {
    workflowFailure('CHAPTER_WORKFLOW_PLAN_INVALID', '需要 1–12 个 Scene-only v2 场景。');
  }
  const ids = new Set<string>();
  for (const [index, scene] of plan.scenes.entries()) {
    if (
      !scene.id ||
      ids.has(scene.id) ||
      scene.sceneNo !== index + 1 ||
      scene.planVersion !== 2 ||
      !Array.isArray(scene.beats) ||
      scene.beats.length !== 0 ||
      !scene.goal.trim() ||
      !Number.isSafeInteger(scene.targetCharacters) ||
      (scene.targetCharacters ?? 0) < 1
    )
      workflowFailure(
        'CHAPTER_WORKFLOW_PLAN_INVALID',
        '场景身份、顺序、字数或延迟 Beat 规划状态无效。',
      );
    ids.add(scene.id);
  }
}

export async function assertWorkflowBeatPlan(input: {
  plan: SceneBeatPlan;
  scene: ChapterScenePlanV2['scenes'][number];
  sourceContext: string;
  previousText: string;
  actualEntryState: string;
  maximumBeats: number;
}): Promise<void> {
  const { plan, scene } = input;
  const sources = await sceneBeatPlanSources(
    input.sourceContext,
    input.previousText,
    input.actualEntryState,
  );
  if (
    plan.schemaVersion !== 1 ||
    plan.sceneId !== scene.id ||
    plan.sourceContextHash !== sources.sourceContextHash ||
    plan.previousTextHash !== sources.previousTextHash ||
    plan.inputStateHash !== sources.inputStateHash ||
    !Array.isArray(plan.beats) ||
    !plan.beats.length ||
    plan.beats.length > input.maximumBeats
  )
    workflowFailure('CHAPTER_WORKFLOW_BEAT_PLAN_INVALID', 'Beat 计划的来源、作用域或数量不匹配。');
  const ids = new Set<string>();
  for (const [index, beat] of plan.beats.entries()) {
    if (
      !beat.id ||
      ids.has(beat.id) ||
      beat.order !== index + 1 ||
      !beat.text.trim() ||
      typeof beat.required !== 'boolean' ||
      !beat.startState?.trim() ||
      !beat.stateChange?.trim() ||
      !Number.isSafeInteger(beat.targetCharacters) ||
      (beat.targetCharacters ?? 0) < 1
    ) {
      workflowFailure(
        'CHAPTER_WORKFLOW_BEAT_PLAN_INVALID',
        'Beat 身份、顺序、入口、变化和字数必须完整且有效。',
      );
    }
    ids.add(beat.id);
  }
  if (
    plan.beats.reduce((sum, beat) => sum + beat.targetCharacters!, 0) !== scene.targetCharacters
  ) {
    workflowFailure('CHAPTER_WORKFLOW_BEAT_PLAN_INVALID', 'Beat 预算总和与当前 Scene 不一致。');
  }
  if (plan.planHash !== (await sceneBeatPlanHash(scene, plan))) {
    workflowFailure('CHAPTER_WORKFLOW_BEAT_PLAN_INVALID', 'Beat 计划哈希不匹配。');
  }
}

/** Recheck every persisted unit; a stored success label is never enough to reuse prose. */
export async function validateWorkflowCheckpoint(
  checkpoint: ChapterWritingWorkflowCheckpoint,
  input: RunChapterWritingWorkflowInput,
  ports: ChapterWritingWorkflowPorts,
): Promise<void> {
  const requestHash = await canonicalHash({
    identity: input.identity,
    budget: input.budget,
    targetCharacters: input.targetCharacters,
    chapterConstraints: input.chapterConstraints,
  });
  if (
    checkpoint.requestHash !== requestHash ||
    (await canonicalHash(checkpoint.identity)) !== (await canonicalHash(input.identity)) ||
    (await canonicalHash(checkpoint.budget)) !== (await canonicalHash(input.budget)) ||
    !Number.isSafeInteger(checkpoint.revision) ||
    checkpoint.revision < 0 ||
    !Number.isSafeInteger(checkpoint.callsUsed) ||
    checkpoint.callsUsed < 0 ||
    checkpoint.callsUsed > checkpoint.budget.maxCalls ||
    !Number.isFinite(checkpoint.startedAt) ||
    checkpoint.startedAt < 0 ||
    !checkpoint.attemptId ||
    !['running', 'waiting_retry', 'cancelled', 'completed'].includes(checkpoint.status) ||
    !Array.isArray(checkpoint.beatPlans) ||
    !Array.isArray(checkpoint.prose) ||
    !Array.isArray(checkpoint.scenes) ||
    !Array.isArray(checkpoint.stages) ||
    !Array.isArray(checkpoint.attemptHistory)
  )
    workflowFailure('CHAPTER_WORKFLOW_BASELINE_MISMATCH', '恢复身份、约束、字数或预算发生变化。');
  if (!checkpoint.scenePlan) {
    if (
      checkpoint.status === 'completed' ||
      checkpoint.beatPlans.length ||
      checkpoint.prose.length ||
      checkpoint.scenes.length
    ) {
      workflowFailure('CHAPTER_WORKFLOW_CHECKPOINT_INVALID', '缺失场景计划却存在后续执行记录。');
    }
    return;
  }
  assertWorkflowScenePlan(checkpoint.scenePlan);
  if (checkpoint.scenePlanHash !== (await canonicalHash(checkpoint.scenePlan))) {
    workflowFailure('CHAPTER_WORKFLOW_CHECKPOINT_INVALID', '场景计划哈希不匹配。');
  }
  const expected = checkpoint.scenePlan.scenes;
  const prefix: ChapterWritingWorkflowCheckpoint = {
    ...checkpoint,
    prose: [],
    scenes: [],
    beatPlans: [],
  };
  let recordIndex = 0;
  for (const [sceneIndex, plan] of checkpoint.beatPlans.entries()) {
    const scene = expected[sceneIndex];
    if (
      !scene ||
      (sceneIndex > 0 &&
        !prefix.scenes.some((item) => item.sceneId === expected[sceneIndex - 1].id))
    ) {
      workflowFailure('CHAPTER_WORKFLOW_CHECKPOINT_INVALID', '后场 Beat 计划早于前场实际收束。');
    }
    await assertWorkflowBeatPlan({
      plan,
      scene,
      sourceContext: input.sourceContext,
      previousText: prefix.prose.map((item) => item.text).join('\n\n'),
      actualEntryState: actualSceneEntry(prefix, scene),
      maximumBeats: input.budget.maxBeats,
    });
    prefix.beatPlans.push(plan);
    for (const beat of plan.beats) {
      const record = checkpoint.prose[recordIndex];
      if (!record) break;
      if (
        record.sceneId !== scene.id ||
        record.beatId !== beat.id ||
        record.planHash !== plan.planHash ||
        record.finishReason !== 'stop' ||
        record.contentHash !== (await sha256(record.text)) ||
        record.previousTextHash !==
          (await sha256(prefix.prose.map((item) => item.text).join('\n\n'))) ||
        (prefix.prose.length > 0 && !prefix.prose[prefix.prose.length - 1].actualState)
      ) {
        workflowFailure(
          'CHAPTER_WORKFLOW_CHECKPOINT_INVALID',
          '正文片段非连续、来源漂移或尚无实际状态。',
        );
      }
      await ports.validateBeat(record, {
        scene,
        beat,
        plan,
        previousText: prefix.prose.map((item) => item.text).join('\n\n'),
        fields: buildWorkflowBeatFields({
          checkpoint: prefix,
          sourceContext: input.sourceContext,
          chapterConstraints: input.chapterConstraints,
          scene,
          plan,
          beat,
        }),
        attempt: 0,
      });
      if (record.actualState) await validateActualBeatState(record.actualState, record.text);
      prefix.prose.push(record);
      recordIndex += 1;
    }
    const closed = checkpoint.scenes.find((item) => item.sceneId === scene.id);
    if (closed) {
      const records = prefix.prose.filter((item) => item.sceneId === scene.id);
      const last = records[records.length - 1];
      if (
        records.length !== plan.beats.length ||
        records.some((item) => !item.actualState) ||
        closed.planHash !== plan.planHash ||
        closed.contentHash !== (await sha256(records.map((item) => item.text).join('\n\n'))) ||
        (await canonicalHash(closed.beatIds)) !==
          (await canonicalHash(records.map((item) => item.beatId))) ||
        (await canonicalHash(closed.actualEndState)) !==
          (await canonicalHash(last.actualState!.endState))
      ) {
        workflowFailure('CHAPTER_WORKFLOW_CHECKPOINT_INVALID', '场景收束与实际正文不一致。');
      }
      prefix.scenes.push(closed);
    }
  }
  if (
    recordIndex !== checkpoint.prose.length ||
    prefix.scenes.length !== checkpoint.scenes.length
  ) {
    workflowFailure('CHAPTER_WORKFLOW_CHECKPOINT_INVALID', '存在未绑定计划的正文或场景结果。');
  }
  if (
    checkpoint.status === 'completed' &&
    (checkpoint.scenes.length !== expected.length ||
      checkpoint.assembledTextHash !==
        (await sha256(checkpoint.prose.map((item) => item.text).join('\n\n'))))
  ) {
    workflowFailure('CHAPTER_WORKFLOW_CHECKPOINT_INVALID', '完成标记没有完整的实际章节结果。');
  }
}
