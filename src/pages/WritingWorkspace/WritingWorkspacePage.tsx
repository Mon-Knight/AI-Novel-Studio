import {
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type MouseEvent,
} from 'react';
import { useShallow } from 'zustand/react/shallow';
import { confirmInfo } from '../../utils/nativeDialog';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  type EditorAreaHandle,
  type EditorContentSnapshot,
} from '../../components/workspace/EditorArea';
import { chapterRepository } from '../../services/database/chapterRepository';
import type { PanelType as RightSidebarPanelType } from '../../types/rightSidebar';
import { useWorkspaceDraftApplication } from '../../features/workspace/useWorkspaceDraftApplication';
import { useWorkspaceChapterLoader } from '../../features/workspace/useWorkspaceChapterLoader';
import { useWorkspaceCreationActions } from '../../features/workspace/useWorkspaceCreationActions';
import { useWorkspaceRecoveryActions } from '../../features/workspace/useWorkspaceRecoveryActions';
import { useWorkspaceRecovery } from '../../hooks/useWorkspaceRecovery';
import { useWorkspaceLeaveGuard } from '../../hooks/useWorkspaceLeaveGuard';
import { useWorkspaceSummary } from '../../features/workspace/useWorkspaceSummary';
import { getCurrentWritingContext, type WritingContext } from '../../utils/writingContext';
import { useRightSidebarStore } from '../../store/rightSidebarStore';
import { useWorkspaceSessionStore } from '../../store/workspaceSessionStore';
import WritingWorkspaceView from './WritingWorkspaceView';
import '../../styles/workspace.css';
import '../../styles/right-dock.css';

export type PanelType = RightSidebarPanelType;

