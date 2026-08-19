import type { AiGenerateRequest } from '../../types/ai';
import { executeAiTask, type AiExecutionResult } from './aiExecutionPipeline';
import { localChapterModelQueue } from './localChapterModelQueue';
import type { ChapterGenerationExecutionInput } from './chapterGenerationExecutionService';

function requestSource(request: AiGenerateRequest): string {
  return request.messages.map((message) => `[${message.role}]\n${message.content}`).join('\n\n');
}

/**
 * Runs one Beat through the local prose model. The local protocol deliberately
 * receives one user message and a compact immediate context instead of the
 * full external chapter-generation prompt.
 */
export function executeChapterSceneGeneration(
  input: ChapterGenerationExecutionInput,
): Promise<AiExecutionResult> {
  const { sceneContext, ...taskInput } = input.taskInput;
  const content =
    typeof sceneContext === 'string' && sceneContext.trim()
      ? sceneContext.trim()
      : requestSource(input.request);
  return localChapterModelQueue.enqueue(
    input.operationId,
    () =>
      executeAiTask({
        operationId: input.operationId,
        traceId: input.traceId ?? input.operationId,
        taskType: 'chapter_scene_generate',
        scopeType: 'chapter',
        novelId: input.novelId,
        chapterId: input.chapterId,
        targetHintJson: input.targetHintJson,
        settings: input.settings,
        compilation: {
          taskInput: {
            ...taskInput,
            protocolVersion: 'qwen35-novel-beat-v3',
          },
          sources: [
            {
              sourceType: 'request_context',
              sourceId: input.sourceId,
              sourceVersion: input.sourceVersion,
              origin: 'request',
              label: 'Frozen local chapter Beat context',
              content,
              order: 0,
              priority: 100,
              required: true,
              maxTokens: 3_000,
            },
          ],
        },
        signal: input.signal,
        stream: input.stream,
        onStreamEvent: input.onStreamEvent,
      }),
    input.signal,
  );
}
