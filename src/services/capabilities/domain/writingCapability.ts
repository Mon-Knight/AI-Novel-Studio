import { workbenchChapterWriter } from '../../conversation/workbenchChapterWriter';
import {
  failure,
  hashPublicValue,
  mapUnknownError,
  success,
  validateChapterScope,
  validateNonEmpty,
} from './domainResult';
import type { DomainRequest, DomainResult, WritingCandidate } from './domainTypes';

async function runCandidate(
  request: DomainRequest,
  mode: 'generate' | 'continue' | 'rewrite',
): Promise<DomainResult<WritingCandidate>> {
  const scopeError = validateChapterScope(request);
  if (scopeError) return scopeError;
  const instructionError = validateNonEmpty(request.instruction, 'instruction');
  if (instructionError) return instructionError;
  if (!request.modelSnapshot) {
    return failure('MODEL_SNAPSHOT_REQUIRED', '候选写作必须携带冻结的模型快照。');
  }
  if (mode === 'rewrite' && !request.previousCandidateText?.trim()) {
    return failure('INVALID_ARGUMENT', '重写候选必须明确提供上一版候选正文。');
  }

  try {
    const result = await workbenchChapterWriter.generate({
      novelId: request.novelId,
      chapterId: request.chapterId!,
      goal: request.instruction!.trim(),
      mode: mode === 'rewrite' ? 'polish' : 'generate',
      previousCandidateText: request.previousCandidateText,
      memoryContext: request.structuredPayload,
      modelSnapshot: request.modelSnapshot,
      signal: request.signal,
    });
    const text = result.text.trim();
    if (!text) return failure('UPSTREAM_FAILURE', '生产写作管线返回了空候选。');
    const data: WritingCandidate = {
      novelId: request.novelId,
      chapterId: request.chapterId!,
      text,
      mode,
      candidateOnly: true,
      ...(result.artifactId ? { artifactId: result.artifactId } : {}),
      ...(result.taskId ? { taskId: result.taskId } : {}),
      ...(result.contextHash ? { contextHash: result.contextHash } : {}),
    };
    return success(data, {
      source: 'runtime',
      storageMode: 'runtime',
      warnings: [],
      revision: result.contextHash ?? null,
      contentHash: await hashPublicValue(text),
    });
  } catch (error) {
    return mapUnknownError(error, 'runtime');
  }
}

export const writingCapability = {
  /** Generate a new candidate; never creates or adopts a chapter draft. */
  generateCandidate(request: DomainRequest): Promise<DomainResult<WritingCandidate>> {
    return runCandidate(request, 'generate');
  },

  /** Continue the current chapter using the same candidate-only contract. */
  continueCandidate(request: DomainRequest): Promise<DomainResult<WritingCandidate>> {
    return runCandidate(request, 'continue');
  },

  /** Rewrite an explicitly supplied candidate; formal adoption remains host controlled. */
  rewriteCandidate(request: DomainRequest): Promise<DomainResult<WritingCandidate>> {
    return runCandidate(request, 'rewrite');
  },
};

export type WritingCapability = typeof writingCapability;
