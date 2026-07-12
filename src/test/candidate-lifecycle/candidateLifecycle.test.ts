import { describe, expect, it } from 'vitest';
import {
  acceptsCandidateAsyncResult,
  canPromoteCandidateRecord,
  deriveCandidateLifecycle,
  mergeCandidateActivity,
} from '../../features/workspace/candidateLifecycle';
import type { CandidateGenerationActivity, CandidateReviewRecord } from '../../types/placement';

function record(overrides: Partial<CandidateReviewRecord> = {}): CandidateReviewRecord {
  const base: CandidateReviewRecord = {
    candidate: {
      candidateId: 'artifact-a', artifactId: 'artifact-a', taskId: 'task-a', content: 'candidate', contentHash: 'candidate-hash',
      wordCount: 9, baseContent: 'base',
      proposal: {
        proposalId: 'proposal-a', artifactId: 'artifact-a', schemaVersion: 1, confidence: 1,
        reasons: [], warnings: [], unresolvedItems: [], projectRevisionHash: 'revision', createdAt: '2026-07-13T00:00:00Z',
        targets: [{ targetType: 'chapter', targetId: 'chapter-a', novelId: 'novel-a', chapterId: 'chapter-a', draftId: 'draft-a',
          action: 'save_and_adopt_chapter_text', expectedVersion: 3, expectedHash: 'base-hash', sourcePriority: 1,
          confidence: 1, reason: 'test', isReady: true }],
      },
      constraintValidation: {
        artifactId: 'artifact-a', taskId: 'task-a', novelId: 'novel-a', chapterId: 'chapter-a', sourceDraftId: 'draft-a',
        sourceDraftVersion: 3, baseContentHash: 'base-hash', validationRunId: 'validation-a', status: 'passed',
        must: [], should: [], forbid: [], blockingCount: 0, warningCount: 0, validatorVersion: 'test', validatedAt: 'now',
      },
      diff: {
        status: 'ready', blocks: [], summary: { baseDraftId: 'draft-a', baseDraftVersion: 3, baseContentHash: 'base-hash',
          candidateArtifactId: 'artifact-a', addedBlocks: 0, removedBlocks: 0, modifiedBlocks: 1, unchangedBlocks: 0,
          baseCharacterCount: 4, candidateCharacterCount: 9, characterDelta: 5 },
      },
    },
    target: { resultId: 'artifact-a', artifactId: 'artifact-a', taskId: 'task-a', novelId: 'novel-a', chapterId: 'chapter-a',
      sourceDraftId: 'draft-a', sourceRevision: 3, baseContentHash: 'base-hash', contentHash: 'candidate-hash', source: 'ai_generate' },
  };
  return { ...base, ...overrides, candidate: { ...base.candidate, ...overrides.candidate }, target: { ...base.target, ...overrides.target } };
}

function derive(candidateRecord: CandidateReviewRecord | null, generation?: CandidateGenerationActivity) {
  return deriveCandidateLifecycle({
    record: candidateRecord,
    generation,
    currentNovelId: 'novel-a',
    currentChapterId: 'chapter-a',
    currentDraft: { id: 'draft-a', novelId: 'novel-a', chapterId: 'chapter-a', versionNo: 3 },
    currentEditorContent: 'base',
  });
}

