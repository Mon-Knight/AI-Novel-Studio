import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CandidateReviewPane from '../../components/workspace/CandidateReviewPane';
import { deriveCandidateLifecycle, mergeCandidateActivity } from '../../features/workspace/candidateLifecycle';
import { calculateChapterDiff } from '../../services/ai-tasks/chapterDiffService';
import type { Chapter } from '../../types/chapter';
import type { CandidateGenerationActivity, CandidateReviewRecord } from '../../types/placement';
import { computeContentSha256 } from '../../utils/contentIntegrity';

describe('large candidate reliability', () => {
  it('handles 10k baseline, 20k candidate, 500+ changes, 20 view switches, 20 chapter switches, and 10 generations', async () => {
    const baseParagraphs = Array.from({ length: 800 }, (_, index) => `原始正文段落 ${index.toString().padStart(4, '0')} 保持稳定。`);
    const candidateParagraphs = baseParagraphs.map((paragraph, index) => index < 600
      ? `${paragraph} 候选扩展内容用于可靠性验证。`
      : paragraph);
    const baseContent = baseParagraphs.join('\n\n');
    const candidateContent = candidateParagraphs.join('\n\n');
    expect(baseContent.length).toBeGreaterThan(10_000);
    expect(candidateContent.length).toBeGreaterThan(20_000);
    const baseHash = await computeContentSha256(baseContent);
    const candidateHash = await computeContentSha256(candidateContent);

    const diffStart = performance.now();
    const diff = await calculateChapterDiff({
      novelId: 'novel-a', chapterId: 'chapter-a', baseDraftId: 'draft-a', baseDraftVersion: 3, baseContentHash: baseHash,
      candidateArtifactId: 'artifact-a', candidateNovelId: 'novel-a', candidateChapterId: 'chapter-a', candidateSourceDraftId: 'draft-a',
      candidateSourceDraftVersion: 3, candidateBaseContentHash: baseHash, baseContent, candidateContent,
    });
    const diffMs = performance.now() - diffStart;
    expect(diff.status).toBe('ready');
    expect((diff.summary?.modifiedBlocks || 0) + (diff.summary?.addedBlocks || 0) + (diff.summary?.removedBlocks || 0)).toBeGreaterThanOrEqual(500);
    expect(diffMs).toBeLessThan(5_000);

    const record: CandidateReviewRecord = {
      candidate: {
        candidateId: 'artifact-a', artifactId: 'artifact-a', taskId: 'task-a', content: candidateContent, contentHash: candidateHash,
        wordCount: candidateContent.length, baseContent, diff,
        constraintValidation: { artifactId: 'artifact-a', taskId: 'task-a', novelId: 'novel-a', chapterId: 'chapter-a', sourceDraftId: 'draft-a',
          sourceDraftVersion: 3, baseContentHash: baseHash, validationRunId: 'validation-a', status: 'passed', must: [], should: [], forbid: [],
          blockingCount: 0, warningCount: 0, validatorVersion: 'test', validatedAt: 'now' },
        proposal: { proposalId: 'proposal-a', artifactId: 'artifact-a', schemaVersion: 1, targets: [{ targetType: 'chapter', targetId: 'chapter-a',
          novelId: 'novel-a', chapterId: 'chapter-a', draftId: 'draft-a', action: 'save_and_adopt_chapter_text', expectedVersion: 3,
          expectedHash: baseHash, sourcePriority: 1, confidence: 1, reason: 'test', isReady: true }], confidence: 1, reasons: [], warnings: [],
          unresolvedItems: [], projectRevisionHash: 'revision', createdAt: 'now' },
      },
      target: { resultId: 'artifact-a', artifactId: 'artifact-a', taskId: 'task-a', novelId: 'novel-a', chapterId: 'chapter-a',
        sourceDraftId: 'draft-a', sourceRevision: 3, baseContentHash: baseHash, contentHash: candidateHash, source: 'ai_generate' },
    };
    const context = deriveCandidateLifecycle({ record, currentNovelId: 'novel-a', currentChapterId: 'chapter-a',
      currentDraft: { id: 'draft-a', novelId: 'novel-a', chapterId: 'chapter-a', versionNo: 3 }, currentEditorContent: baseContent });
    const chapter: Chapter = { id: 'chapter-a', novelId: 'novel-a', volumeId: 'volume-a', title: '性能章节', chapterNumber: 1,
      orderIndex: 0, sortOrder: 0, status: 'editing', wordCount: baseContent.length, currentWords: baseContent.length, drafts: [],
      targetWords: candidateContent.length,
      createdAt: 'now', updatedAt: 'now' };
    const view = render(<CandidateReviewPane chapter={chapter} context={context} onAdopt={async () => undefined} onClose={() => undefined} onOpenGenerator={() => undefined} />);
    const toggleStart = performance.now();
    const diffDomNodeCounts: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      fireEvent.click(screen.getByRole('tab', { name: index % 2 === 0 ? '正文差异' : '候选全文' }));
      if (index % 2 === 0) diffDomNodeCounts.push(view.container.querySelectorAll('*').length);
    }
    const toggleMs = performance.now() - toggleStart;
    expect(view.container.querySelector('.candidate-review')).toBeTruthy();
    expect(toggleMs).toBeLessThan(10_000);
    expect(new Set(diffDomNodeCounts).size).toBe(1);

    let activity: CandidateGenerationActivity | undefined;
    for (let index = 0; index < 10; index += 1) {
      activity = mergeCandidateActivity(activity, { requestId: `request-${index}`, novelId: 'novel-a', chapterId: 'chapter-a', status: 'generating' });
      activity = mergeCandidateActivity(activity, { ...activity, status: index % 3 === 0 ? 'failed' : 'validating' });
    }
    for (let index = 0; index < 20; index += 1) {
      const switched = deriveCandidateLifecycle({ record, currentNovelId: 'novel-a', currentChapterId: index % 2 ? 'chapter-b' : 'chapter-a',
        currentDraft: { id: 'draft-a', novelId: 'novel-a', chapterId: 'chapter-a', versionNo: 3 }, currentEditorContent: baseContent });
      expect(switched.candidateId).toBe('artifact-a');
    }
    console.info('[candidate-performance]', { baseChars: baseContent.length, candidateChars: candidateContent.length,
      changedBlocks: diff.blocks.filter((block) => block.kind !== 'unchanged').length, diffMs: Math.round(diffMs),
      toggleMs: Math.round(toggleMs), stableDiffDomNodes: diffDomNodeCounts[0] });
  }, 15_000);
});
