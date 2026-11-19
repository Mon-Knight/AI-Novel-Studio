import type { ResultArtifactBundle } from '../../types/result-artifact';
import type {
  ChapterOutlineCandidate,
  OutlineGenerationEvidence,
  OutlineGenerationOptions,
  OutlineRuntimeEntry,
  VolumeOutlineCandidate,
} from '../../types/outlineGeneration';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { submitProductionAiEntry } from '../autonomous-creation/productionAiEntryService';
import { taskConversationService } from '../conversation/taskConversationService';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('OUTLINE_CANDIDATE_SCHEMA_INVALID: 大纲候选必须是结构化对象。');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, required = true): string | undefined {
  if (!required && value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > 200_000 || (required && !value.trim())) {
    throw new Error('OUTLINE_CANDIDATE_SCHEMA_INVALID: 大纲候选文字字段无效。');
  }
  return value;
}

function volumeCandidate(payload: Record<string, unknown>): VolumeOutlineCandidate {
  return {
    title: text(payload.title)!,
    summary: text(payload.summary)!,
    ...(payload.goal !== undefined ? { goal: text(payload.goal, false) } : {}),
    ...(payload.mainConflict !== undefined
      ? { mainConflict: text(payload.mainConflict, false) }
      : {}),
  };
}

function chapterCandidates(
  payload: Record<string, unknown>,
  count: number,
): ChapterOutlineCandidate[] {
  if (
    !Array.isArray(payload.chapters) ||
    !payload.chapters.length ||
    payload.chapters.length > count
  ) {
    throw new Error('OUTLINE_CANDIDATE_COUNT_INVALID: 章节候选数量超出本次请求范围。');
  }
  return payload.chapters.map((value, runtimeIndex) => {
    const chapter = record(value);
    const target = chapter.targetWordCount;
    if (
      target !== undefined &&
      (!Number.isSafeInteger(target) || Number(target) <= 0 || Number(target) > 1_000_000)
    ) {
      throw new Error('OUTLINE_CANDIDATE_SCHEMA_INVALID: 章节目标字数无效。');
    }
    return {
      title: text(chapter.title)!,
      outline: text(chapter.outline)!,
      runtimeIndex,
      ...(chapter.goal !== undefined ? { goal: text(chapter.goal, false) } : {}),
      ...(target !== undefined ? { targetWordCount: Number(target) } : {}),
    };
  });
}

function envelope(
  bundle: ResultArtifactBundle,
  request: OutlineRuntimeEntry,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bundle.rawContent);
  } catch {
    throw new Error('OUTLINE_CANDIDATE_SCHEMA_INVALID: 原生候选不是有效 JSON。');
  }
  const value = record(parsed);
  if (value.entryKind !== 'outline_generate' || value.stageKey !== request.format) {
    throw new Error('OUTLINE_CANDIDATE_SCOPE_MISMATCH: 原生候选不属于本次大纲阶段。');
  }
  return record(value.payload);
}

export type NativeOutlineCandidate =
  | { format: 'editor_text'; value: string; title: string; source: OutlineGenerationEvidence }
  | { format: 'volume_candidate'; value: VolumeOutlineCandidate; source: OutlineGenerationEvidence }
  | {
      format: 'chapter_candidates';
      value: ChapterOutlineCandidate[];
      source: OutlineGenerationEvidence;
    };

/** A result adapter only: one native task ingress, then immutable candidate reads. */
export async function generateNativeOutline(
  novelId: string,
  request: OutlineRuntimeEntry,
  options: OutlineGenerationOptions = {},
): Promise<NativeOutlineCandidate> {
  options.signal?.throwIfAborted();
  const goal = [
    `生成${request.outlineType === 'master' ? '作品总纲' : request.outlineType === 'volume' ? '分卷大纲' : '章节大纲'}候选，仅生成，不保存或采用。`,
    request.targetTitle,
    request.chapterGoal,
    request.format === 'chapter_candidates'
      ? `本次最多 ${request.chapterCount ?? 6} 个章节候选。`
      : undefined,
  ]
    .filter(Boolean)
    .join('\n');
  const submitted = await submitProductionAiEntry({
    novelId,
    chapterId:
      request.outlineType === 'chapter' && request.format === 'editor_text'
        ? request.targetId
        : undefined,
    goal,
    entry: request,
    signal: options.signal,
  });
  options.signal?.throwIfAborted();
  if (submitted.artifactIds.length !== 1) {
    throw new Error('OUTLINE_CANDIDATE_REQUIRED: 本次原生任务未产生唯一大纲候选。');
  }
  const artifactId = submitted.artifactIds[0];
  const [artifact, conversation] = await Promise.all([
    aiTaskRuntimeService.getArtifact(artifactId),
    taskConversationService.get(submitted.conversationId, { hydrateArtifacts: false }),
  ]);
  options.signal?.throwIfAborted();
  const card = conversation?.artifacts.find(
    (item) =>
      item.artifactId === artifactId &&
      item.runId === submitted.run.runId &&
      item.turnId === submitted.run.turnId,
  );
  if (
    !card ||
    conversation?.conversation.novelId !== novelId ||
    artifact.artifact.sourceNovelId !== novelId ||
    artifact.artifact.artifactId !== artifactId ||
    !['valid', 'valid_with_warnings'].includes(artifact.artifact.processingStatus) ||
    artifact.artifact.sourceChapterId !==
      (request.outlineType === 'chapter' && request.format === 'editor_text'
        ? request.targetId
        : undefined)
  ) {
    throw new Error('OUTLINE_CANDIDATE_SCOPE_MISMATCH: 大纲候选与任务、作品或目标不一致。');
  }
  const artifactHash = await computeContentSha256(artifact.rawContent);
  if (!/^[a-f\d]{64}$/iu.test(artifactHash) || artifactHash !== artifact.artifact.contentHash) {
    throw new Error('OUTLINE_CANDIDATE_HASH_MISMATCH: 原生候选内容哈希不一致。');
  }
  const payload = envelope(artifact, request);
  const source: OutlineGenerationEvidence = {
    version: 1,
    novelId,
    conversationId: submitted.conversationId,
    runId: submitted.run.runId,
    turnId: submitted.run.turnId,
    cardId: card.cardId,
    artifactId,
    artifactHash,
    request: { ...request },
  };
  let result: NativeOutlineCandidate;
  if (request.format === 'editor_text') {
    result = {
      format: request.format,
      value: text(payload.content)!,
      title: text(payload.title)!,
      source,
    };
  } else if (request.format === 'volume_candidate') {
    result = { format: request.format, value: volumeCandidate(payload), source };
  } else {
    result = {
      format: request.format,
      value: chapterCandidates(payload, request.chapterCount ?? 6),
      source,
    };
  }
  options.onCandidate?.(source);
  return result;
}
