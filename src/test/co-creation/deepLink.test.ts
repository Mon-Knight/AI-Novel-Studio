import { describe, expect, it } from 'vitest';
import type { ChapterDraft } from '../../types/ai';
import {
  buildWorkspaceDeepLink,
  candidateRecoveryMatchesDeepLink,
  createCoCreationNavigationState,
  parseCandidateReviewDeepLink,
  parseCoCreationNavigationState,
  resolveWorkspaceChapterTarget,
  validateDiscussionHandoff,
} from '../../features/co-creation/deepLink';
import { computeContentSha256 } from '../../utils/contentIntegrity';

function draft(content: string): ChapterDraft {
  return {
    id: 'draft-a',
    novelId: 'novel-a',
    chapterId: 'chapter-a',
    content,
    source: 'user_edited',
    versionNo: 3,
    wordCount: Array.from(content).length,
    isAdopted: false,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:00.000Z',
    contentState: {
      status: 'ready',
      content,
      contentHash: 'authoritative-hash',
      contentLength: content.length,
    },
  };
}

describe('co-creation deep links', () => {
  it('carries an exact UTF-16 selection in location state without putting text in the URL', async () => {
    const content = '甲😀乙段落';
    const state = await createCoCreationNavigationState({
      novelId: 'novel-a',
      chapterId: 'chapter-a',
      volumeId: 'volume-a',
      draftId: 'draft-a',
      draftVersion: 3,
      content,
      contentAvailable: true,
      selectionStart: 1,
      selectionEnd: 3,
    });

    expect(state.discussionHandoff.selectedText).toBe('😀');
    expect(state.discussionHandoff.documentContentHash).toBe(await computeContentSha256(content));
    expect(state.discussionHandoff.selectedTextHash).toBe(await computeContentSha256('😀'));
    expect(buildWorkspaceDeepLink({
      novelId: 'novel-a', chapterId: 'chapter-a', review: 'candidate', artifactId: 'artifact-a', taskId: 'task-a',
    })).toBe('/novels/novel-a/workspace?chapterId=chapter-a&review=candidate&artifactId=artifact-a&taskId=task-a');
    expect(buildWorkspaceDeepLink({ novelId: 'novel-a', chapterId: 'chapter-a' })).not.toContain('😀');
    expect(buildWorkspaceDeepLink({
      novelId: 'novel-a', chapterId: 'chapter-a', review: 'candidate', artifactId: '../invalid',
    })).toBe('/novels/novel-a/workspace?chapterId=chapter-a');
  });

  it('omits an empty, out-of-range, or split-surrogate selection', async () => {
    const state = await createCoCreationNavigationState({
      novelId: 'novel-a',
      chapterId: 'chapter-a',
      content: '甲😀乙',
      contentAvailable: true,
      selectionStart: 2,
      selectionEnd: 3,
    });
    expect(state.discussionHandoff.selectedText).toBeUndefined();
    expect(state.discussionHandoff.selectionStart).toBeUndefined();
  });

  it('rejects location state for another novel or chapter', async () => {
    const state = await createCoCreationNavigationState({
      novelId: 'novel-a', chapterId: 'chapter-a', content: '正文', contentAvailable: true,
    });
    expect(parseCoCreationNavigationState(state, 'novel-b', 'chapter-a')).toBeUndefined();
    expect(parseCoCreationNavigationState(state, 'novel-a', 'chapter-b')).toBeUndefined();
    expect(parseCoCreationNavigationState(state, 'novel-a', 'chapter-a')?.chapterId).toBe('chapter-a');
  });

  it('persists a selection only after the latest complete draft matches both hashes and offsets', async () => {
    const content = '第一段\n第二段';
    const state = await createCoCreationNavigationState({
      novelId: 'novel-a',
      chapterId: 'chapter-a',
      volumeId: 'volume-a',
      draftId: 'draft-a',
      draftVersion: 3,
      content,
      contentAvailable: true,
      selectionStart: 4,
      selectionEnd: 7,
    });
    const accepted = await validateDiscussionHandoff({
      handoff: state.discussionHandoff,
      novelId: 'novel-a',
      chapter: { id: 'chapter-a', novelId: 'novel-a', volumeId: 'volume-a' },
      latestDraft: draft(content),
    });
    expect(accepted.selectionAccepted).toBe(true);
    expect(accepted.objectContext).toEqual(expect.objectContaining({
      novelId: 'novel-a',
      volumeId: 'volume-a',
      chapterId: 'chapter-a',
      objectType: 'chapter',
      objectId: 'chapter-a',
      selectedText: '第二段',
      draftId: 'draft-a',
      draftVersion: 3,
    }));

    const stale = await validateDiscussionHandoff({
      handoff: state.discussionHandoff,
      novelId: 'novel-a',
      chapter: { id: 'chapter-a', novelId: 'novel-a', volumeId: 'volume-a' },
      latestDraft: draft(`前缀${content}`),
    });
    expect(stale.selectionAccepted).toBe(false);
    expect(stale.objectContext.selectedText).toBeUndefined();
    expect(stale.warning).toContain('正文已变化');
  });

  it('fails candidate identity closed and never substitutes another recovered candidate', () => {
    const request = parseCandidateReviewDeepLink(new URLSearchParams(
      'review=candidate&artifactId=artifact-wanted&taskId=task-wanted',
    ));
    expect(request).toBeDefined();
    const mismatch = candidateRecoveryMatchesDeepLink({
      request: request!,
      record: {
        candidate: {
          candidateId: 'artifact-other', artifactId: 'artifact-other', taskId: 'task-other',
          content: '候选', contentHash: 'hash', wordCount: 2,
        },
        target: {
          resultId: 'artifact-other', novelId: 'novel-a', chapterId: 'chapter-a',
          baseContentHash: 'base', source: 'ai_generate',
        },
      },
      activity: null,
    });
    expect(mismatch.ok).toBe(false);
    expect(mismatch.reason).toContain('指定的正文候选');

    for (const query of [
      'review=candidate',
      'review=candidate&artifactId=artifact-wanted',
      'review=candidate&taskId=task-wanted',
    ]) {
      const incomplete = parseCandidateReviewDeepLink(new URLSearchParams(query));
      expect(incomplete?.invalidReason).toContain('Artifact 和 Task');
      expect(candidateRecoveryMatchesDeepLink({
        request: incomplete!,
        record: null,
        activity: { requestId: 'activity-a', novelId: 'novel-a', chapterId: 'chapter-a',
          taskId: 'task-wanted', status: 'generating' },
      }).ok).toBe(false);
    }
  });

  it('does not silently fall back when an explicit chapter id is invalid', () => {
    expect(resolveWorkspaceChapterTarget([{ id: 'chapter-a' }], 'chapter-missing')).toEqual({
      invalidRequestedChapter: true,
    });
    expect(resolveWorkspaceChapterTarget([{ id: 'chapter-a' }])).toEqual({
      chapterId: 'chapter-a', invalidRequestedChapter: false,
    });
  });
});
