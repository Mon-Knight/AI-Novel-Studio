import type { CreateResultArtifactInput, ResultArtifactBundle } from '../../types/result-artifact';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { CHAPTER_REVISION_DERIVATION_TYPE } from '../../types/artifactRevision';

/** Only the verified chapter-revision contract may request lineage in the shared pipeline. */
export async function resolveChapterRevisionArtifactLineage(
  input: { novelId: string; chapterId?: string; taskInput?: Record<string, unknown> },
  getArtifact: (artifactId: string) => Promise<ResultArtifactBundle>,
): Promise<Pick<CreateResultArtifactInput, 'parentArtifactId' | 'derivationType'>> {
  const metadata = input.taskInput;
  if (!metadata?.parentArtifactId && metadata?.derivationType !== CHAPTER_REVISION_DERIVATION_TYPE)
    return {};
  const source = metadata?.revisionSource as Record<string, unknown> | undefined;
  const parent = metadata?.parentArtifactId;
  const hash = metadata?.sourceContentHash;
  const fail = () =>
    Object.assign(new Error('章节修订派生来源无效，已阻止创建新产物。'), {
      code: 'CHAPTER_REVISION_SOURCE_INVALID',
      retryable: false,
    });
  if (
    metadata?.derivationType !== CHAPTER_REVISION_DERIVATION_TYPE ||
    typeof parent !== 'string' ||
    !parent ||
    typeof hash !== 'string' ||
    metadata.sourceArtifactId !== parent ||
    !source ||
    source.artifactId !== parent ||
    source.artifactHash !== hash ||
    source.novelId !== input.novelId ||
    source.chapterId !== input.chapterId ||
    source.artifactType !== 'chapter_text'
  )
    throw fail();
  const bundle = await getArtifact(parent);
  if (
    bundle.artifact.artifactId !== parent ||
    bundle.artifact.artifactType !== 'chapter_text' ||
    bundle.artifact.sourceNovelId !== input.novelId ||
    bundle.artifact.sourceChapterId !== input.chapterId ||
    !['valid', 'valid_with_warnings'].includes(bundle.artifact.processingStatus) ||
    bundle.artifact.contentHash !== hash ||
    !bundle.rawContent.trim() ||
    (await computeContentSha256(bundle.rawContent)) !== hash
  )
    throw fail();
  return { parentArtifactId: parent, derivationType: CHAPTER_REVISION_DERIVATION_TYPE };
}

export async function prepareChapterArtifactPersistence(
  input: {
    novelId: string;
    chapterId?: string;
    taskInput?: Record<string, unknown>;
    expectedArtifactType: string;
  },
  runtime: {
    getArtifact: (artifactId: string) => Promise<ResultArtifactBundle>;
    createArtifact: (input: CreateResultArtifactInput) => Promise<ResultArtifactBundle>;
    createChapterRevisionArtifact?: (
      input: CreateResultArtifactInput,
    ) => Promise<ResultArtifactBundle>;
  },
): Promise<(input: CreateResultArtifactInput) => Promise<ResultArtifactBundle>> {
  const lineage = await resolveChapterRevisionArtifactLineage(input, runtime.getArtifact);
  if (!lineage.parentArtifactId) return runtime.createArtifact.bind(runtime);
  if (input.expectedArtifactType !== 'chapter_text') {
    throw Object.assign(new Error('章节修订只能生成章节正文候选。'), {
      code: 'CHAPTER_REVISION_SOURCE_INVALID',
      retryable: false,
    });
  }
  const persist = runtime.createChapterRevisionArtifact;
  if (!persist) {
    throw Object.assign(new Error('章节修订专用持久化入口不可用，未调用模型。'), {
      code: 'CHAPTER_REVISION_PERSISTENCE_UNAVAILABLE',
      retryable: false,
    });
  }
  return (artifact) => persist.call(runtime, { ...artifact, ...lineage });
}
