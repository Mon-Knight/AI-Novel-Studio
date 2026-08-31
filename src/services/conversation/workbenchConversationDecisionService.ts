import type {
  ArtifactDecision,
  ConversationArtifactCard,
  TaskConversationBundle,
} from '../../types/conversation';
import { artifactDecisionService, type RecordDecisionInput } from './artifactDecisionService';
import { adoptWorkbenchChapterCandidateFromConversation } from './workbenchChapterConversationAdoption';
import type { WorkbenchDecisionIntent } from './workbenchDecisionIntent';

const VALID_ARTIFACT_STATUSES = new Set(['valid', 'valid_with_warnings']);

export interface WorkbenchConversationDecisionInput {
  intent: WorkbenchDecisionIntent;
  conversationId: string;
  novelId: string;
  chapterId?: string;
  bundle: TaskConversationBundle;
  pendingAssetArtifactId?: string;
  pendingSummaryCardId?: string;
}

export interface WorkbenchConversationDecisionResult {
  artifact: ConversationArtifactCard;
  decision: ArtifactDecision;
  applied: boolean;
  adopted: boolean;
  continueAfter: boolean;
  assistantMessage: string;
}

export interface WorkbenchConversationDecisionDependencies {
  applyStructured?: typeof artifactDecisionService.applyStructured;
  recordDecision?: typeof artifactDecisionService.record;
  adoptChapter?: typeof adoptWorkbenchChapterCandidateFromConversation;
}

function decisionError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.code = code;
  return error;
}

function latestDecision(
  bundle: TaskConversationBundle,
  artifact: ConversationArtifactCard,
): ArtifactDecision | undefined {
  if (artifact.latestDecision) return artifact.latestDecision;
  const decisions = [...(bundle.decisions ?? [])]
    .filter(
      (decision) =>
        decision.cardId === artifact.cardId ||
        (Boolean(artifact.artifactId) && decision.artifactId === artifact.artifactId),
    )
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.decisionId.localeCompare(right.decisionId),
    );
  return decisions[decisions.length - 1];
}

function assertArtifactScope(
  input: WorkbenchConversationDecisionInput,
  artifact: ConversationArtifactCard,
): void {
  if (
    !artifact.artifactId ||
    artifact.conversationId !== input.conversationId ||
    artifact.artifactEvidence?.sourceNovelId !== input.novelId ||
    !VALID_ARTIFACT_STATUSES.has(artifact.artifactEvidence.processingStatus)
  ) {
    throw decisionError(
      'WORKBENCH_DECISION_SCOPE_MISMATCH',
      '当前候选与任务、作品或权威产物范围不一致。',
    );
  }
}

function resolveAssetArtifact(input: WorkbenchConversationDecisionInput): ConversationArtifactCard {
  if (!input.pendingAssetArtifactId) {
    throw decisionError('WORKBENCH_DECISION_TARGET_MISSING', '当前没有等待应用的创作资产候选。');
  }
  const matches = input.bundle.artifacts.filter(
    (artifact) =>
      artifact.artifactId === input.pendingAssetArtifactId &&
      artifact.artifactType !== 'chapter_text' &&
      artifact.artifactType !== 'chapter_summary',
  );
  if (matches.length !== 1) {
    throw decisionError(
      'WORKBENCH_DECISION_TARGET_AMBIGUOUS',
      '无法唯一确定等待应用的创作资产候选。',
    );
  }
  assertArtifactScope(input, matches[0]);
  return matches[0];
}

function resolveSummaryArtifact(
  input: WorkbenchConversationDecisionInput,
): ConversationArtifactCard {
  if (!input.pendingSummaryCardId) {
    throw decisionError('WORKBENCH_DECISION_TARGET_MISSING', '当前没有等待应用的章节总结候选。');
  }
  const matches = input.bundle.artifacts.filter(
    (artifact) =>
      artifact.cardId === input.pendingSummaryCardId && artifact.artifactType === 'chapter_summary',
  );
  if (matches.length !== 1) {
    throw decisionError(
      'WORKBENCH_DECISION_TARGET_AMBIGUOUS',
      '无法唯一确定等待应用的章节总结候选。',
    );
  }
  const artifact = matches[0];
  assertArtifactScope(input, artifact);
  if (!input.chapterId || artifact.artifactEvidence?.sourceChapterId !== input.chapterId) {
    throw decisionError('WORKBENCH_DECISION_SCOPE_MISMATCH', '章节总结候选与当前章节不一致。');
  }
  return artifact;
}

function resolveChapterArtifact(
  input: WorkbenchConversationDecisionInput,
): ConversationArtifactCard {
  if (!input.chapterId) {
    throw decisionError('WORKBENCH_DECISION_TARGET_MISSING', '当前任务没有绑定可采用的章节。');
  }
  const matches = input.bundle.artifacts.filter((artifact) => {
    if (
      artifact.artifactType !== 'chapter_text' ||
      artifact.artifactEvidence?.sourceNovelId !== input.novelId ||
      artifact.artifactEvidence.sourceChapterId !== input.chapterId ||
      !VALID_ARTIFACT_STATUSES.has(artifact.artifactEvidence.processingStatus)
    ) {
      return false;
    }
    const decision = latestDecision(input.bundle, artifact);
    if (!decision) return true;
    if (decision.decision !== 'confirm') return false;
    return Boolean(
      input.bundle.authorizations?.some(
        (authorization) =>
          authorization.decisionId === decision.decisionId && authorization.status === 'issued',
      ),
    );
  });
  if (matches.length !== 1) {
    throw decisionError(
      matches.length === 0
        ? 'WORKBENCH_DECISION_TARGET_MISSING'
        : 'WORKBENCH_DECISION_TARGET_AMBIGUOUS',
      matches.length === 0
        ? '当前章节没有等待采用的正文候选。'
        : '当前章节存在多个未决正文候选，请先明确选择其中一个。',
    );
  }
  assertArtifactScope(input, matches[0]);
  return matches[0];
}

