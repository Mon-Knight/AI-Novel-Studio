import { useState, useCallback, useEffect, type MouseEvent } from 'react';
import { confirmInfo } from '../../utils/nativeDialog';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import BackButton from '../../components/common/BackButton';
import VolumeTree from '../../components/workspace/VolumeTree';
import EditorArea, {
  type AiTextApplyMode,
  type AiTextApplyRequest,
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
import { contextRecordService } from '../../services/context/contextRecordService';
import { characterStateService } from '../../services/context/characterStateService';
import type { Novel } from '../../types/novel';
import type { Chapter } from '../../types/chapter';
import type { Volume } from '../../types/volume';
import type { ChapterDraft } from '../../types/ai';
import type { ChapterSummarizeResult } from '../../types/chapterSummary';
import { hashTextContent } from '../../utils/contentHash';
import '../../styles/workspace.css';
import '../../styles/right-dock.css';

export type PanelType =
  | 'ai-generate' | 'engineering' | 'outline' | 'characters' | 'events'
  | 'setting' | 'style' | 'check' | 'polish'
  | 'draft-history' | 'chapter-summary' | 'context-view' | null;

const NOVEL_LOAD_RETRY_DELAYS_MS = [120, 240, 480];

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
  const [activePanel, setActivePanel] = useState<PanelType>(null);
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
  const activeQcReport = qcReport?.chapterId === activeChapterId ? qcReport : null;
  const activeQcItems = activeQcReport ? qcItems.filter((item) => item.chapterId === activeChapterId) : [];

  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState('');

  // 工作台加载状态机
  type WorkspaceLoadState = 'loading' | 'ready' | 'novel_not_found' | 'error';
  const [loadState, setLoadState] = useState<WorkspaceLoadState>('loading');

  const loadChapterDraft = useCallback(async (chapterId: string) => {
    try {
      const draft = await draftVersionService.getLatestByChapterId(chapterId);
      setCurrentDraft(draft);
      setDraftWordCount(draft?.wordCount || 0);
      setIsDirty(false);
    } catch { /* 草稿加载失败不影响页面 */ }
  }, []);

  // v1.0.19 工作台单一数据源：统一从 service 重新读取所有数据
  const reloadWorkspaceData = useCallback(async (selectChapterId?: string) => {
    if (!novelId) return;
    console.info('[Workspace] reloadWorkspaceData start, novelId=', novelId);
    const [v, c] = await Promise.all([
      volumeRepository.getByNovelId(novelId),
      chapterRepository.getByNovelId(novelId),
    ]);
    setVolumes(v);
    setChapters(c);
    console.info('[Workspace] reloadWorkspaceData done, volumes=', v.length, 'chapters=', c.length);

    // 解析当前章节
    const resolvedChapterId = selectChapterId
      || (activeChapterId && c.find((ch) => ch.id === activeChapterId) ? activeChapterId : '')
      || c[0]?.id
      || '';
    if (resolvedChapterId) {
      setActiveChapterId(resolvedChapterId);
      setLoadState('ready');
      loadChapterDraft(resolvedChapterId);
    } else if (c.length === 0) {
      setLoadState('ready');
      setCurrentDraft(null);
      setDraftWordCount(0);
    }
  }, [novelId, activeChapterId, loadChapterDraft]);

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
          setActiveChapterId(targetId);
          loadChapterDraft(targetId);
        }
      }
      setLoadState('ready');
      setPageLoading(false);
    });

    return () => { cancelled = true; };
  }, [novelId, searchParams, loadChapterDraft]);

  const confirmDiscardChapterGoal = useCallback(async () => {
    if (!chapterGoalDirty) return true;
    return await confirmInfo({ title: '未保存修改', message: '本章目标有未保存修改，切换后这些修改不会进入正文生成。是否继续？' });
  }, [chapterGoalDirty]);

  const handleSelectChapter = useCallback(async (chapterId: string) => {
    if (!(await confirmDiscardChapterGoal())) return;
    setChapterGoalDirty(false);
    setActiveChapterId(chapterId);
    // v1.0.44: 切换章节时不再强制关闭面板，面板会通过 props 更新感知新章节
    loadChapterDraft(chapterId);
  }, [confirmDiscardChapterGoal, loadChapterDraft]);

  const handleTogglePanel = useCallback(async (panel: PanelType) => {
    if (activePanel === 'outline' && !(await confirmDiscardChapterGoal())) return;
    if (activePanel === 'outline') setChapterGoalDirty(false);
    setActivePanel((prev) => (prev === panel ? null : panel));
  }, [activePanel, confirmDiscardChapterGoal]);

  const handleClosePanel = useCallback(async () => {
    if (!(await confirmDiscardChapterGoal())) return;
    setChapterGoalDirty(false);
    setActivePanel(null);
  }, [confirmDiscardChapterGoal]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClosePanel(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClosePanel]);

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
    setEditorSnapshot(snapshot);
    setDraftWordCount(snapshot.wordCount);
    setIsDirty(snapshot.isDirty);
  }, []);

  const handleDraftApplied = useCallback((draft: ChapterDraft) => {
    setCurrentDraft(draft);
    setDraftWordCount(draft.wordCount);
    setIsDirty(false);
    setEditorSnapshot({
      chapterId: draft.chapterId,
      draftId: draft.id,
      draftVersion: draft.versionNo,
      content: draft.content,
      wordCount: draft.wordCount,
      isDirty: false,
      contentHash: hashTextContent(draft.content),
    });
  }, []);

  const applyAiTextToEditor = useCallback(async (payload: {
    mode: AiTextApplyMode;
    text: string;
    source: AiTextApplyRequest['source'];
  }) => {
    const text = payload.text.trim();
    if (!text) return false;
    if (payload.mode === 'replace_all') {
      const ok = await confirmInfo({
        title: '应用 AI 输出',
        message: `${editorSnapshot.isDirty ? '当前正文存在未保存修改，建议先保存草稿。\n\n' : ''}将用 AI 输出替换当前正文，是否继续？`,
      });
      if (!ok) return false;
    }
    setApplyTextRequest({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      mode: payload.mode,
      text,
      source: payload.source,
    });
    return true;
  }, [editorSnapshot.isDirty]);

  const runEditorCommand = useCallback((type: EditorCommandType) => {
    setEditorCommandRequest({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type,
    });
  }, []);

  // v0.8.0 章节总结相关处理
  const checkSummaryExists = useCallback(async (chapterId: string) => {
    if (!chapterId) return;
    const existing = await chapterSummaryService.getByChapterId(chapterId);
    setSummaryExists(!!existing);
  }, []);

  useEffect(() => {
    if (activeChapterId) checkSummaryExists(activeChapterId);
  }, [activeChapterId, checkSummaryExists]);

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
      // 保存章节总结
      await chapterSummaryService.create({
        novelId, chapterId: activeChapter.id, adoptedDraftId: currentDraft.id,
        summary: edited.summary, keyEvents: edited.keyEvents,
        characterChanges: edited.characterChanges as any,
        relationshipChanges: edited.relationshipChanges as any,
        newForeshadows: edited.newForeshadows,
        resolvedForeshadows: edited.resolvedForeshadows,
        nextChapterHints: edited.nextChapterHints,
      });
      // 保存上下文记录
      for (const cr of edited.contextRecords) {
        await contextRecordService.create({ ...cr, novelId, chapterId: activeChapter.id });
      }
      // 保存角色状态
      for (const cc of edited.characterChanges) {
        if (cc.characterId) {
          await characterStateService.create({
            novelId, characterId: cc.characterId, chapterId: activeChapter.id,
            stateSummary: cc.stateSummary, relationshipChanges: cc.relationshipChanges,
            goalChanges: cc.goalChanges, location: cc.location,
            healthState: cc.healthState, knowledgeState: cc.knowledgeState,
          });
        }
      }
      // 更新章节状态为 summarized
      await chapterRepository.update(activeChapter.id, { status: 'summarized' });
      setChapters((prev) => prev.map((c) => c.id === activeChapter.id ? { ...c, status: 'summarized' } : c));
      setSummaryDialogOpen(false);
      setSummaryExists(true);
      setSummaryResult(null);
    } catch (e: any) {
      setSummaryError(e.message || '保存失败');
    }
  }, [novelId, activeChapter, currentDraft]);

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
      setActiveChapterId(result.chapter.id);
      setLoadState('ready');
      setCurrentDraft(result.draft);
      setDraftWordCount(0);
      setIsDirty(false);
      console.info('[Workspace] UI updated: volumes=', volsAfter.length, 'chapters=', chsAfter.length);
    } catch (e: any) {
      console.error('[Workspace] createFirstChapter error:', e);
      alert('创建失败：' + (e?.message || '未知错误'));
    } finally {
      setCreating(false);
    }
  }, [novelId, creating]);

  // v1.0.19 VolumeTree 回调：创建分卷（父组件执行写入+重载）
  const handleCreateVolume = useCallback(async (title: string) => {
    if (!novelId) throw new Error('novelId 缺失');
    console.info('[Workspace] handleCreateVolume, title=', title);
    await createVolumeForNovel(novelId, title);
    await reloadWorkspaceData();
  }, [novelId, reloadWorkspaceData]);

  // v1.0.20 VolumeTree 回调：创建章节（统一服务 + 反查 + 刷新）
  const handleCreateChapter = useCallback(async (volumeId: string, title: string) => {
    if (!novelId) throw new Error('novelId 缺失');
    console.info('[Workspace] handleCreateChapter, volumeId=', volumeId, 'title=', title);
    const result = volumeId
      ? await createChapterInVolume(novelId, volumeId, title)
      : await createFirstVolumeAndChapter(novelId, { chapterTitle: title });
    // 重载并选中新章节
    setVolumes(await volumeRepository.getByNovelId(novelId));
    setChapters(await chapterRepository.getByNovelId(novelId));
    setActiveChapterId(result.chapter.id);
    setLoadState('ready');
    setCurrentDraft(result.draft);
    setDraftWordCount(0);
    setIsDirty(false);
    console.info('[Workspace] handleCreateChapter done, chapterId=', result.chapter.id);
  }, [novelId]);

  return (
    <div
      className={`workspace-page${activePanel && activePanel !== 'draft-history' ? ' has-right-panel' : ''}`}
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

      {/* 无章节空状态 */}
      {loadState === 'ready' && chapters.length === 0 && !pageLoading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg-app)', zIndex: 10 }}>
          <div style={{ textAlign: 'center', maxWidth: 420 }}>
            <div style={{ fontSize: 48, marginBottom: 16, opacity: 0.3 }}>📝</div>
            <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>当前作品还没有章节</div>
            <div style={{ fontSize: 14, color: 'var(--color-text-muted)', marginBottom: 20, lineHeight: 1.6 }}>
              你可以直接在工作台创建第一卷和第一章，开始写作。
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" onClick={() => handleCreateFirstChapter()} disabled={creating}>
                {creating ? '⏳ 创建中...' : '📖 创建第一卷并新建第一章'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/novels/${novelId}`)}>
                ← 返回作品详情
              </button>
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
            onBeforeBack={async () => {
              if (chapterGoalDirty) return await confirmInfo({ title: '未保存修改', message: '本章目标有未保存修改，直接返回会丢失这些修改。是否继续？' });
              if (isDirty) return await confirmInfo({ title: '未保存修改', message: '当前正文有未保存修改，直接返回可能丢失修改。是否继续？' });
              return true;
            }}
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
              onBeforeBack={async () => {
                if (chapterGoalDirty) return await confirmInfo({ title: '未保存修改', message: '本章目标有未保存修改，直接返回会丢失这些修改。是否继续？' });
                if (isDirty) return await confirmInfo({ title: '未保存修改', message: '当前正文有未保存修改，直接返回可能丢失修改。是否继续？' });
                return true;
              }}
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

        <EditorArea
          chapter={activeChapter}
          novelTitle={novel?.title}
          novelId={novelId}
          currentDraft={currentDraft}
          onDraftChange={handleDraftChange}
          onEditorContentChange={handleEditorContentChange}
          onDraftSaved={handleDraftApplied}
          applyTextRequest={applyTextRequest}
          commandRequest={editorCommandRequest}
          onChapterUpdated={handleChapterOutlineApplied}
          locateTarget={locateTarget}
          onLocateDone={handleLocateDone}
        />
        <StatusBar
          chapter={activeChapter}
          draftWordCount={draftWordCount}
          isDirty={isDirty}
          draftVersion={currentDraft ? `v${currentDraft.versionNo}` : 'v0 占位'}
        />
      </div>

      {/* 右侧工具栏 */}
      <RightToolbar activePanel={activePanel} onTogglePanel={handleTogglePanel} onRunCommand={runEditorCommand} />

      {/* 草稿历史面板 */}
      {activePanel === 'draft-history' && (
        <DraftHistoryPanel
          chapterId={activeChapterId}
          currentDraftId={currentDraft?.id}
          onLoadDraft={(draft) => { handleDraftApplied(draft); setActivePanel(null); }}
          onClose={handleClosePanel}
        />
      )}

      {/* 右侧弹出面板 */}
      {activePanel && activePanel !== 'draft-history' && (
        <RightPanel
          panelType={activePanel}
          onClose={handleClosePanel}
          novelId={novelId}
          chapter={activeChapter}
          onGenerated={handleDraftApplied}
          onAdopted={() => { if (activeChapterId) loadChapterDraft(activeChapterId); }}
          onChapterOutlineApplied={handleChapterOutlineApplied}
          onChapterGoalDirtyChange={setChapterGoalDirty}
          onChapterCharactersChanged={bumpContextVersion}
          contextVersion={contextVersion}
          onLocateText={handleLocateText}
          // v1.7.19 质量检查状态
          qcReport={activeQcReport}
          qcItems={activeQcItems}
          onQcChange={(report: any, items: any[]) => { setQcReport(report); setQcItems(items); }}
          currentEditorContent={editorSnapshot.chapterId === activeChapterId ? editorSnapshot.content : currentDraft?.content || ''}
          currentEditorWordCount={editorSnapshot.chapterId === activeChapterId ? editorSnapshot.wordCount : currentDraft?.wordCount || 0}
          currentEditorDirty={editorSnapshot.chapterId === activeChapterId ? editorSnapshot.isDirty : false}
          currentContentHash={editorSnapshot.chapterId === activeChapterId ? editorSnapshot.contentHash : hashTextContent(currentDraft?.content || '')}
          currentDraftId={currentDraft?.id}
          currentDraftVersion={currentDraft?.versionNo}
          onApplyAiText={applyAiTextToEditor}
          // v1.7.19 全局 AI 弹窗
          showAiModal={showAiModal}
          updateAiModal={updateAiModal}
          hideAiModal={hideAiModal}
        />
      )}

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
