import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CandidateReviewRecord } from '../../types/placement';
import { computeContentSha256 } from '../../utils/contentIntegrity';

const mocks = vi.hoisted(() => ({
  getChapter: vi.fn(), getDrafts: vi.fn(), getAdopted: vi.fn(), getValidation: vi.fn(),
  validateProposal: vi.fn(), createPlan: vi.fn(), executePlan: vi.fn(),
}));

vi.mock('../../services/database/chapterRepository', () => ({ chapterRepository: { getById: mocks.getChapter } }));
vi.mock('../../services/database/draftVersionService', () => ({ draftVersionService: {
  getByChapterId: mocks.getDrafts, getAdoptedByChapterId: mocks.getAdopted,
} }));
vi.mock('../../services/ai-tasks/chapterConstraintValidationService', () => ({ chapterConstraintValidationService: { getLatest: mocks.getValidation } }));
vi.mock('../../services/ai-tasks/placementApplyService', () => ({ placementApplyService: {
  validateProposal: mocks.validateProposal, createPlan: mocks.createPlan, executePlan: mocks.executePlan,
} }));

import { chapterCandidateService } from '../../services/ai-tasks/chapterCandidateService';

const validation = {
  artifactId: 'artifact-a', taskId: 'task-a', novelId: 'novel-a', chapterId: 'chapter-a', sourceDraftId: 'draft-a',
  sourceDraftVersion: 3, baseContentHash: 'base-hash', validationRunId: 'validation-a', status: 'passed' as const,
  must: [], should: [], forbid: [], blockingCount: 0, warningCount: 0, validatorVersion: 'test', validatedAt: 'now',
};

async function record(): Promise<CandidateReviewRecord> {
  const contentHash = await computeContentSha256('candidate');
  return {
    candidate: {
      candidateId: 'artifact-a', artifactId: 'artifact-a', taskId: 'task-a', content: 'candidate', contentHash,
      wordCount: 9, baseContent: 'base', constraintValidation: validation,
      diff: { status: 'ready', blocks: [], summary: { baseDraftId: 'draft-a', baseDraftVersion: 3, baseContentHash: 'base-hash',
        candidateArtifactId: 'artifact-a', addedBlocks: 0, removedBlocks: 0, modifiedBlocks: 1, unchangedBlocks: 0,
        baseCharacterCount: 4, candidateCharacterCount: 9, characterDelta: 5 } },
      proposal: { proposalId: 'proposal-a', artifactId: 'artifact-a', schemaVersion: 1, confidence: 1, reasons: [], warnings: [],
        unresolvedItems: [], projectRevisionHash: 'revision', createdAt: 'now', targets: [{ targetType: 'chapter', targetId: 'chapter-a',
          novelId: 'novel-a', chapterId: 'chapter-a', draftId: 'draft-a', action: 'save_and_adopt_chapter_text', expectedVersion: 3,
          expectedHash: 'base-hash', sourcePriority: 1, confidence: 1, reason: 'test', isReady: true }] },
    },
    target: { resultId: 'artifact-a', artifactId: 'artifact-a', taskId: 'task-a', novelId: 'novel-a', chapterId: 'chapter-a',
      sourceDraftId: 'draft-a', sourceRevision: 3, baseContentHash: 'base-hash', contentHash, source: 'ai_generate' },
  };
}

const sourceDraft = { id: 'draft-a', novelId: 'novel-a', chapterId: 'chapter-a', content: 'base', source: 'user_edited',
  versionNo: 3, wordCount: 4, isAdopted: true, createdAt: 'now', updatedAt: 'now' };
const adoptedDraft = { ...sourceDraft, id: 'draft-adopted', versionNo: 4, content: 'candidate', artifactId: 'artifact-a', isAdopted: true };

describe('candidate adoption safety', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getChapter.mockResolvedValue({ id: 'chapter-a', novelId: 'novel-a' });
    mocks.getDrafts.mockResolvedValue([sourceDraft]);
    mocks.getValidation.mockResolvedValue(validation);
    mocks.validateProposal.mockResolvedValue({ stale: false });
    mocks.createPlan.mockResolvedValue({ planId: 'plan-a', proposalId: 'proposal-a', artifactId: 'artifact-a', operationId: 'operation-a' });
    mocks.executePlan.mockResolvedValue({ status: 'completed', targetLinks: [{}] });
    mocks.getAdopted.mockResolvedValue(adoptedDraft);
  });

  it('coalesces double-click and concurrent adoption into one plan execution', async () => {
    const candidate = await record();
    const input = { record: candidate, currentNovelId: 'novel-a', currentChapterId: 'chapter-a', currentEditorContent: 'base', source: 'ai_generated' as const };
    const [first, second] = await Promise.all([chapterCandidateService.adopt(input), chapterCandidateService.adopt(input)]);
    expect(first.id).toBe(second.id);
    expect(mocks.createPlan).toHaveBeenCalledTimes(1);
    expect(mocks.executePlan).toHaveBeenCalledTimes(1);
    expect(mocks.getAdopted).toHaveBeenCalledTimes(1);
  });

  it('rejects already adopted, cross-chapter, blocked, stale, and changed-baseline candidates', async () => {
    const candidate = await record();
    mocks.getDrafts.mockResolvedValueOnce([sourceDraft, { ...adoptedDraft, isAdopted: false }]);
    await expect(chapterCandidateService.adopt({ record: candidate, currentNovelId: 'novel-a', currentChapterId: 'chapter-a', currentEditorContent: 'base', source: 'ai_generated' })).rejects.toThrow(/已经采用/);

    await expect(chapterCandidateService.adopt({ record: candidate, currentNovelId: 'novel-a', currentChapterId: 'chapter-b', currentEditorContent: 'base', source: 'ai_generated' })).rejects.toThrow();

    const blocked = await record();
    blocked.candidate.constraintValidation = { ...validation, status: 'blocked', blockingCount: 1 };
    mocks.getValidation.mockResolvedValueOnce(blocked.candidate.constraintValidation);
    await expect(chapterCandidateService.adopt({ record: blocked, currentNovelId: 'novel-a', currentChapterId: 'chapter-a', currentEditorContent: 'base', source: 'ai_generated' })).rejects.toThrow(/阻断/);

    mocks.validateProposal.mockResolvedValueOnce({ stale: true, reason: 'stale' });
    await expect(chapterCandidateService.adopt({ record: candidate, currentNovelId: 'novel-a', currentChapterId: 'chapter-a', currentEditorContent: 'base', source: 'ai_generated' })).rejects.toThrow('stale');

    await expect(chapterCandidateService.adopt({ record: candidate, currentNovelId: 'novel-a', currentChapterId: 'chapter-a', currentEditorContent: 'edited', source: 'ai_generated' })).rejects.toThrow(/正文已变化/);
    expect(mocks.createPlan).not.toHaveBeenCalled();
  });

  it('keeps candidate state unchanged when apply fails and does not report an authoritative draft', async () => {
    const candidate = await record();
    mocks.executePlan.mockRejectedValueOnce(new Error('forced apply failure'));
    await expect(chapterCandidateService.adopt({ record: candidate, currentNovelId: 'novel-a', currentChapterId: 'chapter-a', currentEditorContent: 'base', source: 'ai_generated' })).rejects.toThrow('forced apply failure');
    expect(candidate.adopted).toBeUndefined();
    expect(mocks.getAdopted).not.toHaveBeenCalled();
  });
});
