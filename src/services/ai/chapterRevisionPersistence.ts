import type {
  AiExecutionCompilationInput,
  CompiledAiExecutionContractV1,
} from '../../types/aiCompilation';
import type { AppError } from '../../types/appError';
import type { CreateResultArtifactInput, ResultArtifactBundle } from '../../types/result-artifact';
import { prepareChapterArtifactPersistence } from './chapterRevisionArtifactLineage';

/**
 * Runtime subset the shared pipeline injects for Artifact persistence. The
 * persistence entry point is selected here before the request is dispatched, so
 * the pipeline only calls the chosen port and keeps its existing orchestration.
 */
export interface ChapterArtifactPersistenceRuntime {
  createArtifact: (input: CreateResultArtifactInput) => Promise<ResultArtifactBundle>;
  createChapterRevisionArtifact?: (
    input: CreateResultArtifactInput,
  ) => Promise<ResultArtifactBundle>;
  getArtifact: (artifactId: string) => Promise<ResultArtifactBundle>;
}

/** Artifact write port chosen for one execution. */
export type ChapterArtifactPersister = (
  input: CreateResultArtifactInput,
) => Promise<ResultArtifactBundle>;

/** Request-scoped identity the pre-request revision validation must agree with. */
export interface ChapterArtifactPersistenceSource {
  novelId: string;
  chapterId?: string;
  compilation: Pick<AiExecutionCompilationInput, 'taskInput'>;
}

/**
 * Pre-request Artifact persistence selection: a verified chapter revision must
 * write through the dedicated revision command, every other task keeps the
 * shared Artifact command. Source and derivation validation stays in
 * `chapterRevisionArtifactLineage` and is only delegated to here.
 */
export function selectArtifactPersister(
  source: ChapterArtifactPersistenceSource,
  contract: Pick<CompiledAiExecutionContractV1, 'expectedArtifactType'>,
  runtime: ChapterArtifactPersistenceRuntime,
): Promise<ChapterArtifactPersister> {
  return prepareChapterArtifactPersistence(
    {
      novelId: source.novelId,
      chapterId: source.chapterId,
      taskInput: source.compilation.taskInput,
      expectedArtifactType: contract.expectedArtifactType,
    },
    runtime,
  );
}

/**
 * Persisted Artifact usability check shared by the completed-task replay and
 * the fresh write path. Returns the failure contract only when Artifact
 * validation rejected the persisted content.
 */
export function artifactValidationError(
  bundle: ResultArtifactBundle | undefined,
  context: Pick<AppError, 'traceId' | 'operationId'>,
): AppError | undefined {
  if (!bundle || bundle.artifact.processingStatus !== 'invalid') return undefined;
  return {
    code: 'ARTIFACT_VALIDATION_FAILED',
    message: 'AI 结果未通过校验。',
    retryable: true,
    ...context,
    details: {
      artifactId: bundle.artifact.artifactId,
      issueCodes: bundle.issues.map((issue) => issue.code),
    },
  };
}
