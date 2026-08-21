import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const timestamp = '2026-07-28T00:00:00.000Z';
  const chapter = {
    id: 'chapter-1',
    novelId: 'novel-1',
    volumeId: 'volume-1',
    title: '第一章',
    outline: '调查档案库',
    goal: '找到线索',
    chapterNumber: 1,
    orderIndex: 1,
    sortOrder: 1,
    status: 'editing',
    wordCount: 120,
    currentWords: 120,
    targetWords: 2_400,
    drafts: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const draft = {
    id: 'draft-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    content: '编辑器正文',
    source: 'user_edited',
    versionNo: 1,
    wordCount: 120,
    isAdopted: false,
    contentState: { status: 'ready', contentHash: 'content-hash' },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const actions = {
    navigate: vi.fn(),
    startSession: vi.fn(),
    setNovel: vi.fn(),
    setVolumes: vi.fn(),
    setChapters: vi.fn(),
    setActiveChapterId: vi.fn(),
    setCurrentDraft: vi.fn(),
    setEditorSnapshot: vi.fn(),
    setEditorActivity: vi.fn(),
    setDraftWordCount: vi.fn(),
    setDirty: vi.fn(),
    setQuality: vi.fn(),
    setAiModal: vi.fn(),
    openSidebarTool: vi.fn(),
    closeSidebar: vi.fn(),
    updateSidebarTool: vi.fn(),
    resetSidebar: vi.fn(),
    setLoadState: vi.fn(),
    setChapterDocumentLoad: vi.fn(),
    setContentLoadError: vi.fn(),
    commitActiveChapter: vi.fn(),
    loadChapterDraft: vi.fn(async () => undefined),
    requestWorkspaceLeave: vi.fn(async (request: Record<string, unknown>) => {
      const continueAction = request.continueAction as (() => Promise<void>) | undefined;
      await continueAction?.();
      return 'proceed';
    }),
    flushRecovery: vi.fn(async () => undefined),
    clearRecovery: vi.fn(async () => undefined),
    dismissRecoveryPrompt: vi.fn(),
    getChapterById: vi.fn(async () => chapter),
  };
  return {
    timestamp,
    chapter,
    draft,
    actions,
    sidebarState: {
      activeTool: 'outline',
      collapsed: false,
      lastActiveTool: 'check',
      toolStates: {},
      openTool: actions.openSidebarTool,
      close: actions.closeSidebar,
      updateTool: actions.updateSidebarTool,
      reset: actions.resetSidebar,
    },
    sessionState: {
      sessionNovelId: 'novel-1',
      novel: { id: 'novel-1', title: '遗忘之城' },
      volumes: [{ id: 'volume-1', title: '第一卷' }],
      chapters: [chapter],
      activeChapterId: chapter.id,
      currentDraft: draft,
      editorSnapshot: {
        chapterId: chapter.id,
        content: '编辑器正文',
        wordCount: 120,
        isDirty: true,
        contentHash: 'content-hash',
        contentAvailable: true,
        selectionStart: 0,
        selectionEnd: 2,
      },
      draftWordCount: 120,
      isDirty: true,
      qcReport: null,
      qcItems: [],
      aiModal: { running: false, title: '', stage: '', progress: 0 },
      startSession: actions.startSession,
      setNovel: actions.setNovel,
      setVolumes: actions.setVolumes,
      setChapters: actions.setChapters,
      setActiveChapterId: actions.setActiveChapterId,
      setCurrentDraft: actions.setCurrentDraft,
      setEditorSnapshot: actions.setEditorSnapshot,
      setEditorActivity: actions.setEditorActivity,
      setDraftWordCount: actions.setDraftWordCount,
      setDirty: actions.setDirty,
      setQuality: actions.setQuality,
      setAiModal: actions.setAiModal,
    },
  };
});

vi.mock('react-router-dom', () => ({
  useParams: () => ({ novelId: 'novel-1' }),
  useSearchParams: () => [new URLSearchParams('chapterId=chapter-1&draftId=draft-1')],
  useNavigate: () => mocks.actions.navigate,
}));

vi.mock('zustand/react/shallow', () => ({ useShallow: (selector: unknown) => selector }));

vi.mock('../../store/rightSidebarStore', () => ({
  useRightSidebarStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(mocks.sidebarState),
}));