function WritingWorkspacePage() {
  const { novelId } = useParams<{ novelId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const sidebarState = useRightSidebarStore(
    useShallow((state) => ({
      activeTool: state.activeTool,
      collapsed: state.collapsed,
      lastActiveTool: state.lastActiveTool,
      toolStates: state.toolStates,
    })),
  );
  const openSidebarTool = useRightSidebarStore((state) => state.openTool);
  const closeSidebar = useRightSidebarStore((state) => state.close);
  const updateSidebarTool = useRightSidebarStore((state) => state.updateTool);
  const resetSidebar = useRightSidebarStore((state) => state.reset);
  const activePanel = sidebarState.activeTool;
  const workspaceSession = useWorkspaceSessionStore(
    useShallow((state) => ({
      novel: state.novel,
      volumes: state.volumes,
      chapters: state.chapters,
      activeChapterId: state.activeChapterId,
      currentDraft: state.currentDraft,
      editorSnapshot: state.editorSnapshot,
      draftWordCount: state.draftWordCount,
      isDirty: state.isDirty,
      qcReport: state.qcReport,
      qcItems: state.qcItems,
      aiModal: state.aiModal,
    })),
  );
  const workspaceActions = useWorkspaceSessionStore(
    useShallow((state) => ({
      startSession: state.startSession,
      setNovel: state.setNovel,
      setVolumes: state.setVolumes,
      setChapters: state.setChapters,
      setActiveChapterId: state.setActiveChapterId,
      setCurrentDraft: state.setCurrentDraft,
      setEditorSnapshot: state.setEditorSnapshot,
      setDraftWordCount: state.setDraftWordCount,
      setDirty: state.setDirty,
      setQuality: state.setQuality,
      setAiModal: state.setAiModal,
    })),
  );
  const { chapters, activeChapterId, currentDraft, editorSnapshot } = workspaceSession;
  const {
    startSession,
    setNovel,
    setVolumes,
    setChapters,
    setActiveChapterId,
    setCurrentDraft,
    setEditorSnapshot,
    setDraftWordCount,
    setDirty: setIsDirty,
    setQuality,
    setAiModal,
  } = workspaceActions;
  const [chapterGoalDirty, setChapterGoalDirty] = useState(false);
  const chapterGoalDirtyRef = useRef(chapterGoalDirty);
  const editorRef = useRef<EditorAreaHandle>(null);
  const activeNovelIdRef = useRef(novelId || '');
  const activeChapterIdRef = useRef(activeChapterId);
  const editorSnapshotRef = useRef(editorSnapshot);
  const currentDraftRef = useRef(currentDraft);
  const chapterLoaderRefs = useMemo(
    () => ({
      activeNovelId: activeNovelIdRef,
      activeChapterId: activeChapterIdRef,
      editorSnapshot: editorSnapshotRef,
      currentDraft: currentDraftRef,
    }),
    [],
  );

  activeNovelIdRef.current = novelId || '';
  activeChapterIdRef.current = activeChapterId;
  editorSnapshotRef.current = editorSnapshot;
  currentDraftRef.current = currentDraft;
  chapterGoalDirtyRef.current = chapterGoalDirty;

  useLayoutEffect(() => {
    startSession(novelId || '');
    resetSidebar();
  }, [novelId, resetSidebar, startSession]);

  // v1.0.42 上下文版本号（角色变更/字数变更时递增，触发 AiGeneratePanel 刷新摘要）
  const [contextVersion, setContextVersion] = useState(0);
  const bumpContextVersion = useCallback(() => setContextVersion((v) => v + 1), []);

  // v1.7.12/v1.7.16 质量检查正文定位
  const [locateTarget, setLocateTarget] = useState<{
    startOffset: number;
    endOffset: number;
    quote?: string;
    paragraphIndex?: number;
  } | null>(null);
  const handleLocateText = useCallback(
    (startOffset: number, endOffset: number, quote?: string, paragraphIndex?: number) => {
      setLocateTarget({ startOffset, endOffset, quote, paragraphIndex });
    },
    [],
  );
  const handleLocateDone = useCallback(() => setLocateTarget(null), []);

  // v1.7.19 全局 AI 任务弹窗状态
  const showAiModal = useCallback(
    (title: string, subtitle?: string) => {
      setAiModal({ running: true, title, subtitle, stage: '', progress: 0 });
    },
    [setAiModal],
  );
  const updateAiModal = useCallback(
    (stage: string, progress: number) => {
      setAiModal((prev) => ({ ...prev, stage, progress }));
    },
    [setAiModal],
  );
  const hideAiModal = useCallback(() => {
    setAiModal((prev) => ({ ...prev, running: false, stage: '完成', progress: 100 }));
  }, [setAiModal]);

  const chapterLoader = useWorkspaceChapterLoader({
    novelId,
    requestedChapterId: searchParams.get('chapterId'),
    requestedDraftId: searchParams.get('draftId')?.trim() || undefined,
    refs: chapterLoaderRefs,
    setNovel,
    setVolumes,
    setChapters,
    setActiveChapterId,
    setCurrentDraft,
    setDraftWordCount,
    setDirty: setIsDirty,
  });
  const {
    setLoadState,
    setChapterDocumentLoad,
    contentLoadError,
    setContentLoadError,
    documentBlockedRef: chapterDocumentBlockedRef,
    commitActiveChapter,
    loadChapterDraft,
  } = chapterLoader;

  const workspaceOperationRefs = useMemo(
    () => ({
      activeNovelId: activeNovelIdRef,
      activeChapterId: activeChapterIdRef,
      currentDraft: currentDraftRef,
      editorSnapshot: editorSnapshotRef,
      chapterGoalDirty: chapterGoalDirtyRef,
      documentBlocked: chapterDocumentBlockedRef,
    }),
    [chapterDocumentBlockedRef],
  );

  // v1.7.19 质量检查状态上移（不随面板卸载丢失）

  const activeChapter = chapters.find((ch) => ch.id === activeChapterId);
  const activeDraft = currentDraft?.chapterId === activeChapterId ? currentDraft : null;
  const activeContentState = contentLoadError ?? activeDraft?.contentState;
  const contentAvailable = activeContentState?.status !== 'unavailable';
  const summary = useWorkspaceSummary({
    novelId,
    activeChapter,
    currentDraft,
    contentAvailable,
    setChapters,
    bumpContextVersion,
  });
  // v1.0.45 统一写作上下文（派生状态，面板通过此获取全文/选中文本/章节等）
  const writingContext: WritingContext = getCurrentWritingContext({
    fullText: contentAvailable
      ? editorSnapshot.chapterId === activeChapterId
        ? editorSnapshot.content
        : activeDraft?.content || ''
      : '',
    chapter: activeChapter,
    currentDraft: activeDraft,
    novelId,
    isDirty:
      contentAvailable && editorSnapshot.chapterId === activeChapterId
        ? editorSnapshot.isDirty
        : false,
  });

  const {
    prompt: recoveryPrompt,
    saveStatus: recoverySaveStatus,
    flush: flushRecovery,
    clear: clearRecovery,
    dismissPrompt: dismissRecoveryPrompt,
  } = useWorkspaceRecovery({
    editor:
      novelId && activeChapterId && editorSnapshot.chapterId === activeChapterId
        ? {
            novelId,
            chapterId: activeChapterId,
            draftId: activeDraft?.id,
            draftVersion: activeDraft?.versionNo,
            baseContentHash:
              activeDraft?.contentState?.status === 'ready'
                ? activeDraft.contentState.contentHash
                : undefined,
            content: contentAvailable ? editorSnapshot.content : '',
            dirty: contentAvailable && editorSnapshot.isDirty,
            contentAvailable,
            selectionStart: editorSnapshot.selectionStart,
            selectionEnd: editorSnapshot.selectionEnd,
          }
        : null,
  });

  const draftApplication = useWorkspaceDraftApplication({
    refs: workspaceOperationRefs,
    setCurrentDraft,
    setDraftWordCount,
    setDirty: setIsDirty,
    setEditorSnapshot,
    clearRecovery,
  });
  const confirmDiscardChapterGoal = useCallback(async () => {
    if (!chapterGoalDirtyRef.current) return true;
    return await confirmInfo({
      title: '未保存修改',
      message: '本章目标有未保存修改，离开后这些修改不会进入正文生成。是否继续？',
      testId: 'leave-guard',
    });
  }, []);

  const { requestWorkspaceLeave, dialog: leaveGuardDialog } = useWorkspaceLeaveGuard({
    shouldGuard:
      activeContentState?.status === 'unavailable' ||
      (contentAvailable && editorSnapshot.chapterId === activeChapterId && editorSnapshot.isDirty),
    shouldPreflight: chapterGoalDirty,
    preflight: confirmDiscardChapterGoal,
    contentAvailable,
    save: async () => {
      const expectedNovelId = activeNovelIdRef.current;
      const expectedChapterId = activeChapterIdRef.current;
      const saved = await editorRef.current?.save();
      return !!saved && saved.novelId === expectedNovelId && saved.chapterId === expectedChapterId;
    },
    discard: async () => {
      const target = {
        novelId: activeNovelIdRef.current,
        chapterId: activeChapterIdRef.current,
      };
      if (!target.novelId || !target.chapterId) return;
      await clearRecovery(target);
    },
    flushRecovery,
  });

  const clearContentLoadError = useCallback(() => setContentLoadError(null), [setContentLoadError]);
  const creationActions = useWorkspaceCreationActions({
    novelId,
    refs: workspaceOperationRefs,
    requestWorkspaceLeave,
    commitActiveChapter,
    setVolumes,
    setChapters,
    setCurrentDraft,
    setDraftWordCount,
    setDirty: setIsDirty,
    setChapterGoalDirty,
    setLoadState,
    setChapterDocumentLoad,
    clearContentLoadError,
  });
  const recoveryActions = useWorkspaceRecoveryActions({
    prompt: recoveryPrompt,
    editorRef,
    requestWorkspaceLeave,
    clearRecovery,
    dismissPrompt: dismissRecoveryPrompt,
  });

  const confirmEditorLeave = useCallback(async () => {
    const decision = await requestWorkspaceLeave({ reason: 'draft_adopt' });
    return decision === 'proceed';
  }, [requestWorkspaceLeave]);

  const handleSelectChapter = useCallback(
    async (chapterId: string) => {
      if (chapterId === activeChapterIdRef.current) return;
      await requestWorkspaceLeave({
        reason: 'chapter_switch',
        targetNovelId: activeNovelIdRef.current,
        targetChapterId: chapterId,
        continueAction: async () => {
          setChapterGoalDirty(false);
          chapterGoalDirtyRef.current = false;
          // 面板保持挂载，但正文相关面板将读取新的安全状态。
          await loadChapterDraft(chapterId, true);
        },
      });
    },
    [loadChapterDraft, requestWorkspaceLeave],
  );

  const handleTogglePanel = useCallback(
    async (panel: PanelType) => {
      if (activePanel === 'outline' && !(await confirmDiscardChapterGoal())) return;
      if (activePanel === 'outline') setChapterGoalDirty(false);
      openSidebarTool(panel);
    },
    [activePanel, confirmDiscardChapterGoal, openSidebarTool],
  );

  const handleClosePanel = useCallback(async () => {
    if (!(await confirmDiscardChapterGoal())) return;
    setChapterGoalDirty(false);
    closeSidebar();
  }, [closeSidebar, confirmDiscardChapterGoal]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClosePanel();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClosePanel]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!editorSnapshotRef.current.isDirty && !chapterGoalDirty) return;
      void flushRecovery();
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [chapterGoalDirty, flushRecovery]);

  const handleEditorClick = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'button, a, input, textarea, select, [role="button"], .editor-toolbar, .workspace-topbar',
        )
      ) {
        return;
      }
      handleClosePanel();
    },
    [handleClosePanel],
  );

  const handleDraftChange = useCallback(
    (wordCount: number, dirty: boolean) => {
      setDraftWordCount(wordCount);
      setIsDirty(dirty);
    },
    [setDraftWordCount, setIsDirty],
  );

  const handleEditorContentChange = useCallback(
    (snapshot: EditorContentSnapshot) => {
      editorSnapshotRef.current = snapshot;
      setEditorSnapshot(snapshot);
      setDraftWordCount(snapshot.wordCount);
      setIsDirty(snapshot.isDirty);
    },
    [setDraftWordCount, setEditorSnapshot, setIsDirty],
  );

  // v1.0.34 章节大纲应用回调：刷新父组件的章节状态
  const handleChapterOutlineApplied = useCallback(
    async (chapterId: string) => {
      if (!chapterId) return;
      try {
        const updated = await chapterRepository.getById(chapterId);
        if (updated) {
          setChapters((prev) => prev.map((c) => (c.id === chapterId ? updated : c)));
        }
      } catch {
        // 刷新失败时静默处理，不影响用户操作
      }
    },
    [setChapters],
  );

  return (
    <WritingWorkspaceView
      novelId={novelId}
      navigate={navigate}
      session={workspaceSession}
      sidebarState={sidebarState}
      chapterLoader={chapterLoader}
      draftApplication={draftApplication}
      creationActions={creationActions}
      recoveryActions={recoveryActions}
      summary={summary}
      recoveryPrompt={recoveryPrompt}
      recoverySaveStatus={recoverySaveStatus}
      refs={{
        editor: editorRef,
        activeChapterId: activeChapterIdRef,
        editorSnapshot: editorSnapshotRef,
      }}
      actions={{
        selectChapter: handleSelectChapter,
        togglePanel: handleTogglePanel,
        closePanel: handleClosePanel,
        editorClick: handleEditorClick,
        draftChange: handleDraftChange,
        editorContentChange: handleEditorContentChange,
        chapterOutlineApplied: handleChapterOutlineApplied,
        confirmEditorLeave,
        openSidebarTool,
        closeSidebar,
        setChapterGoalDirty,
        bumpContextVersion,
        locateText: handleLocateText,
        locateDone: handleLocateDone,
        setQuality,
        showAiModal,
        updateAiModal,
        hideAiModal,
        updateSidebarTool,
        dismissRecoveryPrompt,
      }}
      contextVersion={contextVersion}
      locateTarget={locateTarget}
      writingContext={writingContext}
      leaveGuardDialog={leaveGuardDialog}
    />
  );
}
export default WritingWorkspacePage;
