import { useState, useCallback, useEffect, useRef, type MouseEvent } from 'react';
import { confirmDanger, confirmInfo, showError, showInfo } from '../../utils/nativeDialog';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import BackButton from '../../components/common/BackButton';
import VolumeTree from '../../components/workspace/VolumeTree';
import EditorArea, {
  type EditorAreaHandle,
  type EditorCommandRequest,
  type EditorCommandType,
  type EditorContentSnapshot,
} from '../../components/workspace/EditorArea';
import StatusBar from '../../components/workspace/StatusBar';
import RightToolbar from '../../components/right-dock/RightToolbar';
import RightPanel from '../../components/right-dock/RightPanel';
import DraftHistoryPanel from '../../components/right-dock/panels/DraftHistoryPanel';
import ChapterSummaryDialog from '../../components/chapter-summary/ChapterSummaryDialog';
import GlobalAiTaskModal from '../../components/workspace/GlobalAiTaskModal';
import type { AiTaskModalState } from '../../components/workspace/GlobalAiTaskModal';
import { novelRepository } from '../../services/database/novelRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { volumeRepository } from '../../services/database/volumeRepository';
import { draftVersionService } from '../../services/database/draftVersionService';
import { createVolumeForNovel, createFirstVolumeAndChapter, createChapterInVolume } from '../../services/chapters/chapterCreationService';
import { chapterSummarizeService } from '../../services/ai/chapterSummarizeService';
import { chapterSummaryService } from '../../services/context/chapterSummaryService';
import { chapterContextPersistenceService } from '../../services/context/chapterContextPersistenceService';
import type { Novel } from '../../types/novel';
import type { Chapter } from '../../types/chapter';
import type { Volume } from '../../types/volume';
import type { ChapterDraft } from '../../types/ai';
import type { ChapterSummarizeResult } from '../../types/chapterSummary';
import type {
  AiTextApplyPayload,
  AiTextApplyRequest,
  DraftResultMetadata,
} from '../../types/workspaceSafety';
import {
  DocumentApplyIdempotencyGuard,
  MonotonicDocumentLoadGuard,
  resolveGuardedDocumentLoad,
  validateDocumentApplication,
  validateDraftDocumentTarget,
} from '../../features/workspace/documentSafety';
import { hashTextContent } from '../../utils/contentHash';
import { getCurrentWritingContext, type WritingContext } from '../../utils/writingContext';
import {
  createInitialSidebarState,
  updateToolState,
  switchTool,
  closePanel,
  type RightSidebarState,
  type PanelToolState,
} from '../../store/rightSidebarStore';
import '../../styles/workspace.css';
import '../../styles/right-dock.css';

export type PanelType =
  | 'ai-generate' | 'engineering' | 'outline' | 'characters' | 'events'
  | 'setting' | 'style' | 'check' | 'polish'
  | 'draft-history' | 'chapter-summary' | 'context-view' | null;

const NOVEL_LOAD_RETRY_DELAYS_MS = [120, 240, 480];
const CHAPTER_DOCUMENT_LOAD_ERROR = '无法读取并校验完整正文。为防止截断内容覆盖原文，已阻止切换或写入，当前安全正文保持不变，请重试。';

type ChapterDocumentLoadState =
  | { status: 'ready'; chapterId?: string }
  | { status: 'loading'; chapterId: string }
  | { status: 'error'; chapterId: string; message: string };

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function getNovelForWorkspace(novelId: string): Promise<Novel | null> {
  for (let attempt = 0; attempt <= NOVEL_LOAD_RETRY_DELAYS_MS.length; attempt += 1) {
    const found = await novelRepository.getById(novelId);
    if (found) return found;

    const delay = NOVEL_LOAD_RETRY_DELAYS_MS[attempt];
    if (delay) {
      console.info('[Workspace] novel not found on first read, retrying...', {
        novelId,
        attempt: attempt + 1,
        delay,
      });
      await wait(delay);
    }
  }

  const allNovels = await novelRepository.getAll().catch((error) => {
    console.warn('[Workspace] failed to recheck novel list after missing novel', {
      novelId,
      error,
    });
    return [];
  });
  return allNovels.find((item) => item.id === novelId) ?? null;
}

