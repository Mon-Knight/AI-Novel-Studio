import { dbCall, isTauri, nowISO } from '../database/db';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { planStructuredApply, STRUCTURED_APPLY_REJECTION_MESSAGES } from './structuredApplyPolicy';
import type { RecordDecisionInput } from './artifactDecisionService';
import type { WorldRuleChangeImpact } from '../../types/worldRules';

/** Read-only native preview. It never confirms, records a decision, or applies anything. */
export const structuredRuleGovernanceService = {
  async preview(input: RecordDecisionInput): Promise<WorldRuleChangeImpact | null> {
    if (!isTauri()) throw new Error('浏览器候选不能冒充桌面规则应用预览。');
    const bundle = await aiTaskRuntimeService.getArtifact(input.artifactId);
    const { artifact } = bundle;
    const planned = planStructuredApply({
      artifact,
      payload: bundle.structuredPayloadJson,
      requested: {
        novelId: input.novelId,
        targetType: input.targetType,
        targetId: input.targetId,
        chapterId: input.chapterId,
      },
    });
    if (!planned.ok) throw new Error(STRUCTURED_APPLY_REJECTION_MESSAGES[planned.reason]);
    return dbCall<WorldRuleChangeImpact | null>('preview_structured_artifact_rule_change', {
      input: {
        decisionId: 'preview-' + input.cardId,
        artifactId: artifact.artifactId,
        artifactHash: artifact.contentHash,
        cardId: input.cardId,
        conversationId: input.conversationId,
        idempotencyKey: input.cardId + ':request_apply:atomic-v1',
        actor: 'user',
        targetType: planned.plan.targetType,
        targetId: planned.plan.targetId,
        novelId: artifact.sourceNovelId,
        chapterId: planned.plan.chapterId,
        baseRevision: artifact.sourceBaseContentHash,
        createdAt: nowISO(),
      },
    });
  },
};