vi.mock('../../store/workspaceSessionStore', () => ({
  useWorkspaceSessionStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector(mocks.sessionState),
}));

vi.mock('../../features/workspace/useWorkspaceChapterLoader', () => ({
  useWorkspaceChapterLoader: () => ({
    pageLoading: false,
    pageError: '',
    loadState: 'ready',
    setLoadState: mocks.actions.setLoadState,
    chapterDocumentLoad: { status: 'ready' },
    setChapterDocumentLoad: mocks.actions.setChapterDocumentLoad,
    contentLoadError: null,
    setContentLoadError: mocks.actions.setContentLoadError,
    documentBlockedRef: { current: false },
    isChapterDocumentBlocked: false,
    commitActiveChapter: mocks.actions.commitActiveChapter,
    loadChapterDraft: mocks.actions.loadChapterDraft,
    retryChapterDraftLoad: vi.fn(),
    retryActiveChapterContent: vi.fn(),
    retryingContent: false,
  }),
}));

vi.mock('../../features/workspace/useWorkspaceDraftApplication', () => ({
  useWorkspaceDraftApplication: () => ({
    applyTextRequest: null,
    editorCommandRequest: null,
    handleDraftApplied: vi.fn(),
    handlePersistentDraftSaved: vi.fn(),
    applyAiTextToEditor: vi.fn(async () => true),
    handleApplyTextConsumed: vi.fn(),
    handleApplyTextRejected: vi.fn(),
    runEditorCommand: vi.fn(),
  }),
}));

vi.mock('../../features/workspace/useWorkspaceCreationActions', () => ({
  useWorkspaceCreationActions: () => ({
    handleCreateVolume: vi.fn(async () => undefined),
    handleCreateChapter: vi.fn(async () => undefined),
    handleCreateFirstChapter: vi.fn(async () => undefined),
  }),
}));

vi.mock('../../features/workspace/useWorkspaceRecoveryActions', () => ({
  useWorkspaceRecoveryActions: () => ({
    busy: false,
    restore: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined),
    saveAsDraft: vi.fn(async () => undefined),
  }),
}));

vi.mock('../../hooks/useWorkspaceRecovery', () => ({
  useWorkspaceRecovery: () => ({
    prompt: { status: 'none' },
    saveStatus: 'saved',
    flush: mocks.actions.flushRecovery,
    clear: mocks.actions.clearRecovery,
    dismissPrompt: mocks.actions.dismissRecoveryPrompt,
  }),
}));

vi.mock('../../hooks/useWorkspaceLeaveGuard', () => ({
  useWorkspaceLeaveGuard: () => ({
    requestWorkspaceLeave: mocks.actions.requestWorkspaceLeave,
    dialog: <div data-testid="leave-dialog" />,
  }),
}));

vi.mock('../../features/workspace/useWorkspaceSummary', () => ({
  useWorkspaceSummary: () => ({
    exists: true,
    dialogOpen: false,
    result: null,
    loading: false,
    error: '',
    setDialogOpen: vi.fn(),
    setResult: vi.fn(),
    setError: vi.fn(),
    save: vi.fn(),
    regenerate: vi.fn(),
    stop: vi.fn(),
  }),
}));

vi.mock('../../services/database/chapterRepository', () => ({
  chapterRepository: { getById: mocks.actions.getChapterById },
}));

