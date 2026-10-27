import type {
  BeatProseRecord,
  ChapterScenePlanV2,
  ChapterWritingWorkflowCheckpoint,
  SceneBeatPlan,
  SceneExecutionRecord,
} from '../../types/chapterWritingWorkflow';
import { canonicalHash, sha256 } from '../ai/compilation/canonical';
import { ChapterWritingWorkflowError, validateActualBeatState } from './chapterWritingState';
import {
  acceptedWorkflowProse,
  actualSceneEntry,
  buildWorkflowBeatFields,
} from './chapterWritingWorkflowContext';
import type {
  ChapterWritingWorkflowPorts,
  ChapterWritingWorkflowSession,
  RunChapterWritingWorkflowInput,
  WorkflowBeatInput,
} from './chapterWritingWorkflowPorts';
import { openChapterWritingWorkflow } from './chapterWritingWorkflowSession';
import { executeWorkflowStage } from './chapterWritingWorkflowStages';
import {
  assertWorkflowBeatPlan,
  assertWorkflowScenePlan,
  workflowFailure,
} from './chapterWritingWorkflowValidation';

async function writeWorkflowBeat(
  session: ChapterWritingWorkflowSession,
  beatInput: WorkflowBeatInput,
): Promise<void> {
  for (let attempt = 1; attempt <= session.input.budget.maxBeatAttempts; attempt += 1) {
    try {
      await executeWorkflowStage(
        session,
        { kind: 'beat_write', sceneId: beatInput.scene.id, beatId: beatInput.beat.id },
        {
          planHash: beatInput.plan.planHash,
          previousText: beatInput.previousText,
          fields: beatInput.fields,
        },
        async (): Promise<BeatProseRecord> => {
          const output = await session.ports.writeBeat({ ...beatInput, attempt });
          const text = output.text.trim();
          if (!text || output.finishReason !== 'stop') {
            workflowFailure('CHAPTER_BEAT_TEXT_REJECTED', 'Beat 正文为空或模型未正常收束。');
          }
          try {
            await session.ports.validateBeat({ ...output, text }, { ...beatInput, attempt });
          } catch {
            workflowFailure(
              'CHAPTER_BEAT_TEXT_REJECTED',
              '当前 Beat 未通过正文验收，请在原边界内完整修正。',
            );
          }
          return {
            sceneId: beatInput.scene.id,
            beatId: beatInput.beat.id,
            planHash: beatInput.plan.planHash,
            previousTextHash: await sha256(beatInput.previousText),
            text,
            contentHash: await sha256(text),
            finishReason: 'stop',
            ...(output.taskId ? { taskId: output.taskId } : {}),
            ...(output.attemptId ? { attemptId: output.attemptId } : {}),
            ...(output.artifactId ? { artifactId: output.artifactId } : {}),
          };
        },
        (next, record) => {
          next.prose.push(structuredClone(record));
        },
      );
      return;
    } catch (error) {
      if (
        !(error instanceof ChapterWritingWorkflowError) ||
        error.code !== 'CHAPTER_BEAT_TEXT_REJECTED' ||
        attempt === session.input.budget.maxBeatAttempts ||
        session.input.signal?.aborted
      )
        throw error;
    }
  }
}

