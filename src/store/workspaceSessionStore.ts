import { create } from 'zustand';
import type { ChapterDraft } from '../types/ai';
import type { Chapter } from '../types/chapter';
import type { Novel } from '../types/novel';
import type { QualityCheckItem, QualityCheckReport } from '../types/qualityCheck';
import type { Volume } from '../types/volume';
import type { AiTaskModalState, EditorContentSnapshot } from '../types/workspaceSafety';
import { hashTextContent } from '../utils/contentHash';

type Update<T> = T | ((current: T) => T);

function resolve<T>(current: T, update: Update<T>): T {
  return typeof update === 'function' ? (update as (value: T) => T)(current) : update;
}

const emptyEditorSnapshot = (): EditorContentSnapshot => ({
  content: '',
  wordCount: 0,
  isDirty: false,
  contentHash: hashTextContent(''),
  contentAvailable: true,
});

const emptyAiModal = (): AiTaskModalState => ({
  running: false,
  title: '',
  stage: '',
  progress: 0,
});

export interface WorkspaceSessionState {
  sessionNovelId: string;
  novel: Novel | null;
  volumes: Volume[];
  chapters: Chapter[];
  activeChapterId: string;
  currentDraft: ChapterDraft | null;
  editorSnapshot: EditorContentSnapshot;
  draftWordCount: number;
  isDirty: boolean;
  qcReport: QualityCheckReport | null;
  qcItems: QualityCheckItem[];
  aiModal: AiTaskModalState;
  startSession(novelId: string): void;
  setNovel(value: Novel | null): void;
  setVolumes(value: Volume[]): void;
  setChapters(value: Update<Chapter[]>): void;
  setActiveChapterId(value: string): void;
  setCurrentDraft(value: ChapterDraft | null): void;
  setEditorSnapshot(value: EditorContentSnapshot): void;
  setEditorActivity(value: EditorContentSnapshot): void;
  setDraftWordCount(value: number): void;
  setDirty(value: boolean): void;
  setQuality(report: QualityCheckReport | null, items: QualityCheckItem[]): void;
  setAiModal(value: Update<AiTaskModalState>): void;
  reset(): void;
}

function initialState(sessionNovelId = '') {
  return {
    sessionNovelId,
    novel: null,
    volumes: [] as Volume[],
    chapters: [] as Chapter[],
    activeChapterId: '',
    currentDraft: null as ChapterDraft | null,
    editorSnapshot: emptyEditorSnapshot(),
    draftWordCount: 0,
    isDirty: false,
    qcReport: null as QualityCheckReport | null,
    qcItems: [] as QualityCheckItem[],
    aiModal: emptyAiModal(),
  };
}

export const useWorkspaceSessionStore = create<WorkspaceSessionState>((set) => ({
  ...initialState(),
  startSession: (novelId) =>
    set((state) => (state.sessionNovelId === novelId ? state : { ...initialState(novelId) })),
  setNovel: (novel) => set({ novel }),
  setVolumes: (volumes) => set({ volumes }),
  setChapters: (value) => set((state) => ({ chapters: resolve(state.chapters, value) })),
  setActiveChapterId: (activeChapterId) => set({ activeChapterId }),
  setCurrentDraft: (currentDraft) => set({ currentDraft }),
  setEditorSnapshot: (editorSnapshot) => set({ editorSnapshot }),
  setEditorActivity: (editorSnapshot) =>
    set({
      editorSnapshot,
      draftWordCount: editorSnapshot.wordCount,
      isDirty: editorSnapshot.isDirty,
    }),
  setDraftWordCount: (draftWordCount) => set({ draftWordCount }),
  setDirty: (isDirty) => set({ isDirty }),
  setQuality: (qcReport, qcItems) => set({ qcReport, qcItems }),
  setAiModal: (value) => set((state) => ({ aiModal: resolve(state.aiModal, value) })),
  reset: () => set(initialState()),
}));
