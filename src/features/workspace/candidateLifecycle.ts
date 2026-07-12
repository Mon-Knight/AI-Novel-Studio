import type { ChapterDraft } from '../../types/ai';
import type {
  CandidateGenerationActivity,
  CandidateLifecycleContext,
  CandidateReviewRecord,
} from '../../types/placement';

export interface DeriveCandidateLifecycleInput {
  record: CandidateReviewRecord | null;
  generation?: CandidateGenerationActivity | null;
  currentNovelId?: string;
  currentChapterId?: string;
  currentDraft?: Pick<ChapterDraft, 'id' | 'novelId' | 'chapterId' | 'versionNo'> | null;
  currentEditorContent?: string;
  readError?: string;
}

function context(
  input: DeriveCandidateLifecycleInput,
  patch: Partial<CandidateLifecycleContext>,
): CandidateLifecycleContext {
  const candidate = input.record?.candidate ?? null;
  const target = input.record?.target;
  return {
    record: input.record,
    candidate,
    candidateId: candidate?.candidateId || candidate?.artifactId,
    candidateChapterId: target?.chapterId,
    targetChapterId: input.currentChapterId,
    content: candidate?.content || '',
    baseContent: candidate?.baseContent,
    baseDraftId: target?.sourceDraftId,
    baseDraftVersion: target?.sourceRevision,
    baseContentHash: target?.baseContentHash,
    constraintStatus: candidate?.constraintValidation?.status,
    generation: input.generation ?? null,
    status: 'empty',
    canAdopt: false,
    baselineChanged: false,
    diffUsesFrozenBaseline: !!candidate?.diff?.summary,
    ...patch,
  };
}

function identityError(record: CandidateReviewRecord): string | undefined {
  const { candidate, target } = record;
  const candidateId = candidate.candidateId || candidate.artifactId;
  if (candidateId !== candidate.artifactId
    || target.resultId !== candidate.artifactId
    || (target.artifactId && target.artifactId !== candidate.artifactId)
    || (target.taskId && target.taskId !== candidate.taskId)) {
    return '候选、Artifact 或生成任务身份不一致。';
  }
  const validation = candidate.constraintValidation;
  if (validation && (validation.artifactId !== candidate.artifactId
    || validation.taskId !== candidate.taskId
    || validation.novelId !== target.novelId
    || validation.chapterId !== target.chapterId
    || validation.sourceDraftId !== target.sourceDraftId
    || validation.sourceDraftVersion !== target.sourceRevision
    || validation.baseContentHash !== target.baseContentHash)) {
    return '约束结果不属于当前候选或当前章节。';
  }
  const diff = candidate.diff;
  if (diff?.summary && (diff.summary.candidateArtifactId !== candidate.artifactId
    || diff.summary.baseDraftId !== target.sourceDraftId
    || diff.summary.baseDraftVersion !== target.sourceRevision
    || diff.summary.baseContentHash !== target.baseContentHash)) {
    return '差异结果不属于当前候选或冻结基线。';
  }
  const proposal = candidate.proposal;
  const readyTargets = proposal?.targets.filter((item) => item.isReady) || [];
  if (proposal && (proposal.artifactId !== candidate.artifactId
    || readyTargets.length !== 1
    || readyTargets[0].novelId !== target.novelId
    || readyTargets[0].targetId !== target.chapterId
    || readyTargets[0].chapterId !== target.chapterId
    || readyTargets[0].draftId !== target.sourceDraftId
    || readyTargets[0].expectedVersion !== target.sourceRevision
    || readyTargets[0].expectedHash !== target.baseContentHash)) {
    return '采用目标不属于当前候选或冻结基线。';
  }
  return undefined;
}

