import { useState, useCallback, useEffect } from 'react';
import BackButton from '../../components/common/BackButton';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import VolumeTree from '../../components/workspace/VolumeTree';
import EditorArea from '../../components/workspace/EditorArea';
import StatusBar from '../../components/workspace/StatusBar';
import RightToolbar from '../../components/right-dock/RightToolbar';
import RightPanel from '../../components/right-dock/RightPanel';
import DraftHistoryPanel from '../../components/right-dock/panels/DraftHistoryPanel';
import ChapterSummaryDialog from '../../components/chapter-summary/ChapterSummaryDialog';
import { novelRepository } from '../../services/database/novelRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { volumeRepository } from '../../services/database/volumeRepository';
import { draftVersionService } from '../../services/database/draftVersionService';
import { chapterSummarizeService } from '../../services/ai/chapterSummarizeService';
import { chapterSummaryService } from '../../services/context/chapterSummaryService';
import { contextRecordService } from '../../services/context/contextRecordService';
import { characterStateService } from '../../services/context/characterStateService';
import type { Novel } from '../../types/novel';
import type { Chapter } from '../../types/chapter';
import type { ChapterDraft } from '../../types/ai';
import type { ChapterSummarizeResult } from '../../types/chapterSummary';
import '../../styles/workspace.css';
import '../../styles/right-dock.css';

export type PanelType =
  | 'ai-generate' | 'outline' | 'characters' | 'events'
  | 'setting' | 'style' | 'check' | 'polish'
  | 'draft-history' | 'chapter-summary' | 'context-view' | null;