function WritingWorkspacePage() {
  const { novelId } = useParams<{ novelId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  // v1.0.45 统一右侧栏状态模型（必须在 activePanel 之前声明）
  const [sidebarState, setSidebarState] = useState<RightSidebarState>(createInitialSidebarState);
  // v1.0.45: activePanel 从统一 sidebarState 派生，不再独立管理
  const activePanel = sidebarState.activeTool;
  const [novel, setNovel] = useState<Novel | null>(null);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string>('');
  const [currentDraft, setCurrentDraft] = useState<ChapterDraft | null>(null);
  const [editorSnapshot, setEditorSnapshot] = useState<EditorContentSnapshot>({
    content: '',
    wordCount: 0,
    isDirty: false,
    contentHash: hashTextContent(''),
  });
  const [applyTextRequest, setApplyTextRequest] = useState<AiTextApplyRequest | null>(null);
  const [editorCommandRequest, setEditorCommandRequest] = useState<EditorCommandRequest | null>(null);
  const [draftWordCount, setDraftWordCount] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [chapterGoalDirty, setChapterGoalDirty] = useState(false);
  const chapterGoalDirtyRef = useRef(chapterGoalDirty);
  const editorRef = useRef<EditorAreaHandle>(null);
  const activeNovelIdRef = useRef(novelId || '');
  const activeChapterIdRef = useRef(activeChapterId);
  const editorSnapshotRef = useRef(editorSnapshot);
  const currentDraftRef = useRef(currentDraft);
  const documentLoadGuardRef = useRef(new MonotonicDocumentLoadGuard());
  const applyIdempotencyGuardRef = useRef(new DocumentApplyIdempotencyGuard());
  const pendingApplyKeysRef = useRef(new Map<string, AiTextApplyPayload>());

  activeNovelIdRef.current = novelId || '';
  activeChapterIdRef.current = activeChapterId;
  editorSnapshotRef.current = editorSnapshot;
  currentDraftRef.current = currentDraft;
  chapterGoalDirtyRef.current = chapterGoalDirty;

  // v1.0.42 上下文版本号（角色变更/字数变更时递增，触发 AiGeneratePanel 刷新摘要）
  const [contextVersion, setContextVersion] = useState(0);
  const bumpContextVersion = useCallback(() => setContextVersion((v) => v + 1), []);

  // v1.7.12/v1.7.16 质量检查正文定位
  const [locateTarget, setLocateTarget] = useState<{ startOffset: number; endOffset: number; quote?: string; paragraphIndex?: number } | null>(null);
  const handleLocateText = useCallback((startOffset: number, endOffset: number, quote?: string, paragraphIndex?: number) => {
    setLocateTarget({ startOffset, endOffset, quote, paragraphIndex });
  }, []);
  const handleLocateDone = useCallback(() => setLocateTarget(null), []);

  // v1.7.19 全局 AI 任务弹窗状态
  const [aiModal, setAiModal] = useState<AiTaskModalState>({
    running: false, title: '', stage: '', progress: 0,
  });
  const showAiModal = useCallback((title: string, subtitle?: string) => {
    setAiModal({ running: true, title, subtitle, stage: '', progress: 0 });
  }, []);
  const updateAiModal = useCallback((stage: string, progress: number) => {
    setAiModal((prev) => ({ ...prev, stage, progress }));
  }, []);
  const hideAiModal = useCallback(() => {
    setAiModal((prev) => ({ ...prev, running: false, stage: '完成', progress: 100 }));
  }, []);

  // v1.7.19 质量检查状态上移（不随面板卸载丢失）
  const [qcReport, setQcReport] = useState<any>(null);
  const [qcItems, setQcItems] = useState<any[]>([]);

  // v0.8.0 上下文总结相关状态
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false);
  const [summaryResult, setSummaryResult] = useState<ChapterSummarizeResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [summaryExists, setSummaryExists] = useState(false);

  const activeChapter = chapters.find((ch) => ch.id === activeChapterId);
  const activeDraft = currentDraft?.chapterId === activeChapterId ? currentDraft : null;

  // v1.0.45 统一写作上下文（派生状态，面板通过此获取全文/选中文本/章节等）
  const writingContext: WritingContext = getCurrentWritingContext({
    fullText: editorSnapshot.chapterId === activeChapterId ? editorSnapshot.content : activeDraft?.content || '',
    chapter: activeChapter,
    currentDraft: activeDraft,
    novelId,
    isDirty: editorSnapshot.chapterId === activeChapterId ? editorSnapshot.isDirty : false,
  });

  const activeQcReport = qcReport?.chapterId === activeChapterId ? qcReport : null;
  const activeQcItems = activeQcReport ? qcItems.filter((item) => item.chapterId === activeChapterId) : [];

  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState('');

  // 工作台加载状态机
  type WorkspaceLoadState = 'loading' | 'ready' | 'novel_not_found' | 'error';
  const [loadState, setLoadState] = useState<WorkspaceLoadState>('loading');
  const [chapterDocumentLoad, setChapterDocumentLoad] = useState<ChapterDocumentLoadState>({ status: 'ready' });
  const isChapterDocumentBlocked = chapterDocumentLoad.status === 'loading'
    || (chapterDocumentLoad.status === 'error' && chapterDocumentLoad.chapterId === activeChapterId);
  const chapterDocumentBlockedRef = useRef(isChapterDocumentBlocked);
  chapterDocumentBlockedRef.current = isChapterDocumentBlocked;

  const commitActiveChapter = useCallback((chapterId: string) => {
    documentLoadGuardRef.current.invalidate();
    activeChapterIdRef.current = chapterId;
    setActiveChapterId(chapterId);
    setCurrentDraft(null);
    currentDraftRef.current = null;
  }, []);

  const loadChapterDraft = useCallback(async (chapterId: string, activateOnSuccess = false) => {
    const requestNovelId = activeNovelIdRef.current;
    if (!requestNovelId) return false;
    const target = { novelId: requestNovelId, chapterId };
    const token = documentLoadGuardRef.current.issue(target);
    chapterDocumentBlockedRef.current = true;
    setChapterDocumentLoad({ status: 'loading', chapterId });
    try {
      const resolved = await resolveGuardedDocumentLoad(
        documentLoadGuardRef.current,
        token,
        draftVersionService.getLatestByChapterId(chapterId),
        () => activateOnSuccess
          ? target
          : { novelId: activeNovelIdRef.current, chapterId: activeChapterIdRef.current },
      );
      if (!resolved.accepted) return false;
      if (activeNovelIdRef.current !== requestNovelId) return false;
      const draft = resolved.value;
      if (draft) {
        const draftDecision = validateDraftDocumentTarget(draft, target);
        if (!draftDecision.ok) throw new Error(draftDecision.message);
      }
      if (activateOnSuccess) commitActiveChapter(chapterId);
      setCurrentDraft(draft);
      currentDraftRef.current = draft;
      setDraftWordCount(draft?.wordCount || 0);
      setIsDirty(false);
      chapterDocumentBlockedRef.current = false;
      setChapterDocumentLoad({ status: 'ready', chapterId });
      return true;
    } catch (error) {
      console.warn('[Workspace] blocked an unsafe chapter draft load', { chapterId, error });
      if (token.epoch === documentLoadGuardRef.current.currentEpoch
        && activeNovelIdRef.current === requestNovelId
        && (activateOnSuccess || activeChapterIdRef.current === chapterId)) {
        chapterDocumentBlockedRef.current = activeChapterIdRef.current === chapterId;
        setChapterDocumentLoad({
          status: 'error',
          chapterId,
          message: CHAPTER_DOCUMENT_LOAD_ERROR,
        });
      }
      return false;
    }
  }, [commitActiveChapter]);

  useEffect(() => {
    if (!novelId) return;
    let cancelled = false;
    setPageLoading(true);
    setPageError('');
    setLoadState('loading');

    // 并行加载，任一失败不影响
    Promise.allSettled([
      getNovelForWorkspace(novelId),
      volumeRepository.getByNovelId(novelId),
      chapterRepository.getByNovelId(novelId),
    ]).then(([nr, vr, cr]) => {
      if (cancelled) return;
      if (nr.status === 'fulfilled') {
        if (nr.value) { setNovel(nr.value); }
        else { setLoadState('novel_not_found'); setPageLoading(false); return; }
      } else { setPageError('作品加载失败'); setLoadState('error'); setPageLoading(false); return; }

      if (vr.status === 'fulfilled') setVolumes(vr.value);
      if (cr.status === 'fulfilled') {
        const list = cr.value;
        setChapters(list);
        const urlChapterId = searchParams.get('chapterId');
        const targetId = (urlChapterId && list.find((c) => c.id === urlChapterId))
          ? urlChapterId : list[0]?.id;
        if (targetId) {
          void loadChapterDraft(targetId, true);
        } else {
          setChapterDocumentLoad({ status: 'ready' });
        }
      }
      setLoadState('ready');
      setPageLoading(false);
    });

    return () => { cancelled = true; };
  }, [novelId, searchParams, commitActiveChapter, loadChapterDraft]);

  const confirmDiscardChapterGoal = useCallback(async () => {
    if (!chapterGoalDirtyRef.current) return true;
    return await confirmInfo({ title: '未保存修改', message: '本章目标有未保存修改，切换后这些修改不会进入正文生成。是否继续？', testId: 'leave-guard' });
  }, []);

  const confirmEditorLeave = useCallback(async () => {
    const snapshot = editorSnapshotRef.current;
    if (!snapshot.isDirty || snapshot.chapterId !== activeChapterIdRef.current) return true;

    const saveFirst = await confirmInfo({
      title: '正文尚未保存',
      message: '当前正文存在未保存修改。\n\n选择“确定”将先保存草稿再继续；选择“取消”可进一步选择放弃修改或留在当前章节。',
      testId: 'leave-guard',
    });
    if (saveFirst) {
      const saved = await editorRef.current?.save();
      if (!saved) {
        await showError({ title: '无法离开当前章节', message: '正文保存失败，已保留当前编辑内容。', testId: 'error-notice' });
        return false;
      }
      return true;
    }

    return await confirmDanger({
      title: '放弃未保存正文',
      message: '确认放弃当前未保存正文并继续吗？该操作无法恢复。选择“取消”将留在当前章节。',
      testId: 'leave-guard',
    });
  }, []);

  const confirmWorkspaceLeave = useCallback(async () => {
    if (!(await confirmDiscardChapterGoal())) return false;
    if (!(await confirmEditorLeave())) return false;
    setChapterGoalDirty(false);
    chapterGoalDirtyRef.current = false;
    return true;
  }, [confirmDiscardChapterGoal, confirmEditorLeave]);

  const handleSelectChapter = useCallback(async (chapterId: string) => {
    if (chapterId === activeChapterIdRef.current) {
      if (chapterDocumentLoad.status !== 'ready'
        && chapterDocumentLoad.chapterId !== chapterId) {
        documentLoadGuardRef.current.invalidate();
        chapterDocumentBlockedRef.current = false;
        setChapterDocumentLoad({ status: 'ready', chapterId });
      }
      return;
    }
    if (!(await confirmWorkspaceLeave())) return;
    setChapterGoalDirty(false);
    // v1.0.44: 切换章节时不再强制关闭面板，面板会通过 props 更新感知新章节
    void loadChapterDraft(chapterId, true);
  }, [chapterDocumentLoad, confirmWorkspaceLeave, loadChapterDraft]);

  const retryChapterDraftLoad = useCallback(() => {
    if (chapterDocumentLoad.status !== 'error') return;
    void loadChapterDraft(
      chapterDocumentLoad.chapterId,
      chapterDocumentLoad.chapterId !== activeChapterIdRef.current,
    );
  }, [chapterDocumentLoad, loadChapterDraft]);

  const handleTogglePanel = useCallback(async (panel: PanelType) => {
    if (activePanel === 'outline' && !(await confirmDiscardChapterGoal())) return;
    if (activePanel === 'outline') setChapterGoalDirty(false);
    setSidebarState((prev) => switchTool(prev, panel));
  }, [activePanel, confirmDiscardChapterGoal]);

  const handleClosePanel = useCallback(async () => {
    if (!(await confirmDiscardChapterGoal())) return;
    setChapterGoalDirty(false);
    setSidebarState((prev) => closePanel(prev));
  }, [confirmDiscardChapterGoal]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClosePanel(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClosePanel]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!editorSnapshotRef.current.isDirty && !chapterGoalDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [chapterGoalDirty]);

  const handleEditorClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (
      target?.closest('button, a, input, textarea, select, [role="button"], .editor-toolbar, .workspace-topbar')
    ) {
      return;
    }
    handleClosePanel();
  }, [handleClosePanel]);

  const handleDraftChange = useCallback((wordCount: number, dirty: boolean) => {
    setDraftWordCount(wordCount);
    setIsDirty(dirty);
  }, []);

  const handleEditorContentChange = useCallback((snapshot: EditorContentSnapshot) => {
    editorSnapshotRef.current = snapshot;
    setEditorSnapshot(snapshot);
    setDraftWordCount(snapshot.wordCount);
    setIsDirty(snapshot.isDirty);
  }, []);

  const handleDraftApplied = useCallback((draft: ChapterDraft, metadata?: DraftResultMetadata) => {
    if (chapterDocumentBlockedRef.current) {
      void showError({
        title: '完整正文尚未载入',
        message: CHAPTER_DOCUMENT_LOAD_ERROR,
        testId: 'error-notice',
      });
      return false;
    }
    const liveTarget = {
      novelId: activeNovelIdRef.current,
      chapterId: activeChapterIdRef.current,
    };
    const draftDecision = validateDraftDocumentTarget(draft, liveTarget);
    if (!draftDecision.ok) {
      if (metadata) {
        void showInfo({
          title: 'AI 候选已保存到原章节',
          message: `${draftDecision.message}\n当前编辑器未被切换。`,
        });
      }
      return false;
    }
    if (metadata) {
      if (metadata.resultId !== draft.id) {
        void showInfo({
          title: 'AI 候选已保存',
          message: '结果标识与草稿不一致，当前编辑器未被切换。',
        });
        return false;
      }
      if (editorSnapshotRef.current.isDirty
        && hashTextContent(draft.content) !== editorSnapshotRef.current.contentHash) {
        void showInfo({
          title: 'AI 候选已保存',
          message: '当前正文存在未保存修改，候选结果仍可在草稿历史中查看，编辑器内容未被覆盖。',
        });
        return false;
      }
      const applicationDecision = validateDocumentApplication({
        resultId: metadata.resultId,
        target: { novelId: metadata.novelId, chapterId: metadata.chapterId },
        baseContentHash: metadata.baseContentHash,
        mode: 'replace_all',
      }, {
        ...liveTarget,
        contentHash: editorSnapshotRef.current.contentHash,
      });
      if (!applicationDecision.ok) {
        void showInfo({
          title: 'AI 候选已保存',
          message: `${applicationDecision.message}\n结果仍可在原章节草稿历史中查看，当前正文未被覆盖。`,
        });
        return false;
      }
      const liveDraft = currentDraftRef.current;
      if (metadata.sourceDraftId && liveDraft?.id !== metadata.sourceDraftId) {
        void showInfo({
          title: 'AI 候选已保存',
          message: '基础草稿已切换，结果仍可在原章节草稿历史中查看，当前正文未被覆盖。',
        });
        return false;
      }
      if (metadata.sourceRevision !== undefined && liveDraft?.versionNo !== metadata.sourceRevision) {
        void showInfo({
          title: 'AI 候选已保存',
          message: '基础草稿版本已变化，结果仍可在原章节草稿历史中查看，当前正文未被覆盖。',
        });
        return false;
      }
    }
    setCurrentDraft(draft);
    currentDraftRef.current = draft;
    setDraftWordCount(draft.wordCount);
    setIsDirty(false);
    const nextSnapshot: EditorContentSnapshot = {
      chapterId: draft.chapterId,
      draftId: draft.id,
      draftVersion: draft.versionNo,
      content: draft.content,
      wordCount: draft.wordCount,
      isDirty: false,
      contentHash: hashTextContent(draft.content),
    };
    editorSnapshotRef.current = nextSnapshot;
    setEditorSnapshot(nextSnapshot);
    return true;
  }, []);

  const applyAiTextToEditor = useCallback(async (payload: AiTextApplyPayload) => {
    if (chapterDocumentBlockedRef.current) {
      await showError({ title: '无法应用 AI 输出', message: CHAPTER_DOCUMENT_LOAD_ERROR, testId: 'error-notice' });
      return false;
    }
    const text = payload.text.trim();
    if (!text) return false;
    const liveTarget = {
      novelId: activeNovelIdRef.current,
      chapterId: activeChapterIdRef.current,
      contentHash: editorSnapshotRef.current.contentHash,
    };
    const identity = {
      resultId: payload.resultId,
      target: { novelId: payload.novelId, chapterId: payload.chapterId },
      baseContentHash: payload.baseContentHash,
      mode: payload.mode,
    } as const;
    const decision = validateDocumentApplication(identity, liveTarget);
    if (!decision.ok) {
      await showError({ title: '无法应用 AI 输出', message: decision.message, testId: 'error-notice' });
      return false;
    }
    const liveDraft = currentDraftRef.current;
    if (payload.sourceDraftId && liveDraft?.id !== payload.sourceDraftId) {
      await showError({ title: '无法应用 AI 输出', message: '基础草稿已切换，请重新生成结果。', testId: 'error-notice' });
      return false;
    }
    if (payload.sourceRevision !== undefined && liveDraft?.versionNo !== payload.sourceRevision) {
      await showError({ title: '无法应用 AI 输出', message: '基础草稿版本已变化，请重新生成结果。', testId: 'error-notice' });
      return false;
    }
    if (payload.mode === 'replace_all') {
      const ok = await confirmInfo({
        title: '应用 AI 输出',
        message: `${editorSnapshotRef.current.isDirty ? '当前正文存在未保存修改。\n\n' : ''}将用 AI 输出替换当前正文，是否继续？`,
        testId: 'apply-confirm',
      });
      if (!ok) return false;
    }
    const claim = applyIdempotencyGuardRef.current.claim(identity);
    if (!claim.accepted) {
      await showInfo({ title: '结果已应用', message: '同一 AI 结果已经应用到这个正文版本，已阻止重复操作。' });
      return false;
    }
    const request: AiTextApplyRequest = {
      ...payload,
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      text,
    };
    pendingApplyKeysRef.current.set(request.id, payload);
    setApplyTextRequest(request);
    return true;
  }, []);

  const handleApplyTextConsumed = useCallback((request: AiTextApplyRequest) => {
    pendingApplyKeysRef.current.delete(request.id);
  }, []);

  const handleApplyTextRejected = useCallback((request: AiTextApplyRequest, reason: string) => {
    const payload = pendingApplyKeysRef.current.get(request.id);
    if (payload) {
      applyIdempotencyGuardRef.current.release({
        resultId: payload.resultId,
        target: { novelId: payload.novelId, chapterId: payload.chapterId },
        baseContentHash: payload.baseContentHash,
        mode: payload.mode,
      });
    }
    pendingApplyKeysRef.current.delete(request.id);
    void showError({ title: 'AI 输出未应用', message: reason, testId: 'error-notice' });
  }, []);

  const runEditorCommand = useCallback((type: EditorCommandType) => {
    if (chapterDocumentBlockedRef.current) return;
    setEditorCommandRequest({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!activeChapterId) {
      setSummaryExists(false);
      return undefined;
    }

    void chapterSummaryService.getByChapterId(activeChapterId).then(
      (existing) => {
        if (!cancelled) setSummaryExists(!!existing);
      },
      (error: unknown) => {
        console.error('[WritingWorkspace] failed to read chapter summary state', error);
        if (!cancelled) {
          setSummaryExists(false);
          void showError({
            title: '章节上下文读取失败',
            message: error instanceof Error ? error.message : '无法读取当前章节的上下文状态。',
            testId: 'error-notice',
          });
        }
      },
    );

    return () => { cancelled = true; };
  }, [activeChapterId]);

  const handleGenerateSummary = useCallback(async () => {
    if (!novelId || !activeChapter || !currentDraft) return;
    if (!currentDraft.isAdopted) {
      alert('请先在草稿历史中确认采用一个正文草稿，再生成章节总结。');
      return;
    }
    setSummaryLoading(true); setSummaryError('');
    try {
      const result = await chapterSummarizeService.summarize({
        novelId, chapterId: activeChapter.id, adoptedDraftId: currentDraft.id,
        chapterTitle: activeChapter.title, chapterOutline: activeChapter.outline,
        adoptedContent: currentDraft.content.slice(0, 3000),
      });
      setSummaryResult(result);
      setSummaryDialogOpen(true);
    } catch (e: any) { setSummaryError(e.message || '总结生成失败'); }
    finally { setSummaryLoading(false); }
  }, [novelId, activeChapter, currentDraft]);

  const handleSaveSummary = useCallback(async (edited: ChapterSummarizeResult) => {
    if (!novelId || !activeChapter || !currentDraft) return;
    try {
      const contentHash = hashTextContent(currentDraft.content);
      await chapterContextPersistenceService.save({
        novelId,
        chapterId: activeChapter.id,
        adoptedDraftId: currentDraft.id,
        summary: {
          novelId,
          chapterId: activeChapter.id,
          volumeId: activeChapter.volumeId,
          adoptedDraftId: currentDraft.id,
          summary: edited.summary,
          keyEvents: edited.keyEvents,
          characterChanges: edited.characterChanges as any,
          relationshipChanges: edited.relationshipChanges as any,
          newForeshadows: edited.newForeshadows,
          resolvedForeshadows: edited.resolvedForeshadows,
          nextChapterHints: edited.nextChapterHints,
          coreEvents: edited.coreEvents,
          protagonistStateChange: edited.protagonistStateChange,
          importantCharacterChanges: edited.importantCharacterChanges,
          settingChanges: edited.settingChanges,
          newLocations: edited.newLocations,
          newItemsOrAbilities: edited.newItemsOrAbilities,
          foreshadowing: edited.foreshadowing,
          unresolvedQuestions: edited.unresolvedQuestions,
          factsMustRemember: edited.factsMustRemember,
          nextChapterHook: edited.nextChapterHook,
          contentHash,
          draftVersion: currentDraft.versionNo,
        },
        contextRecords: edited.contextRecords.map((record) => ({
          ...record,
          novelId,
          chapterId: activeChapter.id,
          volumeId: activeChapter.volumeId,
          contentHash,
          draftVersion: currentDraft.versionNo,
        })),
        characterStates: edited.characterChanges.flatMap((change) => (
          change.characterId ? [{
            novelId, characterId: change.characterId, chapterId: activeChapter.id,
            stateSummary: change.stateSummary,
            relationshipChanges: change.relationshipChanges,
            goalChanges: change.goalChanges,
            location: change.location,
            healthState: change.healthState,
            knowledgeState: change.knowledgeState,
          }] : []
        )),
      });
      setChapters((prev) => prev.map((c) => c.id === activeChapter.id ? { ...c, status: 'summarized' } : c));
      bumpContextVersion();
      setSummaryDialogOpen(false);
      setSummaryExists(true);
      setSummaryResult(null);
    } catch (e: any) {
      setSummaryError(e.message || '保存失败');
    }
  }, [novelId, activeChapter, currentDraft, bumpContextVersion]);

  const handleRegenerateSummary = useCallback(async () => {
    setSummaryError('');
    await handleGenerateSummary();
  }, [handleGenerateSummary]);

  // v1.0.34 章节大纲应用回调：刷新父组件的章节状态
  const handleChapterOutlineApplied = useCallback(async (chapterId: string) => {
    if (!chapterId) return;
    try {
      const updated = await chapterRepository.getById(chapterId);
      if (updated) {
        setChapters((prev) => prev.map((c) => (c.id === chapterId ? updated : c)));
      }
    } catch {
      // 刷新失败时静默处理，不影响用户操作
    }
  }, []);

  // v1.0.19 工作台内创建分卷和章节（统一走父组件单一数据源）
  const [creating, setCreating] = useState(false);

  const handleCreateFirstChapter = useCallback(async (chapterTitle?: string) => {
    if (!novelId || creating) {
      console.warn('[Workspace] createFirstChapter skip: novelId=', novelId, 'creating=', creating);
      return;
    }
    console.info('[Workspace] createFirstChapter start, novelId=', novelId);
    setCreating(true);
    try {
      // 统一服务：创建 volume + chapter + draft + 每步反查
      const result = await createFirstVolumeAndChapter(novelId, {
        chapterTitle: chapterTitle?.trim() || '第1章',
      });
      console.info('[Workspace] createFirstChapter done, chapterId=', result.chapter.id);

      // 直接设置 state（无需 refreshKey）
      const volsAfter = await volumeRepository.getByNovelId(novelId);
      const chsAfter = await chapterRepository.getByNovelId(novelId);
      setVolumes(volsAfter);
      setChapters(chsAfter);
      commitActiveChapter(result.chapter.id);
      setLoadState('ready');
      setCurrentDraft(result.draft);
      currentDraftRef.current = result.draft;
      chapterDocumentBlockedRef.current = false;
      setChapterDocumentLoad({ status: 'ready', chapterId: result.chapter.id });
      setDraftWordCount(0);
      setIsDirty(false);
      console.info('[Workspace] UI updated: volumes=', volsAfter.length, 'chapters=', chsAfter.length);
    } catch (e: any) {
      console.error('[Workspace] createFirstChapter error:', e);
      alert('创建失败：' + (e?.message || '未知错误'));
    } finally {
      setCreating(false);
    }
  }, [novelId, creating, commitActiveChapter]);

  // v1.0.19 VolumeTree 回调：创建分卷（父组件执行写入+重载）
  const handleCreateVolume = useCallback(async (title: string) => {
    if (!novelId) throw new Error('novelId 缺失');
    console.info('[Workspace] handleCreateVolume, title=', title);
    await createVolumeForNovel(novelId, title);
    setVolumes(await volumeRepository.getByNovelId(novelId));
  }, [novelId]);

  // v1.0.20 VolumeTree 回调：创建章节（统一服务 + 反查 + 刷新）
  const handleCreateChapter = useCallback(async (volumeId: string, title: string) => {
    if (!novelId) throw new Error('novelId 缺失');
    if (!(await confirmWorkspaceLeave())) return;
    const guardedChapterId = activeChapterIdRef.current;
    const guardedSnapshot = { ...editorSnapshotRef.current };
    console.info('[Workspace] handleCreateChapter, volumeId=', volumeId, 'title=', title);
    const result = volumeId
      ? await createChapterInVolume(novelId, volumeId, title)
      : await createFirstVolumeAndChapter(novelId, { chapterTitle: title });
    // 重载并选中新章节
    setVolumes(await volumeRepository.getByNovelId(novelId));
    setChapters(await chapterRepository.getByNovelId(novelId));
    if (activeChapterIdRef.current !== guardedChapterId) return;
    const liveSnapshot = editorSnapshotRef.current;
    const editorChangedSinceGuard = liveSnapshot.chapterId !== guardedSnapshot.chapterId
      || liveSnapshot.draftId !== guardedSnapshot.draftId
      || liveSnapshot.draftVersion !== guardedSnapshot.draftVersion
      || liveSnapshot.contentHash !== guardedSnapshot.contentHash
      || liveSnapshot.isDirty !== guardedSnapshot.isDirty;
    if ((editorChangedSinceGuard || chapterGoalDirtyRef.current) && !(await confirmWorkspaceLeave())) return;
    commitActiveChapter(result.chapter.id);
    setLoadState('ready');
    setCurrentDraft(result.draft);
    currentDraftRef.current = result.draft;
    chapterDocumentBlockedRef.current = false;
    setChapterDocumentLoad({ status: 'ready', chapterId: result.chapter.id });
    setDraftWordCount(0);
    setIsDirty(false);
    console.info('[Workspace] handleCreateChapter done, chapterId=', result.chapter.id);
  }, [novelId, commitActiveChapter, confirmWorkspaceLeave]);

  return (
    <div
      className={`workspace-page${!isChapterDocumentBlocked && activePanel && activePanel !== 'draft-history' ? ' has-right-panel' : ''}`}
      data-summary-exists={summaryExists ? 'true' : 'false'}
    >
      {pageLoading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg-app)', zIndex: 10 }}>
          <div style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
            <div>正在加载写作工作台...</div>
          </div>
        </div>
      )}
      {pageError && !pageLoading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg-app)', zIndex: 10 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>❌</div>
            <div style={{ color: 'var(--color-error)', marginBottom: 12 }}>{pageError}</div>
            <button className="btn btn-primary btn-sm" onClick={() => navigate(`/novels/${novelId}`)}>← 返回作品详情</button>
          </div>
        </div>
      )}

      {/* 作品未找到状态 */}
      {loadState === 'novel_not_found' && !pageLoading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg-app)', zIndex: 10 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>📖</div>
            <div style={{ color: 'var(--color-text-muted)', marginBottom: 12 }}>作品不存在或本地数据已损坏</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button className="btn btn-primary btn-sm" onClick={() => navigate('/')}>← 返回首页</button>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate('/settings')}>🔧 修复本地数据</button>
            </div>
          </div>
        </div>
      )}

      {/* 左侧卷章目录树 */}
      <div className="workspace-sidebar">
        {/* 顶部导航区 */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border-light)' }}>
          <BackButton
            label="返回作品详情"
            to={`/novels/${novelId}`}
            onBeforeBack={confirmWorkspaceLeave}
          />
        </div>
        {novel && (
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border-light)', fontSize: 13, fontWeight: 500 }}>
            📖 {novel.title}
          </div>
        )}
        {novelId && (
          <VolumeTree
            volumes={volumes}
            chapters={chapters}
            activeChapterId={activeChapterId}
            loading={pageLoading}
            onSelectChapter={handleSelectChapter}
            onCreateVolume={handleCreateVolume}
            onCreateChapter={handleCreateChapter}
            onCreateFirstChapter={handleCreateFirstChapter}
          />
        )}
      </div>

      {/* 中间正文编辑区 */}
      <div className="workspace-editor" onClick={handleEditorClick}>

        {/* v1.7.19 全局 AI 任务弹窗 */}
        <GlobalAiTaskModal state={aiModal} />
        {/* 顶部信息栏 */}
        <div className="workspace-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BackButton
              label="返回作品"
              to={`/novels/${novelId}`}
              onBeforeBack={confirmWorkspaceLeave}
            />
            <span style={{ fontWeight: 600, fontSize: 14 }}>{novel?.title || '未选择作品'}</span>
          </div>
          {activeChapter && (
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              当前：第{activeChapter.chapterNumber}章 {activeChapter.title}
            </div>
          )}
          <div className="workspace-topbar-spacer" aria-hidden="true" />
        </div>

        {loadState === 'ready' && chapters.length === 0 && !pageLoading ? (
          <div
            data-testid="workspace-empty-state"
            style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg-app)' }}
          >
            <div style={{ textAlign: 'center', maxWidth: 420 }}>
              <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>📝</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>当前作品还没有章节</div>
              <div style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
                你可以在左侧目录先创建分卷，再创建第一章。
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/novels/${novelId}`)}>
                ← 返回作品详情
              </button>
            </div>
          </div>
        ) : (
          <>
            {chapterDocumentLoad.status === 'error' && (
              <div
                data-testid="error-notice"
                data-chapter-id={chapterDocumentLoad.chapterId}
                role="alert"
                style={{
                  margin: '10px 16px 0', padding: '10px 12px', display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between', gap: 12, color: 'var(--color-error)',
                  background: 'var(--color-bg-hover)', border: '1px solid var(--color-error)', borderRadius: 6,
                  fontSize: 13,
                }}
              >
                <span>{chapterDocumentLoad.message}</span>
                <button
                  className="btn btn-secondary btn-sm"
                  data-testid="chapter-load-retry"
                  onClick={retryChapterDraftLoad}
                >
                  重试
                </button>
              </div>
            )}
            <EditorArea
              ref={editorRef}
              chapter={activeChapter}
              novelTitle={novel?.title}
              novelId={novelId}
              currentDraft={activeDraft}
              documentState={isChapterDocumentBlocked ? chapterDocumentLoad.status : 'ready'}
              onDraftChange={handleDraftChange}
              onEditorContentChange={handleEditorContentChange}
              onDraftSaved={handleDraftApplied}
              applyTextRequest={applyTextRequest}
              onApplyTextConsumed={handleApplyTextConsumed}
              onApplyTextRejected={handleApplyTextRejected}
              commandRequest={editorCommandRequest}
              onChapterUpdated={handleChapterOutlineApplied}
              locateTarget={locateTarget}
              onLocateDone={handleLocateDone}
            />
            <StatusBar
              chapter={activeChapter}
              draftWordCount={draftWordCount}
              isDirty={isDirty}
              draftVersion={activeDraft ? `v${activeDraft.versionNo}` : 'v0 占位'}
            />
          </>
        )}
      </div>

      {/* 右侧工具栏 */}
      {!isChapterDocumentBlocked && (
        <RightToolbar activePanel={activePanel} onTogglePanel={handleTogglePanel} onRunCommand={runEditorCommand} />
      )}

      {/* 草稿历史面板 */}
      {!isChapterDocumentBlocked && activePanel === 'draft-history' && (
        <DraftHistoryPanel
          chapterId={activeChapterId}
          currentDraftId={activeDraft?.id}
          onBeforeDocumentChange={confirmEditorLeave}
          onLoadDraft={(draft) => { handleDraftApplied(draft); setSidebarState((prev) => closePanel(prev)); }}
          onDraftAdopted={(draft) => {
            handleDraftApplied(draft);
            void handleChapterOutlineApplied(draft.chapterId);
          }}
          onClose={handleClosePanel}
        />
      )}

      {/* 右侧弹出面板 */}
      {!isChapterDocumentBlocked && <RightPanel
        panelType={activePanel === 'draft-history' ? null : activePanel}
        onClose={handleClosePanel}
        novelId={novelId}
        chapter={activeChapter}
        onGenerated={handleDraftApplied}
        onAdopted={() => {
          const chapterId = activeChapterIdRef.current;
          if (!chapterId) return;
          if (editorSnapshotRef.current.chapterId === chapterId && editorSnapshotRef.current.isDirty) {
            void showInfo({
              title: '正文已在原章节采用',
              message: '采用期间编辑器已有新修改，已保留未保存内容，未自动重载正文。',
            });
            return;
          }
          loadChapterDraft(chapterId);
        }}
        onBeforeDocumentChange={confirmEditorLeave}
        onChapterOutlineApplied={handleChapterOutlineApplied}
        onChapterGoalDirtyChange={setChapterGoalDirty}
        onChapterCharactersChanged={bumpContextVersion}
        contextVersion={contextVersion}
        onLocateText={handleLocateText}
        // v1.7.19 质量检查状态
        qcReport={activeQcReport}
        qcItems={activeQcItems}
        onQcChange={(report: any, items: any[]) => { setQcReport(report); setQcItems(items); }}
        currentEditorContent={editorSnapshot.chapterId === activeChapterId ? editorSnapshot.content : activeDraft?.content || ''}
        currentEditorWordCount={editorSnapshot.chapterId === activeChapterId ? editorSnapshot.wordCount : activeDraft?.wordCount || 0}
        currentEditorDirty={editorSnapshot.chapterId === activeChapterId ? editorSnapshot.isDirty : false}
        currentContentHash={editorSnapshot.chapterId === activeChapterId ? editorSnapshot.contentHash : hashTextContent(activeDraft?.content || '')}
        currentDraftId={activeDraft?.id}
        currentDraftVersion={activeDraft?.versionNo}
        onApplyAiText={applyAiTextToEditor}
        // v1.7.19 全局 AI 弹窗
        showAiModal={showAiModal}
        updateAiModal={updateAiModal}
        hideAiModal={hideAiModal}
        // v1.0.45 统一上下文 + 侧栏状态
        writingContext={writingContext}
        sidebarState={sidebarState}
        onUpdateToolState={(toolKey: string, patch: Partial<PanelToolState>) => {
          setSidebarState((prev) => updateToolState(prev, toolKey, patch));
        }}
      />}

      {/* v0.8.0 章节总结确认弹窗 */}
      {summaryDialogOpen && summaryResult && (
        <ChapterSummaryDialog
          result={summaryResult}
          chapterTitle={activeChapter?.title || ''}
          loading={summaryLoading}
          error={summaryError}
          onClose={() => { setSummaryDialogOpen(false); setSummaryResult(null); setSummaryError(''); }}
          onConfirm={handleSaveSummary}
          onRegenerate={handleRegenerateSummary}
        />
      )}

      {/* 总结生成中的遮罩（无结果时） */}
      {summaryLoading && !summaryResult && (
        <>
          <div className="right-panel-overlay" onClick={() => setSummaryLoading(false)} />
          <div className="right-panel" style={{ width: 360, zIndex: 200 }}>
            <div className="right-panel-header">
              <span className="right-panel-title">⏳ 生成章节总结</span>
            </div>
            <div className="right-panel-body">
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                AI 正在分析已采用正文，提取关键信息……
              </div>
            </div>
          </div>
        </>
      )}

      {/* 总结错误提示 */}
      {summaryError && !summaryDialogOpen && (
        <>
          <div className="right-panel-overlay" onClick={() => setSummaryError('')} />
          <div className="right-panel" style={{ width: 360, zIndex: 200 }}>
            <div className="right-panel-header">
              <span className="right-panel-title">❌ 总结失败</span>
              <button className="right-panel-close" onClick={() => setSummaryError('')}>✕</button>
            </div>
            <div className="right-panel-body">
              <div style={{ padding: 16, color: 'var(--color-error)', fontSize: 13 }}>{summaryError}</div>
              <div style={{ padding: '0 16px 16px' }}>
                <button className="btn btn-primary btn-sm" onClick={handleRegenerateSummary}>🔄 重试</button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default WritingWorkspacePage;
