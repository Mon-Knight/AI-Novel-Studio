import { create } from 'zustand';
import type { ArtifactCandidateReviewDraft } from '../types/artifactReview';

interface ReviewEntry {
  artifactId?: string;
  content?: string;
  drafts: Record<string, ArtifactCandidateReviewDraft>;
}

interface ArtifactReviewState {
  entries: Map<string, ReviewEntry>;
  reconcile: (scope: string, artifactId: string | undefined, content: string | undefined) => void;
  updateDraft: (
    scope: string,
    artifactId: string | undefined,
    content: string | undefined,
    candidateId: string,
    draft: ArtifactCandidateReviewDraft,
  ) => void;
  invalidate: (scope: string) => void;
  reset: () => void;
}

/** Session-only review notes. No persistence, network, clocks, or mutation of result artifacts. */
export const useArtifactReviewStore = create<ArtifactReviewState>((set) => ({
  entries: new Map(),
  reconcile: (scope, artifactId, content) =>
    set((state) => {
      const existing = state.entries.get(scope);
      if (!existing) return state;
      if (existing && existing.artifactId === artifactId && existing.content === content)
        return state;
      const entries = new Map(state.entries);
      entries.set(scope, { artifactId, content, drafts: {} });
      return { entries };
    }),
  updateDraft: (scope, artifactId, content, candidateId, draft) =>
    set((state) => {
      const existing = state.entries.get(scope);
      const drafts =
        existing && existing.artifactId === artifactId && existing.content === content
          ? existing.drafts
          : {};
      const entries = new Map(state.entries);
      entries.set(scope, { artifactId, content, drafts: { ...drafts, [candidateId]: draft } });
      return { entries };
    }),
  invalidate: (scope) =>
    set((state) => {
      if (!state.entries.has(scope)) return state;
      const entries = new Map(state.entries);
      entries.delete(scope);
      return { entries };
    }),
  reset: () => set({ entries: new Map() }),
}));
