import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import VolumeTree from '../../components/workspace/VolumeTree';
import EditorArea from '../../components/workspace/EditorArea';
import StatusBar from '../../components/workspace/StatusBar';
import RightToolbar from '../../components/right-dock/RightToolbar';
import RightPanel from '../../components/right-dock/RightPanel';
import DraftHistoryPanel from '../../components/right-dock/panels/DraftHistoryPanel';
import { novelRepository } from '../../services/database/novelRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { draftVersionService } from '../../services/database/draftVersionService';
import type { Novel } from '../../types/novel';
import type { Chapter } from '../../types/chapter';
import type { ChapterDraft } from '../../types/ai';
import '../../styles/workspace.css';
import '../../styles/right-dock.css';

export type PanelType =
  | 'ai-generate' | 'outline' | 'characters' | 'events'
  | 'setting' | 'style' | 'check' | 'polish' | 'draft-history' | null;

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

  const activeChapter = chapters.find((ch) => ch.id === activeChapterId);

  const loadChapterDraft = useCallback(async (chapterId: string) => {
    const draft = await draftVersionService.getLatestByChapterId(chapterId);
    setCurrentDraft(draft);
    setDraftWordCount(draft?.wordCount || 0);
    setIsDirty(false);
  }, []);

  useEffect(() => {
    if (novelId) {
      novelRepository.getById(novelId).then(setNovel).catch(console.error);
      chapterRepository.getByNovelId(novelId).then((list) => {
        setChapters(list);
        const urlChapterId = searchParams.get('chapterId');
        if (urlChapterId && list.find((c) => c.id === urlChapterId)) {
          setActiveChapterId(urlChapterId);
        } else if (list.length > 0) {
          setActiveChapterId(list[0].id);
        }
      }).catch(console.error);
    }
  }, [novelId, searchParams]);

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

  return (
    <div className="workspace-page">
      {/* 左侧卷章目录树 */}
      <div className="workspace-sidebar">
        {/* 顶部导航区 */}
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--color-border-light)' }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => navigate(`/novels/${novelId}`)}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            ← 返回作品详情
          </button>
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
          />
        )}
      </div>

      {/* 中间正文编辑区 */}
      <div className="workspace-editor" onClick={handleEditorClick}>
        {/* 顶部信息栏 */}
        <div className="workspace-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/novels/${novelId}`)}>
              ← 返回
            </button>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{novel?.title || '未选择作品'}</span>
          </div>
          {activeChapter && (
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              当前：第{activeChapter.chapterNumber}章 {activeChapter.title}
            </div>
          )}
          <div style={{ display: 'flex', gap: 4 }}>
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
    </div>
  );
}

export default WritingWorkspacePage;