vi.mock('../../pages/WritingWorkspace/WritingWorkspaceView', () => ({
  default: (props: Record<string, unknown>) => {
    const actions = props.actions as Record<string, (...args: unknown[]) => unknown>;
    return (
      <div data-testid="workspace-view">
        <button type="button" onClick={() => void actions.selectChapter('chapter-2')}>
          select
        </button>
        <button type="button" onClick={() => void actions.selectChapter('chapter-1')}>
          same
        </button>
        <button type="button" onClick={() => actions.setChapterGoalDirty(true)}>
          dirty-goal
        </button>
        <button type="button" onClick={() => void actions.togglePanel('chapter-summary')}>
          toggle
        </button>
        <button type="button" onClick={() => void actions.closePanel()}>
          close
        </button>
        <button
          type="button"
          onClick={() =>
            actions.editorContentChange({
              chapterId: 'chapter-1',
              content: '新正文',
              wordCount: 200,
              isDirty: true,
              contentHash: 'new-hash',
              contentAvailable: true,
            })
          }
        >
          content-change
        </button>
        <button type="button" onClick={() => void actions.chapterOutlineApplied('chapter-1')}>
          outline
        </button>
        <button type="button" onClick={() => void actions.confirmEditorLeave()}>
          confirm-leave
        </button>
        <button type="button" onClick={() => actions.locateText(1, 2, '引用', 0)}>
          locate
        </button>
        <button type="button" onClick={() => actions.locateDone()}>
          locate-done
        </button>
        <button type="button" onClick={() => actions.showAiModal('标题', '副标题')}>
          show-modal
        </button>
        <button type="button" onClick={() => actions.updateAiModal('阶段', 50)}>
          update-modal
        </button>
        <button type="button" onClick={() => actions.hideAiModal()}>
          hide-modal
        </button>
        <button type="button" onClick={() => actions.updateSidebarTool('check', { loading: true })}>
          update-tool
        </button>
        <button type="button" onClick={() => actions.openSidebarTool('check')}>
          open-tool
        </button>
        <button type="button" onClick={() => actions.closeSidebar()}>
          close-sidebar
        </button>
        <button type="button" onClick={() => actions.setQuality(null, [])}>
          quality
        </button>
        <button type="button" onClick={() => actions.bumpContextVersion()}>
          context
        </button>
        <div data-testid="editor-click" onClick={(event) => actions.editorClick(event)}>
          editor
        </div>
      </div>
    );
  },
}));

import WritingWorkspacePage from '../../pages/WritingWorkspace/WritingWorkspacePage';
import * as nativeDialog from '../../utils/nativeDialog';

beforeEach(() => {
  vi.spyOn(nativeDialog, 'confirmInfo').mockResolvedValue(true);
});

describe('WritingWorkspacePage orchestration', () => {
  it('routes workspace actions through unified stores and reliability guards', async () => {
    render(<WritingWorkspacePage />);
    expect(mocks.actions.startSession).toHaveBeenCalledWith('novel-1');
    expect(mocks.actions.resetSidebar).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'select' }));
    await waitFor(() =>
      expect(mocks.actions.loadChapterDraft).toHaveBeenCalledWith('chapter-2', true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'same' }));
    fireEvent.click(screen.getByRole('button', { name: 'dirty-goal' }));
    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    await waitFor(() =>
      expect(mocks.actions.openSidebarTool).toHaveBeenCalledWith('chapter-summary'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    fireEvent.click(screen.getByRole('button', { name: 'content-change' }));
    fireEvent.click(screen.getByRole('button', { name: 'outline' }));
    await waitFor(() => expect(mocks.actions.getChapterById).toHaveBeenCalledWith('chapter-1'));
    fireEvent.click(screen.getByRole('button', { name: 'confirm-leave' }));
    fireEvent.click(screen.getByRole('button', { name: 'locate' }));
    fireEvent.click(screen.getByRole('button', { name: 'locate-done' }));
    fireEvent.click(screen.getByRole('button', { name: 'show-modal' }));
    fireEvent.click(screen.getByRole('button', { name: 'update-modal' }));
    fireEvent.click(screen.getByRole('button', { name: 'hide-modal' }));
    fireEvent.click(screen.getByRole('button', { name: 'update-tool' }));
    fireEvent.click(screen.getByRole('button', { name: 'open-tool' }));
    fireEvent.click(screen.getByRole('button', { name: 'close-sidebar' }));
    fireEvent.click(screen.getByRole('button', { name: 'quality' }));
    fireEvent.click(screen.getByRole('button', { name: 'context' }));
    fireEvent.click(screen.getByTestId('editor-click'));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent(window, new Event('beforeunload', { cancelable: true }));

    expect(mocks.actions.setEditorActivity).toHaveBeenCalledWith(
      expect.objectContaining({ content: '新正文', wordCount: 200, isDirty: true }),
    );
    expect(mocks.actions.setAiModal).toHaveBeenCalledTimes(3);
    expect(mocks.actions.updateSidebarTool).toHaveBeenCalled();
    expect(mocks.actions.setQuality).toHaveBeenCalledWith(null, []);
    expect(mocks.actions.flushRecovery).toHaveBeenCalled();
  });
});
