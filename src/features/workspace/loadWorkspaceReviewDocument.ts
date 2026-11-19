import { aiTaskRuntimeService } from '../../services/ai-tasks/aiTaskRuntimeService';
import { artifactDecisionService } from '../../services/conversation/artifactDecisionService';
import { reviewAuthorizationRenewalService } from '../../services/conversation/reviewAuthorizationRenewalService';
import { draftVersionService } from '../../services/database/draftVersionService';
import type { ChapterDraft } from '../../types/ai';
import type { ReviewAuthorization, ReviewCandidateDocument } from '../../types/conversation';
import { computeContentSha256 } from '../../utils/contentIntegrity';

interface Input {
  novelId: string;
  chapterId: string;
  authorizationId: string;
  artifactId?: string;
  draftId?: string;
}
export interface WorkspaceReviewDocument {
  authorization: ReviewAuthorization;
  candidate: ReviewCandidateDocument | null;
  draft: ChapterDraft | null;
}

/** Read-only hydration follows actual persisted consent history, never the latest arbitrary draft. */
export async function loadWorkspaceReviewDocument(input: Input): Promise<WorkspaceReviewDocument> {
  const resume = reviewAuthorizationRenewalService.isSupported()
    ? await reviewAuthorizationRenewalService.resume(input.authorizationId)
    : null;
  if (resume && resume.requestedAuthorizationId !== input.authorizationId)
    throw new Error('原生审阅恢复结果与请求授权不一致。');
  const authorization =
    resume?.authorization ??
    (await artifactDecisionService.getAuthorization(input.authorizationId));
  if (!authorization || authorization.status === 'expired')
    throw new Error('审阅授权不存在或已失效。');
  if (authorization.novelId !== input.novelId || authorization.chapterId !== input.chapterId)
    throw new Error('审阅授权与当前作品或章节不匹配。');
  if (input.artifactId && authorization.artifactId !== input.artifactId)
    throw new Error('审阅授权与产物标识不匹配。');
  if (authorization.status === 'consumed') {
    if (!authorization.consumedByDraftId) throw new Error('审阅授权已消费，但缺少采用草稿引用。');
    const draft = await draftVersionService.getById(
      input.chapterId,
      authorization.consumedByDraftId,
    );
    if (
      !draft ||
      !draft.isAdopted ||
      draft.novelId !== input.novelId ||
      draft.chapterId !== input.chapterId ||
      draft.contentState?.status === 'unavailable'
    )
      throw new Error('审阅授权已消费，但采用草稿状态不一致或完整正文不可用。');
    return { authorization, candidate: null, draft };
  }
  const bundle = await aiTaskRuntimeService.getArtifact(authorization.artifactId);
  if (!bundle.rawContent) throw new Error('候选产物正文为空或无法读取。');
  const originalHash = await computeContentSha256(bundle.rawContent);
  if (
    bundle.artifact.contentHash &&
    !originalHash.startsWith('fallback_') &&
    originalHash.toLowerCase() !== bundle.artifact.contentHash.toLowerCase()
  )
    throw new Error('候选产物内容哈希校验失败。');
  const candidate: ReviewCandidateDocument = {
    authorizationId: authorization.authorizationId,
    artifactId: authorization.artifactId,
    content: bundle.rawContent,
    contentHash: bundle.artifact.contentHash || originalHash,
    chapterId: input.chapterId,
    novelId: input.novelId,
  };
  const binding = resume?.reviewDraftBinding;
  if (!binding) {
    if (authorization.reviewDraftBinding || authorization.renewedFromAuthorizationId)
      throw new Error('重新授权缺少原生核验的当前编辑稿绑定，已阻止回退成原始候选。');
    return { authorization, candidate, draft: null };
  }
  if (input.draftId && input.draftId !== binding.draftId)
    throw new Error('指定草稿不是原生审阅授权绑定的草稿。');
  const draft = await draftVersionService.getById(input.chapterId, binding.draftId);
  if (
    !draft ||
    draft.novelId !== input.novelId ||
    draft.chapterId !== input.chapterId ||
    draft.versionNo !== binding.draftVersion ||
    draft.contentState?.status === 'unavailable'
  )
    throw new Error('已保存审阅稿的归属、版本或完整正文已变化，请重新核对。');
  const hash = await computeContentSha256(draft.content);
  if (hash.startsWith('fallback_') || hash !== binding.contentHash)
    throw new Error('已保存审阅稿全文指纹与原生恢复绑定不一致。');
  candidate.reviewDraftBinding = {
    draftId: binding.draftId,
    draftVersion: binding.draftVersion,
    contentHash: binding.contentHash,
  };
  candidate.changedSinceRenewal = binding.changedSinceRenewal;
  return { authorization, candidate, draft };
}
