import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeContentSha256 } from '../../utils/contentIntegrity';

const mocks = vi.hoisted(() => ({ dbCall: vi.fn(), getDrafts: vi.fn(), getValidation: vi.fn(), validateProposal: vi.fn() }));
vi.mock('../../services/database/db', () => ({ dbCall: mocks.dbCall }));
vi.mock('../../services/database/draftVersionService', () => ({ draftVersionService: { getByChapterId: mocks.getDrafts } }));
vi.mock('../../services/ai-tasks/chapterConstraintValidationService', () => ({ chapterConstraintValidationService: { getLatest: mocks.getValidation } }));
vi.mock('../../services/ai-tasks/placementApplyService', () => ({ placementApplyService: { validateProposal: mocks.validateProposal } }));

import { chapterCandidateService } from '../../services/ai-tasks/chapterCandidateService';
import { deriveCandidateLifecycle } from '../../features/workspace/candidateLifecycle';

const BASE_HASH = 'cae662172fd450bb0cd710a769079c05bfc5d8e35efa6576edc7d0377afdd4a2';
const sourceDraft = { id: 'draft-a', novelId: 'novel-a', chapterId: 'chapter-a', content: 'base', source: 'user_edited', versionNo: 3,
  wordCount: 4, isAdopted: true, contentState: { status: 'ready', contentHash: BASE_HASH, contentLength: 4 }, createdAt: 'now', updatedAt: 'now' };
const validation = { artifactId: 'artifact-a', taskId: 'task-a', novelId: 'novel-a', chapterId: 'chapter-a', sourceDraftId: 'draft-a',
  sourceDraftVersion: 3, baseContentHash: BASE_HASH, validationRunId: 'validation-a', status: 'passed', must: [], should: [], forbid: [],
  blockingCount: 0, warningCount: 0, validatorVersion: 'test', validatedAt: 'now' };
const proposal = { proposalId: 'proposal-a', artifactId: 'artifact-a', schemaVersion: 1, confidence: 1, reasons: [], warnings: [], unresolvedItems: [],
  projectRevisionHash: 'revision', createdAt: 'now', targets: [{ targetType: 'chapter', targetId: 'chapter-a', novelId: 'novel-a',
    chapterId: 'chapter-a', draftId: 'draft-a', action: 'save_and_adopt_chapter_text', expectedVersion: 3, expectedHash: BASE_HASH,
    sourcePriority: 1, confidence: 1, reason: 'test', isReady: true }] };

async function recovery(overrides: Record<string, unknown> = {}) {
  return {
    candidate: { candidateId: 'artifact-a', artifactId: 'artifact-a', taskId: 'task-a', novelId: 'novel-a', chapterId: 'chapter-a',
      sourceDraftId: 'draft-a', sourceDraftVersion: 3, baseContentHash: BASE_HASH, content: 'candidate',
      contentHash: await computeContentSha256('candidate'), contentLength: 9, processingStatus: 'valid', taskStatus: 'completed',
      proposal, adopted: false, createdAt: '2026-07-13T00:00:00Z', ...overrides },
    latestTask: { taskId: 'task-a', status: 'completed', resultArtifactId: 'artifact-a', createdAt: '2026-07-13T00:00:00Z' },
  };
}

describe('candidate restart recovery', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.getDrafts.mockResolvedValue([sourceDraft]);
    mocks.getValidation.mockResolvedValue(validation);
    mocks.validateProposal.mockResolvedValue({ stale: false });
  });

  it('reconstructs candidate, constraint, frozen diff, and target from authoritative persisted data', async () => {
    mocks.dbCall.mockResolvedValue(await recovery());
    const result = await chapterCandidateService.recover('novel-a', 'chapter-a');
    expect(result.record?.candidate.artifactId).toBe('artifact-a');
    expect(result.record?.candidate.constraintValidation?.taskId).toBe('task-a');
    expect(result.record?.candidate.diff?.summary?.baseDraftId).toBe('draft-a');
    expect(result.record?.target.chapterId).toBe('chapter-a');
  });

  it('never restores adopted or stale candidates as adoptable', async () => {
    mocks.dbCall.mockResolvedValue(await recovery({ adopted: true }));
    const adopted = await chapterCandidateService.recover('novel-a', 'chapter-a');
    expect(deriveCandidateLifecycle({ record: adopted.record, currentNovelId: 'novel-a', currentChapterId: 'chapter-a', currentDraft: sourceDraft,
      currentEditorContent: 'base' }).status).toBe('adopted');

    mocks.dbCall.mockResolvedValue(await recovery());
    mocks.validateProposal.mockResolvedValueOnce({ stale: true, reason: 'baseline stale' });
    const stale = await chapterCandidateService.recover('novel-a', 'chapter-a');
    expect(stale.record?.invalidated).toBe(true);
    expect(deriveCandidateLifecycle({ record: stale.record, currentNovelId: 'novel-a', currentChapterId: 'chapter-a', currentDraft: sourceDraft,
      currentEditorContent: 'base' }).canAdopt).toBe(false);
  });

  it('restores cancelled and interrupted tasks as terminal states instead of generating', async () => {
    mocks.dbCall.mockResolvedValueOnce({ latestTask: { taskId: 'task-cancelled', status: 'cancelled', createdAt: 'now' } });
    const cancelled = await chapterCandidateService.recover('novel-a', 'chapter-a');
    expect(cancelled.activity?.status).toBe('cancelled');

    mocks.dbCall.mockResolvedValueOnce({ latestTask: { taskId: 'task-running', status: 'running', createdAt: 'now' } });
    const interrupted = await chapterCandidateService.recover('novel-a', 'chapter-a');
    expect(interrupted.activity).toMatchObject({ status: 'failed', message: expect.stringContaining('中断') });
  });
});
