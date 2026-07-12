import { beforeEach, describe, expect, it, vi } from 'vitest';

const { create, adoptExact } = vi.hoisted(() => ({ create: vi.fn(), adoptExact: vi.fn() }));

vi.mock('../../services/database/draftVersionService', () => ({
  draftVersionService: { create, adoptExact },
}));

import { placementApplyService } from '../../services/ai-tasks/placementApplyService';
import type { ApplyPlan } from '../../types/placement';

const draft = {
  id: 'applied-draft', novelId: 'novel-a', chapterId: 'chapter-a', content: 'candidate text',
  source: 'ai_generated', versionNo: 4, wordCount: 2, isAdopted: false,
  createdAt: 'now', updatedAt: 'now',
  contentState: { status: 'ready' as const, contentHash: 'content-hash', contentLength: 14 },
};

async function createReadyPlan(suffix: string): Promise<ApplyPlan> {
  localStorage.setItem(`ai_novel_studio_result_artifact_artifact-${suffix}`, JSON.stringify({
    artifactId: `artifact-${suffix}`, rawContent: 'candidate text', displayContent: 'candidate text',
  }));
  const proposal = await placementApplyService.createProposal({
    artifactId: `artifact-${suffix}`,
    target: { novelId: 'novel-a', chapterId: 'chapter-a', draftId: 'draft-a' },
    browserExpectedVersion: 3, browserExpectedHash: 'source-hash',
  });
  return placementApplyService.createPlan({ proposalId: proposal.proposalId, source: 'ai_generated' });
}

describe('ApplyPlan browser contract', () => {
  beforeEach(() => {
    localStorage.clear(); create.mockReset(); adoptExact.mockReset();
    create.mockResolvedValue(draft);
    adoptExact.mockResolvedValue({ ...draft, isAdopted: true });
  });

  it('APPLY-TS-01 creates a ready immutable plan', async () => {
    const plan = await createReadyPlan('1');
    expect(plan.status).toBe('ready'); expect(plan.operations).toHaveLength(1);
  });

  it('APPLY-TS-02 assigns operationId and requestHash', async () => {
    const plan = await createReadyPlan('2');
    expect(plan.operationId).toBeTruthy(); expect(plan.requestHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('APPLY-TS-03 freezes expected version and hash', async () => {
    const plan = await createReadyPlan('3');
    expect(plan.operations[0]).toMatchObject({ expectedVersion: 3, expectedHash: 'source-hash' });
  });

  it('APPLY-TS-04 persists the plan for recovery', async () => {
    const plan = await createReadyPlan('4');
    expect(localStorage.getItem(`ai_novel_studio_apply_plan_${plan.planId}`)).toContain(plan.operationId);
  });

  it('APPLY-TS-05 executes save and adopt once', async () => {
    const plan = await createReadyPlan('5');
    const result = await placementApplyService.executePlan(plan);
    expect(result.status).toBe('completed'); expect(create).toHaveBeenCalledTimes(1); expect(adoptExact).toHaveBeenCalledTimes(1);
  });

  it('APPLY-TS-06 writes one ArtifactTargetLink', async () => {
    const plan = await createReadyPlan('6');
    const result = await placementApplyService.executePlan(plan);
    expect(result.targetLinks).toHaveLength(1);
    expect(result.targetLinks[0]).toMatchObject({ artifactId: 'artifact-6', targetType: 'chapter_draft' });
  });

  it('APPLY-TS-07 replay returns first result without writes', async () => {
    const plan = await createReadyPlan('7');
    await placementApplyService.executePlan(plan);
    const replay = await placementApplyService.executePlan(plan);
    expect(replay.idempotentReplay).toBe(true); expect(create).toHaveBeenCalledTimes(1); expect(adoptExact).toHaveBeenCalledTimes(1);
  });

  it('APPLY-TS-08 rejects changed operationId', async () => {
    const plan = await createReadyPlan('8');
    await expect(placementApplyService.executePlan({ ...plan, operationId: 'changed' })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('APPLY-TS-09 rejects changed requestHash', async () => {
    const plan = await createReadyPlan('9');
    await expect(placementApplyService.executePlan({ ...plan, requestHash: 'changed' })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('APPLY-TS-10 missing Artifact content fails before draft write', async () => {
    const plan = await createReadyPlan('10');
    localStorage.removeItem('ai_novel_studio_result_artifact_artifact-10');
    await expect(placementApplyService.executePlan(plan)).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });

  it('APPLY-TS-11 distinct plans use distinct business operation ids', async () => {
    const first = await createReadyPlan('11a'); const second = await createReadyPlan('11b');
    expect(first.operationId).not.toBe(second.operationId); expect(first.planId).not.toBe(second.planId);
  });

  it('APPLY-TS-12 adopt failure propagates and does not report success', async () => {
    const plan = await createReadyPlan('12');
    localStorage.setItem('ai_novel_studio_drafts_list_chapter-a', 'before');
    create.mockImplementationOnce(async () => {
      localStorage.setItem('ai_novel_studio_drafts_list_chapter-a', 'partial');
      return draft;
    });
    adoptExact.mockRejectedValueOnce(new Error('forced adoption failure'));
    await expect(placementApplyService.executePlan(plan)).rejects.toThrow('forced adoption failure');
    expect(localStorage.getItem('ai_novel_studio_drafts_list_chapter-a')).toBe('before');
  });
});
