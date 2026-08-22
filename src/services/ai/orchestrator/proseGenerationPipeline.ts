import type { AiExecutionResult, AiSceneExecutionResult } from '../aiExecutionPipeline';
import { executeAiTask } from '../aiExecutionPipeline';
import { executeChapterSceneGeneration } from '../chapterSceneGenerationExecutionService';
import type {
  ChapterGenerationExecutionInput,
  ChapterProseResumeBeat,
} from '../chapterGenerationExecutionService';
import {
  type OrchestratedScene,
  MAX_LOCAL_BEAT_ATTEMPTS,
  MAX_LOCAL_BEAT_CHARACTERS,
  MIN_LOCAL_BEAT_CHARACTERS,
  positiveNumber,
  requestSource,
  stringValue,
} from './types';
import { scenePlanFromInput, validateLocalGenerationPlan } from './scenePlanParser';
import {
  immediateBeatContext,
  retrySceneTaskInput,
  sceneConstraints,
  validationErrorMessage,
} from './beatContextAssembler';
import {
  pendingSceneBeats,
  validateBeatNovelty,
  validateSceneContinuity,
  validateSceneText,
} from './beatTextValidator';
import {
  executeExternalBeatRepairWithTransportRetry,
  trimExternalBeatRepairAtNaturalBoundary,
} from './beatRepairService';

export async function executeExternalChapterGeneration(
  input: ChapterGenerationExecutionInput,
): Promise<AiExecutionResult> {
  return executeAiTask({
    operationId: input.operationId,
    traceId: input.traceId ?? input.operationId,
    taskType: 'chapter_generate',
    scopeType: 'chapter',
    novelId: input.novelId,
    chapterId: input.chapterId,
    targetHintJson: input.targetHintJson,
    settings: input.settings,
    compilation: {
      taskInput: input.taskInput,
      sources: [
        {
          sourceType: 'request_context',
          sourceId: input.sourceId,
          sourceVersion: input.sourceVersion,
          origin: 'request',
          label: 'Frozen chapter generation prompt',
          content: requestSource(input.request),
          order: 0,
          priority: 100,
          required: true,
          maxTokens: 48_000,
        },
      ],
    },
    signal: input.signal,
    stream: input.stream,
    onStreamEvent: input.onStreamEvent,
  });
}

