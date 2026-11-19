import type {
  ApplyOutlineCandidateInput,
  ApplyOutlineCandidateResult,
  OutlineCandidateApplicationAction,
  OutlineGenerationEvidence,
} from '../../types/outlineGeneration';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { dbCall, isTauri } from '../database/db';

/** Restoration is a UI hint only. Native code re-reads the actual source and receipt. */
export function outlineSourceFromSnapshot(
  snapshot: string | undefined,
): OutlineGenerationEvidence | null {
  if (!snapshot) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot);
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('schemaVersion' in parsed) ||
    parsed.schemaVersion !== 'outline_candidate_application_v1'
  )
    return null;
  const source = 'source' in parsed ? parsed.source : undefined;
  if (!source || typeof source !== 'object' || !('version' in source) || source.version !== 1) {
    throw new Error(
      'OUTLINE_SOURCE_INVALID: 此版本的原生候选来源不可读，正文保留，不能静默改走旧应用路径。',
    );
  }
  for (const key of [
    'novelId',
    'conversationId',
    'turnId',
    'runId',
    'cardId',
    'artifactId',
    'artifactHash',
  ]) {
    if (
      !(key in source) ||
      typeof (source as Record<string, unknown>)[key] !== 'string' ||
      !(source as Record<string, unknown>)[key]
    ) {
      throw new Error('OUTLINE_SOURCE_INVALID: 此版本的原生候选来源不完整。');
    }
  }
  const request = 'request' in source ? source.request : undefined;
  if (
    !request ||
    typeof request !== 'object' ||
    !('kind' in request) ||
    request.kind !== 'outline_generate'
  ) {
    throw new Error('OUTLINE_SOURCE_INVALID: 此版本的大纲阶段来源不完整。');
  }
  return source as OutlineGenerationEvidence;
}

/** No model call or renderer business write is permitted in an explicit application. */
export async function applyNativeOutlineCandidate(
  source: OutlineGenerationEvidence,
  action: OutlineCandidateApplicationAction,
): Promise<ApplyOutlineCandidateResult> {
  if (!isTauri()) throw new Error('浏览器开发兼容不能执行原生候选应用事务。');
  const actionHash = await computeContentSha256(JSON.stringify(action));
  if (!/^[a-f\d]{64}$/iu.test(actionHash)) throw new Error('OUTLINE_OPERATION_HASH_REQUIRED');
  const input: ApplyOutlineCandidateInput = {
    source,
    action,
    operationId: `outline:${source.artifactId}:${actionHash}`,
  };
  const result = await dbCall<ApplyOutlineCandidateResult>('apply_outline_candidate', { input });
  if (
    result.receipt?.operationId !== input.operationId ||
    result.receipt.artifactId !== source.artifactId ||
    result.receipt.artifactHash !== source.artifactHash ||
    result.receipt.authority !== 'manual_confirmation' ||
    !result.receipt.receiptId ||
    !result.receipt.entityId ||
    !result.receipt.baselineBefore ||
    !result.receipt.baselineAfter ||
    result.decision?.artifactId !== source.artifactId ||
    result.decision.conversationId !== source.conversationId ||
    result.decision.actor !== 'user' ||
    result.decision.applyTransactionId !== result.receipt.receiptId
  ) {
    throw new Error(
      'OUTLINE_APPLICATION_RECEIPT_INVALID: 已请求原生应用，但回执未能核对；请读取权威事实，不要自动重放生成。',
    );
  }
  return result;
}
