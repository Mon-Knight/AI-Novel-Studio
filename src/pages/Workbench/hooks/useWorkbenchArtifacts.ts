import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ArtifactDecisionKind, ConversationArtifactCard } from '../../../types/conversation';
import { artifactDecisionService } from '../../../services/conversation/artifactDecisionService';
import { appendArtifactRevisionDraft, buildArtifactRevisionDraft } from '../artifactRevisionPrompt';
import { resolveArtifactDecisionTarget } from '../workbenchHelpers';
import { captureArtifactRevisionSource } from '../../../services/conversation/artifactRevisionSourceService';
import { useWorkbenchDraftStore } from '../../../store/workbenchDraftStore';
import type { ReviewAuthorization } from '../../../types/conversation';
import type { WorldRuleChangeImpact, WorldRuleSaveGuard } from '../../../types/worldRules';
import { structuredRuleGovernanceService } from '../../../services/conversation/structuredRuleGovernanceService';
import type { RecordDecisionInput } from '../../../services/conversation/artifactDecisionService';

type RuleApplicationGuard = Required<
  Pick<WorldRuleSaveGuard, 'expectedRuleSetFingerprint' | 'changeAuthorization'>
>;

export function useWorkbenchArtifacts(input: {
  selectedNovelId: string;
  chapterId: string | undefined;
  refreshBundle: (conversationId: string) => Promise<void>;
  loadConversations: (novelId?: string) => Promise<void>;
  selectedNovelRef: React.MutableRefObject<string>;
  selectedConversationRef?: React.MutableRefObject<string>;
  setComposerError: (error: string) => void;
  setDraft?: React.Dispatch<React.SetStateAction<string>>;
  onStructuredArtifactDecision?: (input: {
    artifact: ConversationArtifactCard;
    decision: ArtifactDecisionKind;
    applied: boolean;
  }) => Promise<void> | void;
}) {
  const {
    selectedNovelId,
    chapterId,
    refreshBundle,
    loadConversations,
    selectedNovelRef,
    selectedConversationRef,
    setComposerError,
    setDraft,
    onStructuredArtifactDecision,
  } = input;
  const navigate = useNavigate();
  const [decisionBusyCardId, setDecisionBusyCardId] = useState('');
  const decisionInFlightRef = useRef(false);
  const [pendingRuleChangeReview, setPendingRuleChangeReview] = useState<{
    artifact: ConversationArtifactCard;
    artifactHash: string;
    preview: WorldRuleChangeImpact;
  } | null>(null);
  const [ruleChangeReviewError, setRuleChangeReviewError] = useState('');
  const selectedTaskId = selectedConversationRef?.current;
  useEffect(() => {
    if (
      pendingRuleChangeReview &&
      ((selectedTaskId && pendingRuleChangeReview.artifact.conversationId !== selectedTaskId) ||
        pendingRuleChangeReview.preview.novelId !== selectedNovelId)
    ) {
      setPendingRuleChangeReview(null);
      setRuleChangeReviewError('');
    }
  }, [selectedTaskId, selectedNovelId, pendingRuleChangeReview]);

  async function decideArtifact(
    artifact: ConversationArtifactCard,
    decision: ArtifactDecisionKind,
    revisionNotes?: string,
    ruleGuard?: RuleApplicationGuard,
  ) {
    if (!selectedNovelId || !artifact.artifactId || decisionInFlightRef.current) return;
    // Lock before React rerenders so another card cannot unlock a pending review.
    decisionInFlightRef.current = true;
    setDecisionBusyCardId(artifact.cardId);
    setComposerError('');
    let revisionRecorded = false;
    let decisionRecorded = false;
    const openReview = (authorization: ReviewAuthorization) => {
      if (
        authorization.artifactId !== artifact.artifactId ||
        authorization.novelId !== selectedNovelId ||
        (artifact.artifactEvidence?.sourceChapterId &&
          authorization.chapterId !== artifact.artifactEvidence.sourceChapterId)
      ) {
        throw new Error('审阅授权与当前候选作用域不一致。');
      }
      if (authorization.status === 'expired') {
        throw new Error('审阅授权已失效，请要求修改并审阅新候选；不会自动签发新授权。');
      }
      if (
        selectedNovelRef.current !== selectedNovelId ||
        (selectedConversationRef && selectedConversationRef.current !== artifact.conversationId)
      )
        return;
      navigate(
        `/novels/${selectedNovelId}/workspace?chapterId=${encodeURIComponent(authorization.chapterId)}&authorizationId=${encodeURIComponent(authorization.authorizationId)}&artifactId=${encodeURIComponent(artifact.artifactId!)}`,
      );
    };
    try {
      if (decision === 'confirm' && artifact.reviewAuthorization) {
        const authorization = await artifactDecisionService.getAuthorization(
          artifact.reviewAuthorization.authorizationId,
        );
        if (!authorization) throw new Error('审阅授权无法读取，请刷新后重试。');
        openReview(authorization);
        return;
      }
      const existingSource =
        useWorkbenchDraftStore.getState().drafts[artifact.conversationId]?.revisionSource;
      if (
        decision === 'request_revision' &&
        existingSource &&
        existingSource.artifactId !== artifact.artifactId
      ) {
        throw new Error(
          '输入区已绑定另一份修订候选，请先发送或明确移除来源，再选择这份候选；原有意见已保留。',
        );
      }
      const target = resolveArtifactDecisionTarget({
        artifactType: artifact.artifactType,
        sourceChapterId: artifact.artifactEvidence?.sourceChapterId,
        currentChapterId: chapterId,
        novelId: selectedNovelId,
      });
      const payload: RecordDecisionInput = {
        conversationId: artifact.conversationId,
        cardId: artifact.cardId,
        artifactId: artifact.artifactId,
        decision,
        targetType: target.targetType,
        targetId: target.targetId,
        novelId: selectedNovelId,
        chapterId: target.chapterId,
        baseRevision: artifact.artifactEvidence?.baseContentHash,
      };
      if (decision === 'request_apply' && artifact.artifactType === 'setting_candidates') {
        const preview = await structuredRuleGovernanceService.preview(payload);
        if (
          selectedNovelRef.current !== selectedNovelId ||
          (selectedConversationRef && selectedConversationRef.current !== artifact.conversationId)
        ) {
          throw new Error('任务已切换，规则候选未应用；请返回原任务重新确认。');
        }
        if (
          ruleGuard &&
          (!preview ||
            preview.previewHash !== ruleGuard.changeAuthorization.previewHash ||
            preview.ruleSetFingerprint !== ruleGuard.expectedRuleSetFingerprint)
        ) {
          throw new Error('规则候选或影响范围已变化，请重新打开预览并确认。');
        }
        if (preview?.requiresConfirmation && !ruleGuard) {
          const candidate = await artifactDecisionService.readCandidateForReview(payload);
          if (
            selectedNovelRef.current !== selectedNovelId ||
            (selectedConversationRef && selectedConversationRef.current !== artifact.conversationId)
          )
            return;
          setPendingRuleChangeReview({
            artifact: { ...artifact, content: candidate.content, contentLoadError: undefined },
            artifactHash: candidate.artifactHash,
            preview,
          });
          setRuleChangeReviewError('');
          return;
        }
        if (ruleGuard) {
          const candidate = await artifactDecisionService.readCandidateForReview(payload);
          if (
            !pendingRuleChangeReview ||
            candidate.artifactHash !== pendingRuleChangeReview.artifactHash ||
            pendingRuleChangeReview.artifact.cardId !== artifact.cardId ||
            selectedNovelRef.current !== selectedNovelId ||
            (selectedConversationRef && selectedConversationRef.current !== artifact.conversationId)
          ) {
            throw new Error('候选全文或任务已变化，未应用；请重新审阅。');
          }
        }
        if (preview?.blockingConflicts.length)
          throw new Error('规则变更仍有阻断冲突，候选未应用。');
        if (preview) payload.expectedRuleSetFingerprint = preview.ruleSetFingerprint;
        if (ruleGuard) payload.changeAuthorization = ruleGuard.changeAuthorization;
      }
      const result =
        decision === 'request_apply'
          ? await artifactDecisionService.applyStructured(payload)
          : await artifactDecisionService.record(payload);
      decisionRecorded = true;
      if (ruleGuard) {
        setPendingRuleChangeReview(null);
        setRuleChangeReviewError('');
      }
      if (decision === 'request_revision') {
        revisionRecorded = true;
        const revisionDraft = buildArtifactRevisionDraft(artifact.artifactType, revisionNotes);
        useWorkbenchDraftStore
          .getState()
          .bindRevisionSource(
            artifact.conversationId,
            captureArtifactRevisionSource(artifact, selectedNovelId, result.decision.artifactHash),
          );
        // The captured setter belongs to the originating conversation. A functional
        // update keeps text entered while the decision was pending, even after a switch.
        setDraft?.((existingDraft) => appendArtifactRevisionDraft(existingDraft, revisionDraft));
      }
      try {
        await refreshBundle(artifact.conversationId);
        if (selectedNovelRef.current === selectedNovelId) {
          await loadConversations(selectedNovelId);
        }
      } catch {
        setComposerError(
          revisionRecorded
            ? '修订请求已记录，但产物状态刷新失败；输入区内容与修订来源已保留。'
            : result.authorization
              ? '审阅授权已取得，但列表刷新失败；仍可继续审阅，不必再次确认。'
              : '产物决定已记录，但列表刷新失败，请重新读取产物。',
        );
      }
      const applied = Boolean(
        decision === 'request_apply' &&
        result.decision.applyTransactionId &&
        !result.decision.conflictCode,
      );
      if (decision !== 'confirm') {
        try {
          await onStructuredArtifactDecision?.({ artifact, decision, applied });
        } catch {
          setComposerError(
            applied
              ? '产物已应用，但核心资产状态刷新失败；请点击“重新检查”。'
              : '产物决定已记录，但创作准备状态刷新失败；请点击“重新检查”。',
          );
        }
      }
      if (result.authorization) openReview(result.authorization);
    } catch (error) {
      const message = error instanceof Error ? error.message : '产物决定失败';
      if (ruleGuard) setRuleChangeReviewError(message);
      setComposerError(
        revisionRecorded
          ? `修订请求已记录，但产物状态刷新失败；输入区内容已保留。${message}`
          : decisionRecorded
            ? `决定已记录，但后续操作未完成；可以重新读取后继续。${message}`
            : message,
      );
    } finally {
      decisionInFlightRef.current = false;
      setDecisionBusyCardId('');
    }
  }

  return {
    decisionBusyCardId,
    decideArtifact,
    pendingRuleChangeReview,
    ruleChangeReviewError,
    ruleChangeReviewBusy: Boolean(decisionBusyCardId),
    cancelRuleChangeReview: () => {
      if (!decisionInFlightRef.current) {
        setPendingRuleChangeReview(null);
        setRuleChangeReviewError('');
      }
    },
    confirmRuleChangeReview: async (guard: RuleApplicationGuard) => {
      const pending = pendingRuleChangeReview;
      if (
        !pending ||
        pending.preview.previewHash !== guard.changeAuthorization.previewHash ||
        pending.preview.ruleSetFingerprint !== guard.expectedRuleSetFingerprint
      )
        return;
      await decideArtifact(pending.artifact, 'request_apply', undefined, guard);
    },
  };
}
