import type { AiGenerateRequest, AiSettings, AiStreamEvent } from '../../types/ai';
import { executeAiTask, type AiExecutionResult } from './aiExecutionPipeline';

export interface ChapterGenerationExecutionInput {
  novelId: string;
  chapterId: string;
  operationId: string;
  traceId?: string;
  settings: AiSettings;
  request: AiGenerateRequest;
  sourceId: string;
  sourceVersion: string;
  taskInput: Record<string, unknown>;
  targetHintJson?: unknown;
  signal?: AbortSignal;
  stream?: boolean;
  onStreamEvent?: AiStreamEventHandler;
}

export type AiStreamEventHandler = (event: AiStreamEvent) => void;

function requestSource(request: AiGenerateRequest): string {
  return request.messages.map((message) => `[${message.role}]\n${message.content}`).join('\n\n');
}

/**
 * Runs the main chapter-generation request through the compiled execution
 * contract while retaining the caller's rendered prompt and transient stream.
 */
export function executeChapterGeneration(
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

export type ChapterGenerationExecutionResult = AiExecutionResult;
