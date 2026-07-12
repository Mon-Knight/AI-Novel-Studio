import type {
  ApplyExecutionResult,
  ApplyPlan,
  ArtifactTargetLink,
  PlacementProposal,
  ProposalValidation,
} from '../../types/placement';
import { dbCall, lsGet, lsSet, nowISO } from '../database/db';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { draftVersionService } from '../database/draftVersionService';
import type { ChapterDraft } from '../../types/ai';

interface PlacementInput {
  artifactId: string;
  target: { novelId: string; chapterId: string; draftId?: string };
  browserExpectedVersion?: number;
  browserExpectedHash?: string;
}

interface CreatePlanInput {
  proposalId: string;
  source?: string;
  note?: string;
  qualityFix?: { fixRunId: string; fixedIssueIds: string[] };
}

const browserProposals = new Map<string, PlacementProposal>();
const browserPlans = new Map<string, ApplyPlan>();
const browserLinks = new Map<string, ArtifactTargetLink[]>();

function id(): string { return crypto.randomUUID(); }

async function browserProposal(input: PlacementInput, parentProposalId?: string): Promise<PlacementProposal> {
  const proposal: PlacementProposal = {
    proposalId: id(), artifactId: input.artifactId, parentProposalId, schemaVersion: 1,
    targets: [{
      targetType: 'chapter', targetId: input.target.chapterId, novelId: input.target.novelId,
      chapterId: input.target.chapterId, draftId: input.target.draftId,
      action: 'save_and_adopt_chapter_text', expectedVersion: input.browserExpectedVersion,
      expectedHash: input.browserExpectedHash, sourcePriority: 1, confidence: 1,
      reason: '用户显式指定目标', isReady: true,
    }],
    confidence: 1, reasons: ['用户显式指定目标'], warnings: [], unresolvedItems: [],
    projectRevisionHash: await computeContentSha256(JSON.stringify({
      artifactId: input.artifactId, target: input.target,
      expectedVersion: input.browserExpectedVersion, expectedHash: input.browserExpectedHash,
    })),
    createdAt: nowISO(),
  };
  browserProposals.set(proposal.proposalId, proposal);
  lsSet(`ai_novel_studio_placement_${proposal.proposalId}`, proposal);
  return proposal;
}

function loadBrowserArtifact(artifactId: string): Record<string, any> | null {
  return lsGet<Record<string, any>>(`ai_novel_studio_result_artifact_${artifactId}`);
}

function browserContent(artifactId: string): string {
  const artifact = loadBrowserArtifact(artifactId);
  const structured = artifact?.structuredPayloadJson;
  return structured?.chapterText || structured?.revisedContent || structured?.revised_content
    || artifact?.displayContent || artifact?.rawContent || '';
}