function resolveArtifact(input: WorkbenchConversationDecisionInput): ConversationArtifactCard {
  switch (input.intent.target) {
    case 'asset':
      return resolveAssetArtifact(input);
    case 'summary':
      return resolveSummaryArtifact(input);
    case 'chapter':
      return resolveChapterArtifact(input);
  }
}

function decisionPayload(
  input: WorkbenchConversationDecisionInput,
  artifact: ConversationArtifactCard,
  decision: RecordDecisionInput['decision'],
): RecordDecisionInput {
  const sourceChapterId = artifact.artifactEvidence?.sourceChapterId;
  const chapterScoped =
    artifact.artifactType === 'chapter_text' ||
    artifact.artifactType === 'event_candidates' ||
    artifact.artifactType === 'chapter_summary' ||
    (artifact.artifactType === 'outline' && Boolean(sourceChapterId));
  return {
    conversationId: input.conversationId,
    cardId: artifact.cardId,
    artifactId: artifact.artifactId!,
    decision,
    targetType: artifact.artifactType === 'chapter_text' ? 'chapter' : 'asset',
    targetId: chapterScoped && sourceChapterId ? sourceChapterId : input.novelId,
    novelId: input.novelId,
    chapterId: sourceChapterId,
    baseRevision: artifact.artifactEvidence?.baseContentHash,
  };
}

export async function executeWorkbenchConversationDecision(
  input: WorkbenchConversationDecisionInput,
  dependencies: WorkbenchConversationDecisionDependencies = {},
): Promise<WorkbenchConversationDecisionResult> {
  if (
    input.bundle.conversation.conversationId !== input.conversationId ||
    input.bundle.conversation.novelId !== input.novelId
  ) {
    throw decisionError(
      'WORKBENCH_DECISION_SCOPE_MISMATCH',
      '当前对话快照与所选任务或作品不一致。',
    );
  }
  const artifact = resolveArtifact(input);
  const applyStructured =
    dependencies.applyStructured ??
    artifactDecisionService.applyStructured.bind(artifactDecisionService);
  const recordDecision =
    dependencies.recordDecision ?? artifactDecisionService.record.bind(artifactDecisionService);
  const adoptChapter = dependencies.adoptChapter ?? adoptWorkbenchChapterCandidateFromConversation;

  if (input.intent.kind === 'adopt_chapter') {
    const adopted = await adoptChapter({
      conversationId: input.conversationId,
      novelId: input.novelId,
      chapterId: input.chapterId!,
      artifact,
    });
    return {
      artifact,
      decision: adopted.decision,
      applied: true,
      adopted: true,
      continueAfter: input.intent.continueAfter,
      assistantMessage: input.intent.continueAfter
        ? '本章候选已采用为正式正文。系统将先生成并等待应用章节总结，再继续下一章。'
        : '本章候选已采用为正式正文，系统正在准备章节总结。',
    };
  }

  const decisionKind =
    input.intent.kind === 'apply_current'
      ? 'request_apply'
      : input.intent.kind === 'reject_current'
        ? 'reject'
        : 'request_revision';
  const payload = decisionPayload(input, artifact, decisionKind);
  const result =
    decisionKind === 'request_apply'
      ? await applyStructured(payload)
      : await recordDecision(payload);
  const applied = Boolean(
    decisionKind === 'request_apply' &&
    result.decision.applyTransactionId &&
    !result.decision.conflictCode,
  );
  if (decisionKind === 'request_apply' && !applied) {
    throw decisionError(
      result.decision.conflictCode || 'WORKBENCH_STRUCTURED_APPLY_INCOMPLETE',
      result.decision.conflictCode
        ? `候选应用发生冲突：${result.decision.conflictCode}`
        : '候选没有形成可验证的应用事务。',
    );
  }

  const subject = input.intent.target === 'summary' ? '章节总结候选' : '创作资产候选';
  const assistantMessage =
    decisionKind === 'request_apply'
      ? input.intent.target === 'summary'
        ? input.intent.continueAfter
          ? '章节总结已应用到正式上下文，正在继续下一章。'
          : '章节总结已应用到正式上下文。'
        : '创作资产候选已应用到作品，系统将继续准备缺失资产或恢复原创作目标。'
      : decisionKind === 'reject'
        ? `${subject}已拒绝，不会写入正式事实。`
        : `${subject}已记录为需要修改，不会写入正式事实。`;
  return {
    artifact,
    decision: result.decision,
    applied,
    adopted: false,
    continueAfter: input.intent.continueAfter,
    assistantMessage,
  };
}