async function executeScene(
  session: ChapterWritingWorkflowSession,
  sceneIndex: number,
): Promise<void> {
  const { input, ports } = session;
  const scene = session.checkpoint.scenePlan!.scenes[sceneIndex];
  let plan = session.checkpoint.beatPlans.find((item) => item.sceneId === scene.id);
  if (!plan) {
    const previousText = acceptedWorkflowProse(session.checkpoint);
    const entry = actualSceneEntry(session.checkpoint, scene);
    plan = await executeWorkflowStage(
      session,
      { kind: 'beat_plan', sceneId: scene.id },
      {
        scene,
        previousText,
        actualEntryState: entry,
        sourceContextHash: input.identity.contextHash,
      },
      async (): Promise<SceneBeatPlan> => {
        const result = await ports.planBeats({
          scene,
          sourceContext: input.sourceContext,
          acceptedProse: previousText,
          actualEntryState: entry,
          remainingCalls: Math.floor((input.budget.maxCalls - session.checkpoint.callsUsed) / 2),
          signal: input.signal,
        });
        const clean: SceneBeatPlan = {
          schemaVersion: 1,
          sceneId: result.sceneId,
          sourceContextHash: result.sourceContextHash,
          previousTextHash: result.previousTextHash,
          inputStateHash: result.inputStateHash,
          beats: result.beats,
          planHash: result.planHash,
        };
        const usedBeats = session.checkpoint.beatPlans.reduce(
          (sum, item) => sum + item.beats.length,
          0,
        );
        await assertWorkflowBeatPlan({
          plan: clean,
          scene,
          sourceContext: input.sourceContext,
          previousText,
          actualEntryState: entry,
          maximumBeats: input.budget.maxBeats - usedBeats,
        });
        return clean;
      },
      (next, result) => {
        next.beatPlans.push(structuredClone(result));
      },
    );
  }
  for (const beat of plan.beats) {
    let record = session.checkpoint.prose.find(
      (item) => item.sceneId === scene.id && item.beatId === beat.id,
    );
    if (!record) {
      const beatInput: WorkflowBeatInput = {
        scene,
        beat,
        plan,
        attempt: 1,
        previousText: acceptedWorkflowProse(session.checkpoint),
        signal: input.signal,
        fields: buildWorkflowBeatFields({
          checkpoint: session.checkpoint,
          sourceContext: input.sourceContext,
          chapterConstraints: input.chapterConstraints,
          scene,
          plan,
          beat,
        }),
      };
      await writeWorkflowBeat(session, beatInput);
      record = session.checkpoint.prose[session.checkpoint.prose.length - 1];
    }
    if (!record.actualState) {
      const proseRecord = record;
      const index = session.checkpoint.prose.findIndex(
        (item) => item.sceneId === scene.id && item.beatId === beat.id,
      );
      const previousState = session.checkpoint.prose[index - 1]?.actualState;
      await executeWorkflowStage(
        session,
        { kind: 'beat_state', sceneId: scene.id, beatId: beat.id },
        { contentHash: record.contentHash, previousState },
        async () =>
          validateActualBeatState(
            await ports.extractState({
              prose: proseRecord.text,
              sourceTextHash: proseRecord.contentHash,
              previousState,
              signal: input.signal,
            }),
            proseRecord.text,
          ),
        (next, state) => {
          const target = next.prose.find(
            (item) => item.sceneId === scene.id && item.beatId === beat.id,
          )!;
          target.actualState = structuredClone(state);
        },
      );
    }
  }
  if (!session.checkpoint.scenes.some((item) => item.sceneId === scene.id)) {
    const records = session.checkpoint.prose.filter((item) => item.sceneId === scene.id);
    await executeWorkflowStage(
      session,
      { kind: 'scene_close', sceneId: scene.id },
      {
        planHash: plan.planHash,
        beats: records.map((item) => ({ hash: item.contentHash, state: item.actualState })),
      },
      async (): Promise<SceneExecutionRecord> => ({
        sceneId: scene.id,
        planHash: plan.planHash,
        contentHash: await sha256(records.map((item) => item.text).join('\n\n')),
        beatIds: records.map((item) => item.beatId),
        actualEndState: records[records.length - 1].actualState!.endState,
        unknowns: [...new Set(records.flatMap((item) => item.actualState!.unknowns))],
        stateSourceBeatIds: records.map((item) => item.beatId),
      }),
      (next, result) => {
        next.scenes.push(structuredClone(result));
      },
      false,
    );
  }
}

/** Host adapters own storage and Provider dispatch; this runner never saves/adopts formal chapter data. */
export async function runChapterWritingWorkflow(
  input: RunChapterWritingWorkflowInput,
  ports: ChapterWritingWorkflowPorts,
): Promise<{ text: string; checkpoint: ChapterWritingWorkflowCheckpoint }> {
  const session = await openChapterWritingWorkflow(input, ports);
  if (session.checkpoint.status === 'completed') {
    const text = acceptedWorkflowProse(session.checkpoint);
    await ports.validateChapter(text, session.checkpoint.prose);
    return { text, checkpoint: structuredClone(session.checkpoint) };
  }
  try {
    if (!session.checkpoint.scenePlan) {
      await executeWorkflowStage(
        session,
        { kind: 'scene_plan' },
        { contextHash: input.identity.contextHash, targetCharacters: input.targetCharacters },
        async (): Promise<{ plan: ChapterScenePlanV2; hash: string }> => {
          const result = await ports.planScenes({
            sourceContext: input.sourceContext,
            targetCharacters: input.targetCharacters,
            signal: input.signal,
          });
          const clean = JSON.parse(
            JSON.stringify({ schemaVersion: 2, scenes: result.scenes }),
          ) as ChapterScenePlanV2;
          assertWorkflowScenePlan(clean);
          if (
            clean.scenes.reduce((sum, scene) => sum + scene.targetCharacters!, 0) !==
            input.targetCharacters
          ) {
            workflowFailure('CHAPTER_WORKFLOW_PLAN_INVALID', '场景预算总和必须等于冻结章节目标。');
          }
          return { plan: clean, hash: await canonicalHash(clean) };
        },
        (next, result) => {
          next.scenePlan = structuredClone(result.plan);
          next.scenePlanHash = result.hash;
        },
      );
    }
    for (let index = 0; index < session.checkpoint.scenePlan!.scenes.length; index += 1) {
      await executeScene(session, index);
    }
    const text = acceptedWorkflowProse(session.checkpoint);
    if (!session.checkpoint.assembledTextHash) {
      await executeWorkflowStage(
        session,
        { kind: 'chapter_assemble' },
        { records: session.checkpoint.prose.map((item) => item.contentHash) },
        async () => {
          await ports.validateChapter(text, session.checkpoint.prose);
          return sha256(text);
        },
        (next, hash) => {
          next.assembledTextHash = hash;
        },
        false,
      );
    }
    await session.assertActive();
    await session.commit((next) => {
      next.status = 'completed';
      delete next.errorCode;
    });
    return { text, checkpoint: structuredClone(session.checkpoint) };
  } catch (error) {
    await session.commit((next) => {
      next.status = input.signal?.aborted ? 'cancelled' : 'waiting_retry';
      next.errorCode =
        error instanceof ChapterWritingWorkflowError ? error.code : 'CHAPTER_WORKFLOW_STAGE_FAILED';
    });
    throw error;
  }
}
