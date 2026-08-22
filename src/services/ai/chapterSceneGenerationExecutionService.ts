import type { AiGenerateRequest } from '../../types/ai';
import { ROUTE_DECISION_TASK_INPUT_KEY } from '../../types/modelRuntime';
import { executeAiTask, type AiExecutionResult } from './aiExecutionPipeline';
import { estimateTokens } from './compilation/canonical';
import { localChapterModelQueue } from './localChapterModelQueue';
import type { ChapterGenerationExecutionInput } from './chapterGenerationExecutionService';

function requestSource(request: AiGenerateRequest): string {
  return request.messages.map((message) => `[${message.role}]\n${message.content}`).join('\n\n');
}

/**
 * Runs one Beat through the writer contract. Local endpoints stay on the
 * single-concurrency queue; cloud writer fallback uses the same compiled Beat
 * envelope and does not switch to chapter_generate.
 */
export async function executeChapterSceneGeneration(
  input: ChapterGenerationExecutionInput,
): Promise<AiExecutionResult> {
  const { sceneContext, ...taskInput } = input.taskInput;
  const content =
    typeof sceneContext === 'string' && sceneContext.trim()
      ? sceneContext.trim()
      : requestSource(input.request);
  let routeDecision = input.routeDecision;
  if (!routeDecision) {
    if (input.settings.localChapterModel?.enabled) {
      const { syncLocalModelLifecycleSidecar } = await import('./runtime/modelLifecycleSidecar');
      await syncLocalModelLifecycleSidecar(input.settings.localChapterModel);
    }
    const { routeCreativeTask } = await import('./runtime/modelRouter');
    routeDecision = routeCreativeTask(input.settings, 'chapter_scene_generate', {
      compiledContextTokens: estimateTokens(content),
    });
  }
  const run = () =>
    executeAiTask({
      operationId: input.operationId,
      traceId: input.traceId ?? input.operationId,
      taskType: 'chapter_scene_generate',
      scopeType: 'chapter',
      novelId: input.novelId,
      chapterId: input.chapterId,
      targetHintJson: input.targetHintJson,
      settings: input.settings,
      routeDecision,
      compilation: {
        taskInput: {
          ...taskInput,
          protocolVersion: 'scene-beat-prose-v1',
          [ROUTE_DECISION_TASK_INPUT_KEY]: routeDecision,
        },
        sources: [
          {
            sourceType: 'request_context',
            sourceId: input.sourceId,
            sourceVersion: input.sourceVersion,
            origin: 'request',
            label: 'Frozen chapter Beat writer context',
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
    });
  if (routeDecision.selected.kind === 'local') {
    return localChapterModelQueue.enqueue(input.operationId, run, input.signal);
  }
  return run();
}
