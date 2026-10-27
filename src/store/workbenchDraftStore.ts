import { create } from 'zustand';
import type { ArtifactRevisionSource } from '../types/artifactRevision';

type DraftUpdate = string | ((current: string) => string);
interface WorkbenchDraft {
  text: string;
  revisionSource: ArtifactRevisionSource | null;
}
const EMPTY_DRAFT: WorkbenchDraft = { text: '', revisionSource: null };
interface WorkbenchDraftState {
  drafts: Record<string, WorkbenchDraft>;
  updateDraft: (conversationId: string, next: DraftUpdate) => void;
  bindRevisionSource: (conversationId: string, source: ArtifactRevisionSource) => void;
  clearRevisionSource: (conversationId: string) => void;
  clearSubmittedDraft: (
    conversationId: string,
    text: string,
    source: ArtifactRevisionSource | null,
  ) => void;
}

/** Session-only drafts survive route/task switches; no user prose is persisted by the Store. */
export const useWorkbenchDraftStore = create<WorkbenchDraftState>((set) => ({
  drafts: {},
  updateDraft: (conversationId, next) => {
    if (!conversationId) return;
    set((state) => {
      const current = state.drafts[conversationId] ?? EMPTY_DRAFT;
      const text = typeof next === 'function' ? next(current.text) : next;
      if (text === current.text) return state;
      return {
        drafts: {
          ...state.drafts,
          [conversationId]: {
            text,
            revisionSource: text.trim() ? current.revisionSource : null,
          },
        },
      };
    });
  },
  bindRevisionSource: (conversationId, source) => {
    if (!conversationId || source.conversationId !== conversationId) return;
    set((state) => ({
      drafts: {
        ...state.drafts,
        [conversationId]: {
          ...(state.drafts[conversationId] ?? EMPTY_DRAFT),
          revisionSource: source,
        },
      },
    }));
  },
  clearRevisionSource: (conversationId) =>
    set((state) => {
      const current = state.drafts[conversationId];
      if (!current?.revisionSource) return state;
      return {
        drafts: { ...state.drafts, [conversationId]: { ...current, revisionSource: null } },
      };
    }),
  clearSubmittedDraft: (conversationId, text, source) =>
    set((state) => {
      const current = state.drafts[conversationId];
      // Identity comparison protects a newer selection of even the same candidate.
      if (!current || current.text !== text || current.revisionSource !== source) return state;
      return { drafts: { ...state.drafts, [conversationId]: EMPTY_DRAFT } };
    }),
}));
