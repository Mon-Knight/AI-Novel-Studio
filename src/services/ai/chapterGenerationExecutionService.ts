import type { AiGenerateRequest, AiSettings, AiStreamEvent } from '../../types/ai';
import type { AiContextSourceInput } from '../../types/aiCompilation';
import type { RouteDecision } from '../../types/modelRuntime';
import type { AiExecutionResult } from './aiExecutionPipeline';
import type { AiSceneExecutionResult } from './aiExecutionPipeline';

export interface ChapterProseResumeBeat {
  sceneNo: number;
  beatOrder: number;
  generationUnitNo: number;
  generationUnitCount: number;
  text: string;
  sourceJobId: string;
  taskId?: string;
  attemptId?: string;
  providerId: string;
  modelId: string;
  finishReason?: string;
}

export interface ChapterGenerationExecutionInput {
  novelId: string;
  chapterId: string;
  operationId: string;
  traceId?: string;
  settings: AiSettings;
  request: AiGenerateRequest;
  sourceId: string;
  sourceVersion: string;
  /** Frozen chapter assets compiled as independently budgeted Provider sources. */
  compilationSources?: AiContextSourceInput[];
  taskInput: Record<string, unknown>;
  targetHintJson?: unknown;
  signal?: AbortSignal;
  stream?: boolean;
  onStreamEvent?: AiStreamEventHandler;
  /**
   * A contiguous prefix persisted by an earlier failed job with the same
   * frozen context and model route. The orchestrator validates every Beat
   * again before reuse and stops at the first mismatch.
   */
  resumeBeats?: ChapterProseResumeBeat[];
  /** Frozen writer route for this Beat. Orchestrator supplies it so fallback stays on the beat contract. */
  routeDecision?: RouteDecision;
  /** Backward-compatible callback; local Beat orchestration emits once per completed Beat. */
  onSceneCompleted?: (result: AiSceneExecutionResult) => void | Promise<void>;
}

export type AiStreamEventHandler = (event: AiStreamEvent) => void;

/**
 * Runs the main chapter-generation request through the compiled execution
 * contract while retaining the caller's rendered prompt and transient stream.
 */
export async function executeChapterGeneration(
  input: ChapterGenerationExecutionInput,
): Promise<AiExecutionResult> {
  const { executeChapterProseOrchestrator } = await import('./chapterProseOrchestrator');
  return executeChapterProseOrchestrator(input);
}

export type ChapterGenerationExecutionResult = AiExecutionResult;