describe('chapter candidate lifecycle derivation', () => {
  it('allows one fully matching candidate and frozen baseline', () => {
    expect(derive(record())).toMatchObject({ status: 'ready', canAdopt: true, candidateId: 'artifact-a' });
  });

  it('never exposes chapter A candidate as adoptable in chapter B', () => {
    const result = deriveCandidateLifecycle({ record: record(), currentNovelId: 'novel-a', currentChapterId: 'chapter-b' });
    expect(result).toMatchObject({ status: 'invalidated', canAdopt: false });
  });

  it('fails closed when task, candidate, constraint, diff, or target identities differ', () => {
    const taskMismatch = record({ target: { ...record().target, taskId: 'task-b' } });
    const constraintMismatch = record({ candidate: { ...record().candidate,
      constraintValidation: { ...record().candidate.constraintValidation!, chapterId: 'chapter-b' } } });
    const diffMismatch = record({ candidate: { ...record().candidate, diff: { ...record().candidate.diff!,
      summary: { ...record().candidate.diff!.summary!, candidateArtifactId: 'artifact-b' } } } });
    const targetMismatch = record({ candidate: { ...record().candidate, proposal: { ...record().candidate.proposal!,
      targets: [{ ...record().candidate.proposal!.targets[0], targetId: 'chapter-b', chapterId: 'chapter-b' }] } } });
    for (const candidate of [taskMismatch, constraintMismatch, diffMismatch, targetMismatch]) {
      expect(derive(candidate).status).toBe('identity_mismatch');
    }
  });

  it('blocks silent overwrite when editor content, draft id, or draft version changes', () => {
    const changedText = deriveCandidateLifecycle({ record: record(), currentNovelId: 'novel-a', currentChapterId: 'chapter-a',
      currentDraft: { id: 'draft-a', novelId: 'novel-a', chapterId: 'chapter-a', versionNo: 3 }, currentEditorContent: 'edited' });
    const changedDraft = deriveCandidateLifecycle({ record: record(), currentNovelId: 'novel-a', currentChapterId: 'chapter-a',
      currentDraft: { id: 'draft-b', novelId: 'novel-a', chapterId: 'chapter-a', versionNo: 4 }, currentEditorContent: 'base' });
    expect(changedText).toMatchObject({ status: 'baseline_changed', baselineChanged: true, canAdopt: false, diffUsesFrozenBaseline: true });
    expect(changedDraft.status).toBe('baseline_changed');
  });

  it('handles blocked, adopted, invalidated, empty, read failure, and diff failure explicitly', () => {
    expect(derive(record({ candidate: { ...record().candidate,
      constraintValidation: { ...record().candidate.constraintValidation!, status: 'blocked', blockingCount: 1 } } })).status).toBe('blocked');
    expect(derive(record({ adopted: true })).status).toBe('adopted');
    expect(derive(record({ invalidated: true })).status).toBe('invalidated');
    expect(derive(record({ candidate: { ...record().candidate, content: ' ' } })).status).toBe('empty_content');
    expect(derive(record({ candidate: { ...record().candidate, diff: { status: 'blocked', blocks: [], reason: 'failed' } } })).status).toBe('diff_failed');
    expect(deriveCandidateLifecycle({ record: null, readError: 'read failed' }).status).toBe('read_failed');
  });

  it('retains candidate A while candidate B is generating, fails, or is cancelled', () => {
    for (const status of ['generating', 'failed', 'cancelled'] as const) {
      const generation: CandidateGenerationActivity = {
        requestId: 'request-b', taskId: 'task-b', novelId: 'novel-a', chapterId: 'chapter-a', status,
      };
      const result = derive(record(), generation);
      expect(result.candidateId).toBe('artifact-a');
      expect(result.status).toBe('ready');
      expect(result.generation?.status).toBe(status);
    }
  });

  it('shows terminal generation states when there is no older candidate', () => {
    for (const status of ['generating', 'validating', 'failed', 'cancelled'] as const) {
      const result = derive(null, { requestId: 'request', novelId: 'novel-a', chapterId: 'chapter-a', status });
      expect(result.status).toBe(status);
      expect(result.canAdopt).toBe(false);
    }
  });

  it('accepts async writes only when request, task, candidate, novel, and chapter all match', () => {
    const activity: CandidateGenerationActivity = { requestId: 'request-a', taskId: 'task-a', candidateId: 'artifact-a',
      novelId: 'novel-a', chapterId: 'chapter-a', status: 'validating' };
    const identity = { requestId: 'request-a', taskId: 'task-a', candidateId: 'artifact-a', novelId: 'novel-a', chapterId: 'chapter-a' };
    expect(acceptsCandidateAsyncResult(activity, identity)).toBe(true);
    for (const key of Object.keys(identity) as Array<keyof typeof identity>) {
      expect(acceptsCandidateAsyncResult(activity, { ...identity, [key]: 'other' })).toBe(false);
    }
  });

  it('prevents an old A completion from overwriting newer B during rapid A-B-C-A switching', () => {
    const a = { requestId: 'request-a', taskId: 'task-a', candidateId: 'artifact-a', novelId: 'novel-a', chapterId: 'chapter-a', status: 'validating' as const };
    const b = { requestId: 'request-b', taskId: 'task-b', candidateId: 'artifact-b', novelId: 'novel-a', chapterId: 'chapter-a', status: 'generating' as const };
    const active = mergeCandidateActivity(a, b);
    expect(active.requestId).toBe('request-b');
    expect(mergeCandidateActivity(active, { ...a, status: 'failed' })).toBe(active);
    expect(canPromoteCandidateRecord(active, record())).toBe(false);
    const recordB = record({ candidate: { ...record().candidate, candidateId: 'artifact-b', artifactId: 'artifact-b', taskId: 'task-b' },
      target: { ...record().target, resultId: 'artifact-b', artifactId: 'artifact-b', taskId: 'task-b' } });
    expect(canPromoteCandidateRecord(active, recordB)).toBe(true);
  });
});
