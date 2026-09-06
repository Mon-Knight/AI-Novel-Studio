import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useArtifactReviewStore } from '../../../store/artifactReviewStore';
import type { ConversationArtifactCard } from '../../../types/conversation';
import { useArtifactCandidateReview } from './useArtifactCandidateReview';

const artifact: ConversationArtifactCard = {
  cardId: 'review-card',
  artifactId: 'review-artifact',
  conversationId: 'task-a',
  artifactType: 'character_candidates',
  content: 'original-a',
  title: '测试',
  summary: '测试',
  status: 'candidate',
  createdAt: '2026-09-05',
};
const draft = {
  originalTitle: '原候选',
  suggestedTitle: '',
  suggestedSummary: '',
  notes: '本次会话保留的意见。',
};
beforeEach(() => useArtifactReviewStore.getState().reset());

it('preserves notes across A-B-A task remounts without storage or artifact changes', () => {
  const first = renderHook(() => useArtifactCandidateReview(artifact));
  act(() => first.result.current.updateDraft('one', draft));
  first.unmount();
  const second = renderHook(() =>
    useArtifactCandidateReview({ ...artifact, conversationId: 'task-b' }),
  );
  expect(second.result.current.revisionNotes).toBe('');
  act(() => second.result.current.updateDraft('one', { ...draft, notes: '任务B意见' }));
  second.unmount();
  const back = renderHook(() => useArtifactCandidateReview(artifact));
  expect(back.result.current.revisionNotes).toContain(draft.notes);
  expect(back.result.current.revisionNotes).not.toContain('任务B意见');
  expect(back.result.current.revisionCount).toBe(1);
  expect(localStorage.length).toBe(0);
  expect(artifact.content).toBe('original-a');
});

it('keeps notes when the same task reprojects an artifact with a new card id', () => {
  const first = renderHook(() => useArtifactCandidateReview(artifact));
  act(() => first.result.current.updateDraft('one', draft));
  first.unmount();
  const refreshed = renderHook(() =>
    useArtifactCandidateReview({ ...artifact, cardId: 'reprojected-card' }),
  );
  expect(refreshed.result.current.revisionNotes).toContain(draft.notes);
});

it.each(['content', 'artifactId'] as const)(
  'invalidates notes on %s identity change and never revives stale feedback',
  (field) => {
    const view = renderHook(({ item }) => useArtifactCandidateReview(item), {
      initialProps: { item: artifact },
    });
    act(() => view.result.current.updateDraft('one', draft));
    view.rerender({ item: { ...artifact, [field]: 'changed' } });
    expect(view.result.current.revisionNotes).toBe('');
    view.rerender({ item: artifact });
    expect(view.result.current.revisionNotes).toBe('');
  },
);