export function deriveCandidateLifecycle(input: DeriveCandidateLifecycleInput): CandidateLifecycleContext {
  if (input.readError) {
    return context(input, { status: 'read_failed', cannotAdoptReason: input.readError });
  }
  const record = input.record;
  if (!record) {
    const activity = input.generation;
    if (activity?.status === 'generating') {
      return context(input, { status: 'generating', cannotAdoptReason: '候选仍在生成。' });
    }
    if (activity?.status === 'validating') {
      return context(input, { status: 'validating', cannotAdoptReason: '候选正在执行约束和差异检查。' });
    }
    if (activity?.status === 'cancelled') {
      return context(input, { status: 'cancelled', cannotAdoptReason: activity.message || '本次生成已取消。' });
    }
    if (activity?.status === 'failed') {
      return context(input, { status: 'failed', cannotAdoptReason: activity.message || '本次生成失败。' });
    }
    return context(input, { status: 'empty', cannotAdoptReason: '当前章节还没有可审查的正文候选。' });
  }

  const { candidate, target } = record;
  const identityFailure = identityError(record);
  if (identityFailure) {
    return context(input, { status: 'identity_mismatch', cannotAdoptReason: identityFailure });
  }
  if (target.novelId !== input.currentNovelId || target.chapterId !== input.currentChapterId) {
    return context(input, { status: 'invalidated', cannotAdoptReason: '该候选属于其他作品或章节。' });
  }
  if (!candidate.content.trim()) {
    return context(input, { status: 'empty_content', cannotAdoptReason: '候选正文为空，请重新生成。' });
  }
  if (record.adopted) {
    return context(input, { status: 'adopted', cannotAdoptReason: '该候选已经采用，不能再次采用。' });
  }
  if (record.invalidated) {
    return context(input, { status: 'invalidated', cannotAdoptReason: record.invalidatedReason || '该候选已失效。' });
  }

  const draft = input.currentDraft;
  const baselineChanged = !draft
    || draft.novelId !== target.novelId
    || draft.chapterId !== target.chapterId
    || draft.id !== target.sourceDraftId
    || draft.versionNo !== target.sourceRevision
    || (candidate.baseContent !== undefined && input.currentEditorContent !== undefined
      && candidate.baseContent !== input.currentEditorContent);
  if (baselineChanged) {
    return context(input, {
      status: 'baseline_changed',
      baselineChanged: true,
      cannotAdoptReason: '正文已变化；差异仍基于生成时的旧基线，禁止直接覆盖。',
    });
  }
  if (!candidate.constraintValidation) {
    return context(input, { status: 'validating', cannotAdoptReason: '约束检查尚未完成。' });
  }
  if (candidate.constraintValidation.status === 'blocked') {
    return context(input, { status: 'blocked', cannotAdoptReason: '候选被硬性约束阻断。' });
  }
  if (!candidate.diff || candidate.diff.status !== 'ready') {
    return context(input, { status: 'diff_failed', cannotAdoptReason: candidate.diff?.reason || '差异计算失败。' });
  }
  if (!candidate.proposal) {
    return context(input, { status: 'invalidated', cannotAdoptReason: '候选缺少可验证的采用目标。' });
  }
  return context(input, { status: 'ready', canAdopt: true });
}

export function acceptsCandidateAsyncResult(
  activity: CandidateGenerationActivity | null | undefined,
  identity: { requestId: string; taskId: string; candidateId: string; novelId: string; chapterId: string },
): boolean {
  return !!activity
    && activity.requestId === identity.requestId
    && activity.taskId === identity.taskId
    && activity.candidateId === identity.candidateId
    && activity.novelId === identity.novelId
    && activity.chapterId === identity.chapterId;
}

export function mergeCandidateActivity(
  current: CandidateGenerationActivity | undefined,
  incoming: CandidateGenerationActivity,
): CandidateGenerationActivity {
  if (!current || current.requestId === incoming.requestId || incoming.status === 'generating') return incoming;
  return current;
}

export function canPromoteCandidateRecord(
  activity: CandidateGenerationActivity | undefined,
  record: CandidateReviewRecord,
): boolean {
  if (!activity || activity.status === 'failed' || activity.status === 'cancelled') return true;
  const candidateId = record.candidate.candidateId || record.candidate.artifactId;
  if (!activity.taskId && activity.status === 'generating') return false;
  if (activity.taskId && activity.taskId !== record.candidate.taskId) return false;
  if (activity.candidateId && activity.candidateId !== candidateId) return false;
  return true;
}