export const placementApplyService = {
  async createProposal(input: PlacementInput): Promise<PlacementProposal> {
    return dbCall('create_placement_proposal', { input }, () => browserProposal(input));
  },

  async validateProposal(proposalId: string): Promise<ProposalValidation> {
    return dbCall('validate_placement_proposal', { proposalId }, () => {
      const proposal = browserProposals.get(proposalId)
        || lsGet<PlacementProposal>(`ai_novel_studio_placement_${proposalId}`);
      return { proposalId, stale: !proposal, reason: proposal ? undefined : 'Proposal 不存在', currentProjectRevisionHash: proposal?.projectRevisionHash || '' };
    });
  },

  async rebuildProposal(proposalId: string, target: PlacementInput['target']): Promise<PlacementProposal> {
    return dbCall('rebuild_placement_proposal', { proposalId, target }, async () => {
      const previous = browserProposals.get(proposalId)
        || lsGet<PlacementProposal>(`ai_novel_studio_placement_${proposalId}`);
      if (!previous) throw { code: 'PLACEMENT_PROPOSAL_NOT_FOUND', message: 'Proposal 不存在', retryable: false };
      return browserProposal({ artifactId: previous.artifactId, target }, proposalId);
    });
  },

  async createPlan(input: CreatePlanInput): Promise<ApplyPlan> {
    return dbCall('create_apply_plan', { input }, async () => {
      const proposal = browserProposals.get(input.proposalId)
        || lsGet<PlacementProposal>(`ai_novel_studio_placement_${input.proposalId}`);
      if (!proposal) throw { code: 'PLACEMENT_PROPOSAL_NOT_FOUND', message: 'Proposal 不存在', retryable: false };
      const target = proposal.targets.find((item) => item.isReady);
      if (!target) throw { code: 'PLACEMENT_TARGET_UNRESOLVED', message: 'Ready Target 不存在', retryable: false };
      const operationId = id();
      const payload = { source: input.source || 'ai_generated', note: input.note, qualityFix: input.qualityFix || null };
      const payloadHash = await computeContentSha256(JSON.stringify(payload));
      const requestHash = await computeContentSha256(JSON.stringify({ artifactId: proposal.artifactId, proposalId: proposal.proposalId, target, payloadHash }));
      const plan: ApplyPlan = {
        planId: id(), proposalId: proposal.proposalId, artifactId: proposal.artifactId,
        schemaVersion: 1, operations: [{ applyOperationId: id(), operationIndex: 0,
          targetType: target.targetType, targetId: target.targetId, action: target.action,
          payload, payloadHash, expectedVersion: target.expectedVersion, expectedHash: target.expectedHash }],
        dependencies: [], expectedVersions: { [target.targetId]: target.expectedVersion ?? null },
        expectedHashes: { [target.targetId]: target.expectedHash ?? null }, conflicts: [],
        operationId, requestHash, status: 'ready', createdAt: nowISO(),
      };
      browserPlans.set(plan.planId, plan);
      lsSet(`ai_novel_studio_apply_plan_${plan.planId}`, plan);
      return plan;
    });
  },

  async executePlan(plan: ApplyPlan): Promise<ApplyExecutionResult> {
    return dbCall('execute_apply_plan', { input: { planId: plan.planId, operationId: plan.operationId, requestHash: plan.requestHash } }, async () => {
      const stored = browserPlans.get(plan.planId)
        || lsGet<ApplyPlan>(`ai_novel_studio_apply_plan_${plan.planId}`);
      if (!stored || stored.operationId !== plan.operationId || stored.requestHash !== plan.requestHash) {
        throw { code: 'OPERATION_PAYLOAD_CONFLICT', message: 'ApplyPlan 请求身份不一致', retryable: false };
      }
      const replay = browserLinks.get(plan.planId);
      if (stored.status === 'completed' && replay) {
        return { planId: stored.planId, operationId: stored.operationId, status: 'completed',
          targetLinks: replay, result: stored.result, idempotentReplay: true };
      }
      const target = browserProposals.get(stored.proposalId)?.targets.find((item) => item.isReady);
      if (!target) throw { code: 'APPLY_PLAN_STALE', message: '目标已失效', retryable: false };
      const content = browserContent(stored.artifactId);
      if (!content.trim()) throw { code: 'ARTIFACT_VALIDATION_FAILED', message: 'Artifact 正文不可用', retryable: false };
      const draftsKey = `ai_novel_studio_drafts_list_${target.targetId}`;
      const beforeDrafts = localStorage.getItem(draftsKey);
      let adopted: ChapterDraft;
      let contentHash: string;
      try {
        const draft = await draftVersionService.create({ novelId: target.novelId, chapterId: target.targetId,
          content, source: (stored.operations[0].payload.source as any) || 'ai_generated',
          artifactId: stored.artifactId, sourceType: 'ai_task_artifact', sourceId: stored.artifactId });
        contentHash = draft.contentState?.status === 'ready' ? draft.contentState.contentHash : await computeContentSha256(content);
        adopted = await draftVersionService.adoptExact({ novelId: target.novelId, chapterId: target.targetId,
          draftId: draft.id, draftVersion: draft.versionNo, contentHash, operationId: stored.operationId });
      } catch (error) {
        if (beforeDrafts === null) localStorage.removeItem(draftsKey);
        else localStorage.setItem(draftsKey, beforeDrafts);
        throw error;
      }
      const link: ArtifactTargetLink = { linkId: id(), artifactId: stored.artifactId, planId: stored.planId,
        applyOperationId: stored.operations[0].applyOperationId, targetType: 'chapter_draft', targetId: adopted.id,
        targetVersion: adopted.versionNo, targetHash: contentHash, operationId: stored.operationId,
        resultMetadata: { adopted: true }, createdAt: nowISO() };
      const completed = { ...stored, status: 'completed' as const, result: { draft: adopted, contentHash }, completedAt: nowISO() };
      browserPlans.set(stored.planId, completed); browserLinks.set(stored.planId, [link]);
      lsSet(`ai_novel_studio_apply_plan_${stored.planId}`, completed);
      return { planId: stored.planId, operationId: stored.operationId, status: 'completed', targetLinks: [link],
        result: completed.result, idempotentReplay: false };
    });
  },
};