function WritingWorkspacePage() {
  const { novelId } = useParams<{ novelId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activePanel, setActivePanel] = useState<PanelType>(null);
  const [novel, setNovel] = useState<Novel | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string>('');
  const [currentDraft, setCurrentDraft] = useState<ChapterDraft | null>(null);
  const [draftWordCount, setDraftWordCount] = useState(0);
  const [isDirty, setIsDirty] = useState(false);

  // v0.8.0 上下文总结相关状态
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false);
  const [summaryResult, setSummaryResult] = useState<ChapterSummarizeResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [summaryExists, setSummaryExists] = useState(false);

  const activeChapter = chapters.find((ch) => ch.id === activeChapterId);

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

  useEffect(() => {
    if (!novelId) return;
    let cancelled = false;
    setPageLoading(true);
    setPageError('');
    setLoadState('loading');

    // 并行加载，任一失败不影响
    Promise.allSettled([
      novelRepository.getById(novelId),
      chapterRepository.getByNovelId(novelId),
    ]).then(([nr, cr]) => {
      if (cancelled) return;
      if (nr.status === 'fulfilled') {
        if (nr.value) {
          setNovel(nr.value);
        } else {
          setLoadState('novel_not_found');
          setPageLoading(false);
          return;
        }
      } else {
        setPageError('作品加载失败');
        setLoadState('error');
        setPageLoading(false);
        return;
      }

      if (cr.status === 'fulfilled') {
        const list = cr.value;
        setChapters(list);
        const urlChapterId = searchParams.get('chapterId');
        if (urlChapterId && list.find((c) => c.id === urlChapterId)) {
          setActiveChapterId(urlChapterId);
        } else if (list.length > 0) {
          setActiveChapterId(list[0].id);
        }
        // 有章节时加载第一个章节的草稿
        const targetId = urlChapterId && list.find((c) => c.id === urlChapterId)
          ? urlChapterId
          : list[0]?.id;
        if (targetId) {
          loadChapterDraft(targetId);
        }
      }
      setLoadState('ready');
      setPageLoading(false);
    });

    return () => { cancelled = true; };
  }, [novelId, searchParams, loadChapterDraft]);

  const handleSelectChapter = useCallback((chapterId: string) => {
    setActiveChapterId(chapterId);
    setActivePanel(null); // 切换章节关闭面板
    loadChapterDraft(chapterId);
  }, [loadChapterDraft]);

  const handleTogglePanel = useCallback((panel: PanelType) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }, []);

  const handleOpenPanel = useCallback((panel: string) => {
    setActivePanel(panel as PanelType);
  }, []);

  const handleClosePanel = useCallback(() => setActivePanel(null), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setActivePanel(null); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleEditorClick = useCallback(() => setActivePanel(null), []);

  const handleDraftChange = useCallback((wordCount: number, dirty: boolean) => {
    setDraftWordCount(wordCount);
    setIsDirty(dirty);
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
      const summary = await chapterSummaryService.create({
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

  // v1.0.16 工作台内创建分卷和章节
  const [creating, setCreating] = useState(false);

  const refreshChapters = useCallback(async (): Promise<Chapter[]> => {
    if (!novelId) return [];
    try {
      const list = await chapterRepository.getByNovelId(novelId);
      return list;
    } catch { return []; }
  }, [novelId]);

  const handleCreateFirstChapter = useCallback(async () => {
    if (!novelId || creating) return;
    setCreating(true);
    try {
      // 1. 创建第一卷
      const vol = await volumeRepository.create({
        novelId,
        title: '第一卷',
      });
      // 2. 创建第一章
      const ch = await chapterRepository.create({
        novelId,
        volumeId: vol.id,
        title: '第1章',
      });
      // 3. 自动创建空草稿
      await draftVersionService.create({
        novelId,
        chapterId: ch.id,
        title: ch.title,
        content: '',
        source: 'user_edited',
      });
      // 4. 刷新章节列表
      const list = await refreshChapters();
      setChapters(list);
      setActiveChapterId(ch.id);
      setLoadState('ready');
      setCurrentDraft(null);
      setDraftWordCount(0);
      setIsDirty(false);
    } catch (e: any) {
      alert('创建失败：' + (e?.message || '未知错误'));
    } finally {
      setCreating(false);
    }
  }, [novelId, creating, refreshChapters]);

  const handleChapterCreated = useCallback(async (chapterId: string) => {
    setActiveChapterId(chapterId);
    setActivePanel(null);
    try {
      const draft = await draftVersionService.getLatestByChapterId(chapterId);
      setCurrentDraft(draft);
      setDraftWordCount(draft?.wordCount || 0);
      setIsDirty(false);
    } catch { /* ignore */ }
  }, []);

  return (
    <div className="workspace-page">
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
              <button className="btn btn-primary btn-sm" onClick={handleCreateFirstChapter} disabled={creating}>
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
            onBeforeBack={() => {
              if (isDirty) return confirm('当前正文有未保存修改，直接返回可能丢失修改。是否继续？');
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
            novelId={novelId}
            activeChapterId={activeChapterId}
            onSelectChapter={handleSelectChapter}
            onChapterCreated={handleChapterCreated}
            onChaptersRefresh={refreshChapters}
          />
        )}
      </div>

      {/* 中间正文编辑区 */}
      <div className="workspace-editor" onClick={handleEditorClick}>
        {/* 顶部信息栏 */}
        <div className="workspace-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BackButton
              label="返回作品"
              to={`/novels/${novelId}`}
              onBeforeBack={() => {
                if (isDirty) return confirm('当前正文有未保存修改，直接返回可能丢失修改。是否继续？');
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
          <div style={{ display: 'flex', gap: 4 }}>
            {activeChapter && activeChapter.status === 'adopted' && !summaryExists && (
              <button className="btn btn-primary btn-sm" onClick={handleGenerateSummary} disabled={summaryLoading}>
                {summaryLoading ? '⏳ 总结中...' : '📝 生成章节总结'}
              </button>
            )}
            {summaryExists && (
              <button className="btn btn-secondary btn-sm" onClick={() => handleOpenPanel('chapter-summary')}>
                ✅ 查看总结
              </button>
            )}
            <button className="btn btn-secondary btn-sm" onClick={() => handleOpenPanel('ai-generate')}>
              🤖 AI生成
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => handleOpenPanel('draft-history')}>
              📋 草稿历史
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setActivePanel(null)}>
              🖊️ 专注模式
            </button>
          </div>
        </div>

        <EditorArea
          chapter={activeChapter}
          novelTitle={novel?.title}
          novelId={novelId}
          currentDraft={currentDraft}
          onOpenPanel={handleOpenPanel}
          onDraftChange={handleDraftChange}
        />
        <StatusBar
          chapter={activeChapter}
          draftWordCount={draftWordCount}
          isDirty={isDirty}
          draftVersion={currentDraft ? `v${currentDraft.versionNo}` : 'v0 占位'}
        />
      </div>

      {/* 右侧工具栏 */}
      <RightToolbar activePanel={activePanel} onTogglePanel={handleTogglePanel} />

      {/* 草稿历史面板 */}
      {activePanel === 'draft-history' && (
        <DraftHistoryPanel
          chapterId={activeChapterId}
          currentDraftId={currentDraft?.id}
          onLoadDraft={(draft) => { setCurrentDraft(draft); setDraftWordCount(draft.wordCount); setIsDirty(false); setActivePanel(null); }}
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
          onGenerated={(draft) => { setCurrentDraft(draft); setDraftWordCount(draft.wordCount); setIsDirty(false); }}
          onAdopted={() => { if (activeChapterId) loadChapterDraft(activeChapterId); }}
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