export async function executeChapterProseOrchestrator(
  input: ChapterGenerationExecutionInput,
): Promise<AiExecutionResult> {
  if (!input.settings.localChapterModel?.enabled || input.taskInput.mode === 'rewrite') {
    return executeExternalChapterGeneration(input);
  }
  if (!Array.isArray(input.taskInput.scenePlan) || input.taskInput.scenePlan.length === 0) {
    throw new Error('本地章节正文生成必须先由外部 AI 生成并由用户确认 Scene/Beat 计划。');
  }
  const scenes = scenePlanFromInput(input);
  validateLocalGenerationPlan(scenes);
  const chapterTarget = positiveNumber(input.taskInput.targetWordCount);
  const totalBeats = scenes.reduce((sum, scene) => sum + scene.beats.length, 0);
  const beatTarget = Math.min(
    MAX_LOCAL_BEAT_CHARACTERS,
    Math.max(500, chapterTarget ? Math.round(chapterTarget / totalBeats) : 650),
  );
  const beatMaximum = Math.min(
    MAX_LOCAL_BEAT_CHARACTERS,
    Math.max(MIN_LOCAL_BEAT_CHARACTERS, Math.ceil(beatTarget * 1.2)),
  );
  const results: AiSceneExecutionResult[] = [];
  let externalRepairUsed = false;
  let previous: { scene: OrchestratedScene; beatOrder: number; text: string } | undefined;
  let generationUnitNo = 0;
  let resumePrefixOpen = Array.isArray(input.resumeBeats) && input.resumeBeats.length > 0;
  const resumeBeats = new Map<number, ChapterProseResumeBeat>(
    (input.resumeBeats ?? []).map((beat) => [beat.generationUnitNo, beat]),
  );

  for (const scene of scenes) {
    for (const beat of scene.beats) {
      if (input.signal?.aborted) throw new Error('AI_REQUEST_CANCELLED');
      generationUnitNo += 1;
      const isLastBeatInScene = beat.order === scene.beats.length;
      const unitScene = { ...scene, beats: [beat] };
      const acceptedChapterPrefix = results.map((result) => result.text).join('\n\n');
      const resumeBeat = resumePrefixOpen ? resumeBeats.get(generationUnitNo) : undefined;
      if (
        resumeBeat &&
        resumeBeat.sceneNo === scene.sceneNo &&
        resumeBeat.beatOrder === beat.order &&
        resumeBeat.generationUnitCount === totalBeats
      ) {
        const resumedText = resumeBeat.text.trim();
        try {
          validateSceneText(
            resumedText,
            unitScene,
            resumeBeat.finishReason ?? 'stop',
            MIN_LOCAL_BEAT_CHARACTERS,
            beatMaximum,
          );
          validateBeatNovelty(acceptedChapterPrefix, resumedText, scene.sceneNo, beat.order);
          if (previous && previous.scene.sceneNo !== scene.sceneNo) {
            validateSceneContinuity(previous.scene, resumedText);
          }
          const beatResult: AiSceneExecutionResult = {
            sceneNo: scene.sceneNo,
            beatOrder: beat.order,
            generationUnitNo,
            generationUnitCount: totalBeats,
            title: `${scene.title} · Beat ${beat.order}`,
            text: resumedText,
            taskId: resumeBeat.taskId,
            attemptId: resumeBeat.attemptId,
            provider: {
              text: resumedText,
              providerId: resumeBeat.providerId,
              modelId: resumeBeat.modelId,
              finishReason: resumeBeat.finishReason ?? 'stop',
              tokenInput: 0,
              tokenOutput: 0,
              tokenTotal: 0,
              durationMs: 0,
            },
            persistence: 'sqlite',
            reusedFromJobId: resumeBeat.sourceJobId,
          };
          results.push(beatResult);
          externalRepairUsed ||=
            resumeBeat.providerId !== input.settings.localChapterModel?.providerId;
          await input.onSceneCompleted?.(beatResult);
          previous = { scene, beatOrder: beat.order, text: beatResult.text };
          continue;
        } catch {
          resumePrefixOpen = false;
        }
      } else if (resumePrefixOpen) {
        resumePrefixOpen = false;
      }
      const baseSceneConstraints = [
        ...sceneConstraints(input, scene, beat, previous, isLastBeatInScene),
        `本 Beat 正文目标约 ${beatTarget} 字，必须不少于 ${MIN_LOCAL_BEAT_CHARACTERS} 字且不超过 ${beatMaximum} 字。`,
      ];
      const initialSceneConstraints = [
        ...baseSceneConstraints,
        '在当前 Beat 的最后一个动作、对白或状态变化后自然收束，不追加下一 Beat。',
      ].filter(Boolean);
      const sceneTaskInput = {
        ...input.taskInput,
        sceneNo: scene.sceneNo,
        beatOrder: beat.order,
        generationUnitNo,
        generationUnitCount: totalBeats,
        sceneTitle: scene.title,
        sceneGoal: [
          scene.goal || stringValue(input.taskInput.sceneGoal) || '推进当前场景目标。',
          `当前 Beat：${beat.text}`,
        ].join('\n'),
        sceneBeats: [beat.text],
        targetCharacters: beatTarget,
        sceneConstraints: initialSceneConstraints,
        sceneContext: immediateBeatContext(input, scene, beat, previous, acceptedChapterPrefix),
      };
      let response: AiExecutionResult | undefined;
      let beatText = '';
      let validationFailure: unknown;
      for (let localAttempt = 1; localAttempt <= MAX_LOCAL_BEAT_ATTEMPTS; localAttempt += 1) {
        const attemptTaskInput =
          localAttempt === 1
            ? sceneTaskInput
            : retrySceneTaskInput(
                sceneTaskInput,
                unitScene,
                baseSceneConstraints,
                validationFailure,
                pendingSceneBeats,
              );
        const unitIdentity = `:scene:${scene.sceneNo}:beat:${beat.order}:attempt:${localAttempt}`;
        response = await executeChapterSceneGeneration({
          ...input,
          operationId: input.operationId + unitIdentity,
          traceId: (input.traceId ?? input.operationId) + unitIdentity,
          sourceId: input.sourceId + unitIdentity,
          taskInput: attemptTaskInput,
        });
        beatText = response.text.trim();
        try {
          validateSceneText(
            beatText,
            unitScene,
            response.provider.finishReason,
            MIN_LOCAL_BEAT_CHARACTERS,
            beatMaximum,
          );
          validateBeatNovelty(acceptedChapterPrefix, beatText, scene.sceneNo, beat.order);
          if (previous && previous.scene.sceneNo !== scene.sceneNo) {
            validateSceneContinuity(previous.scene, beatText);
          }
          validationFailure = undefined;
          break;
        } catch (error: unknown) {
          validationFailure = error;
        }
      }
      if (validationFailure) {
        response = await executeExternalBeatRepairWithTransportRetry(
          input,
          scene,
          beat,
          beatText,
          validationFailure,
          baseSceneConstraints,
          beatTarget,
          beatMaximum,
          previous,
          acceptedChapterPrefix,
        );
        beatText = response.text.trim();
        try {
          beatText = trimExternalBeatRepairAtNaturalBoundary(
            beatText,
            response.provider.finishReason,
            MIN_LOCAL_BEAT_CHARACTERS,
            beatMaximum,
            beat.text,
          );
          validateSceneText(
            beatText,
            unitScene,
            response.provider.finishReason,
            MIN_LOCAL_BEAT_CHARACTERS,
            beatMaximum,
          );
          validateBeatNovelty(acceptedChapterPrefix, beatText, scene.sceneNo, beat.order);
          if (previous && previous.scene.sceneNo !== scene.sceneNo) {
            validateSceneContinuity(previous.scene, beatText);
          }
          validationFailure = undefined;
          externalRepairUsed = true;
        } catch (error: unknown) {
          throw new Error(
            `Scene ${scene.sceneNo} / Beat ${beat.order} 本地模型两次生成及外部 AI 定点修稿均未通过；` +
              validationErrorMessage(error),
          );
        }
      }
      if (!response || validationFailure) {
        throw new Error(`Scene ${scene.sceneNo} / Beat ${beat.order} 未得到可采纳正文。`);
      }
      const beatResult: AiSceneExecutionResult = {
        sceneNo: scene.sceneNo,
        beatOrder: beat.order,
        generationUnitNo,
        generationUnitCount: totalBeats,
        title: `${scene.title} · Beat ${beat.order}`,
        text: beatText,
        taskId: response.taskId,
        attemptId: response.attemptId,
        provider: response.provider,
        persistence: response.persistence,
      };
      results.push(beatResult);
      await input.onSceneCompleted?.(beatResult);
      previous = { scene, beatOrder: beat.order, text: beatResult.text };
    }
  }

  const last = results[results.length - 1];
  if (!last) throw new Error('未生成任何 Beat 正文。');
  return {
    persistence: last.persistence,
    text: results.map((result) => result.text).join('\n\n'),
    provider: last.provider,
    taskId: last.taskId,
    attemptId: last.attemptId,
    externalRepairUsed,
    sceneResults: results,
  };
}
