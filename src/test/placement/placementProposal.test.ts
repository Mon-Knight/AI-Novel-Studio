import { beforeEach, describe, expect, it } from 'vitest';
import { placementApplyService } from '../../services/ai-tasks/placementApplyService';

function seedArtifact(artifactId: string, content = 'candidate text') {
  localStorage.setItem(`ai_novel_studio_result_artifact_${artifactId}`, JSON.stringify({
    artifactId, processingStatus: 'valid', rawContent: content, displayContent: content,
  }));
}

function seedChapterConstraintValidation(artifactId: string, status: 'passed' | 'blocked') {
  localStorage.setItem(`ai_novel_studio_chapter_constraint_validation_${artifactId}`, JSON.stringify([{ status }]));
}

function requireChapterConstraintValidation(artifactId: string) {
  const stored = JSON.parse(localStorage.getItem(`ai_novel_studio_result_artifact_${artifactId}`) || '{}');
  stored.requiresChapterConstraintValidation = true;
  localStorage.setItem(`ai_novel_studio_result_artifact_${artifactId}`, JSON.stringify(stored));
}

function input(artifactId: string, chapterId = 'chapter-a') {
  return {
    artifactId,
    target: { novelId: 'novel-a', chapterId, draftId: 'draft-a' },
    browserExpectedVersion: 3,
    browserExpectedHash: 'hash-a',
  };
}

describe('PlacementProposal browser contract', () => {
  beforeEach(() => localStorage.clear());

  it('PLC-TS-01 creates a persisted proposal', async () => {
    seedArtifact('artifact-1');
    const proposal = await placementApplyService.createProposal(input('artifact-1'));
    expect(proposal.proposalId).toBeTruthy();
    expect(localStorage.getItem(`ai_novel_studio_placement_${proposal.proposalId}`)).toContain('artifact-1');
  });

  it('PLC-TS-02 creates exactly one ready target', async () => {
    seedArtifact('artifact-2');
    const proposal = await placementApplyService.createProposal(input('artifact-2'));
    expect(proposal.targets.filter((target) => target.isReady)).toHaveLength(1);
  });

  it('PLC-TS-03 records user target as highest priority', async () => {
    seedArtifact('artifact-3');
    const proposal = await placementApplyService.createProposal(input('artifact-3'));
    expect(proposal.targets[0].sourcePriority).toBe(1);
    expect(proposal.targets[0].reason).toContain('用户');
  });

  it('PLC-TS-04 freezes expected version and hash', async () => {
    seedArtifact('artifact-4');
    const proposal = await placementApplyService.createProposal(input('artifact-4'));
    expect(proposal.targets[0].expectedVersion).toBe(3);
    expect(proposal.targets[0].expectedHash).toBe('hash-a');
  });

  it('PLC-TS-05 validates a live proposal', async () => {
    seedArtifact('artifact-5');
    const proposal = await placementApplyService.createProposal(input('artifact-5'));
    await expect(placementApplyService.validateProposal(proposal.proposalId)).resolves.toMatchObject({ stale: false });
  });

  it('PLC-TS-06 reports missing proposal as stale', async () => {
    await expect(placementApplyService.validateProposal('missing')).resolves.toMatchObject({ stale: true });
  });

  it('PLC-TS-07 rebuild creates a new proposal id', async () => {
    seedArtifact('artifact-7');
    const first = await placementApplyService.createProposal(input('artifact-7'));
    const rebuilt = await placementApplyService.rebuildProposal(first.proposalId, {
      novelId: 'novel-a', chapterId: 'chapter-a2', draftId: 'draft-b',
    });
    expect(rebuilt.proposalId).not.toBe(first.proposalId);
  });

  it('PLC-TS-08 rebuild records immutable parent', async () => {
    seedArtifact('artifact-8');
    const first = await placementApplyService.createProposal(input('artifact-8'));
    const rebuilt = await placementApplyService.rebuildProposal(first.proposalId, {
      novelId: 'novel-a', chapterId: 'chapter-a2',
    });
    expect(rebuilt.parentProposalId).toBe(first.proposalId);
  });

  it('PLC-TS-09 keeps artifact identity across rebuild', async () => {
    seedArtifact('artifact-9');
    const first = await placementApplyService.createProposal(input('artifact-9'));
    const rebuilt = await placementApplyService.rebuildProposal(first.proposalId, {
      novelId: 'novel-a', chapterId: 'chapter-a2',
    });
    expect(rebuilt.artifactId).toBe(first.artifactId);
  });

  it('PLC-TS-10 project revision hash changes with target baseline', async () => {
    seedArtifact('artifact-10');
    const first = await placementApplyService.createProposal(input('artifact-10'));
    const second = await placementApplyService.createProposal({
      ...input('artifact-10'), browserExpectedVersion: 4, browserExpectedHash: 'hash-b',
    });
    expect(second.projectRevisionHash).not.toBe(first.projectRevisionHash);
  });

  it('PLC-TS-11 refuses a chapter-generation Artifact without a persisted constraint result', async () => {
    seedArtifact('artifact-11');
    requireChapterConstraintValidation('artifact-11');
    await expect(placementApplyService.createProposal(input('artifact-11'))).rejects.toMatchObject({
      code: 'ARTIFACT_VALIDATION_FAILED',
    });
  });

  it('PLC-TS-12 rechecks the latest constraint result before rebuilding or planning', async () => {
    seedArtifact('artifact-12');
    requireChapterConstraintValidation('artifact-12');
    seedChapterConstraintValidation('artifact-12', 'passed');
    const proposal = await placementApplyService.createProposal(input('artifact-12'));
    seedChapterConstraintValidation('artifact-12', 'blocked');
    await expect(placementApplyService.rebuildProposal(proposal.proposalId, input('artifact-12').target)).rejects.toMatchObject({
      code: 'ARTIFACT_VALIDATION_FAILED',
    });
    await expect(placementApplyService.createPlan({ proposalId: proposal.proposalId })).rejects.toMatchObject({
      code: 'ARTIFACT_VALIDATION_FAILED',
    });
  });

  it('PLC-TS-13 rechecks the latest constraint result before the first browser apply', async () => {
    seedArtifact('artifact-13');
    requireChapterConstraintValidation('artifact-13');
    seedChapterConstraintValidation('artifact-13', 'passed');
    const proposal = await placementApplyService.createProposal(input('artifact-13'));
    const plan = await placementApplyService.createPlan({ proposalId: proposal.proposalId });
    seedChapterConstraintValidation('artifact-13', 'blocked');
    await expect(placementApplyService.executePlan(plan)).rejects.toMatchObject({
      code: 'ARTIFACT_VALIDATION_FAILED',
    });
  });
});
