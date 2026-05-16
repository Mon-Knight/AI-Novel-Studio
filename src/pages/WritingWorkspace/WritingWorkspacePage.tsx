import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import VolumeTree from '../../components/workspace/VolumeTree';
import EditorArea from '../../components/workspace/EditorArea';
import StatusBar from '../../components/workspace/StatusBar';
import RightToolbar from '../../components/right-dock/RightToolbar';
import RightPanel from '../../components/right-dock/RightPanel';
import { novelRepository } from '../../services/database/novelRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import type { Novel } from '../../types/novel';
import type { Chapter } from '../../types/chapter';
import '../../styles/workspace.css';
import '../../styles/right-dock.css';

export type PanelType =
  | 'ai-generate' | 'outline' | 'characters' | 'events'
  | 'setting' | 'style' | 'check' | 'polish' | null;

function WritingWorkspacePage() {
  const { novelId } = useParams<{ novelId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [activePanel, setActivePanel] = useState<PanelType>(null);
  const [novel, setNovel] = useState<Novel | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [activeChapterId, setActiveChapterId] = useState<string>('');

  useEffect(() => {
    if (novelId) {
      novelRepository.getById(novelId).then(setNovel).catch(console.error);
      chapterRepository.getByNovelId(novelId).then((list) => {
        setChapters(list);
        // 优先使用 URL 中指定的章节，否则第一个
        const urlChapterId = searchParams.get('chapterId');
        if (urlChapterId && list.find((c) => c.id === urlChapterId)) {
          setActiveChapterId(urlChapterId);
        } else if (list.length > 0) {
          setActiveChapterId(list[0].id);
        }
      }).catch(console.error);
    }
  }, [novelId, searchParams]);

  const activeChapter = chapters.find((ch) => ch.id === activeChapterId);

  const handleTogglePanel = useCallback((panel: PanelType) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }, []);

  const handleClosePanel = useCallback(() => setActivePanel(null), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setActivePanel(null); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleEditorClick = useCallback(() => setActivePanel(null), []);

  return (
    <div className="workspace-page">
      <div className="workspace-sidebar">
        {novel && (
          <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--color-border-light)', fontSize: 13, fontWeight: 500 }}>
            📖 {novel.title}
          </div>
        )}
        {novelId && (
          <VolumeTree
            novelId={novelId}
            activeChapterId={activeChapterId}
            onSelectChapter={setActiveChapterId}
          />
        )}
      </div>
      <div className="workspace-editor" onClick={handleEditorClick}>
        <EditorArea chapter={activeChapter} novelTitle={novel?.title} />
        <StatusBar chapter={activeChapter} />
      </div>
      <RightToolbar activePanel={activePanel} onTogglePanel={handleTogglePanel} />
      {activePanel && (
        <RightPanel panelType={activePanel} onClose={handleClosePanel} novelId={novelId} chapter={activeChapter} />
      )}
    </div>
  );
}

export default WritingWorkspacePage;
