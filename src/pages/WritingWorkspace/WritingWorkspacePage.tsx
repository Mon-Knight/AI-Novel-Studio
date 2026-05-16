import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import VolumeTree from '../../components/workspace/VolumeTree';
import EditorArea from '../../components/workspace/EditorArea';
import StatusBar from '../../components/workspace/StatusBar';
import RightToolbar from '../../components/right-dock/RightToolbar';
import RightPanel from '../../components/right-dock/RightPanel';
import { mockChapters, mockVolumes, mockDrafts } from '../../features/chapters/mockChapters';
import { novelRepository } from '../../services/database/novelRepository';
import type { Novel } from '../../types/novel';
import type { Chapter } from '../../types/chapter';
import '../../styles/workspace.css';
import '../../styles/right-dock.css';

export type PanelType =
  | 'ai-generate'
  | 'outline'
  | 'characters'
  | 'events'
  | 'setting'
  | 'style'
  | 'check'
  | 'polish'
  | null;

function WritingWorkspacePage() {
  const { novelId } = useParams<{ novelId: string }>();
  const navigate = useNavigate();
  const [activePanel, setActivePanel] = useState<PanelType>(null);
  const [activeChapterId, setActiveChapterId] = useState<string>('ch-001');
  const [novel, setNovel] = useState<Novel | null>(null);

  useEffect(() => {
    if (novelId) {
      novelRepository.getById(novelId).then(setNovel).catch(console.error);
    }
  }, [novelId]);

  const activeChapter = mockChapters.find((ch) => ch.id === activeChapterId);
  const activeDraft = activeChapterId ? mockDrafts[activeChapterId]?.[0] : undefined;

  const handleTogglePanel = useCallback((panel: PanelType) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }, []);

  const handleClosePanel = useCallback(() => {
    setActivePanel(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setActivePanel(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleEditorClick = useCallback(() => {
    setActivePanel(null);
  }, []);

  return (
    <div className="workspace-page">
      <div className="workspace-sidebar">
        {novel && (
          <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--color-border-light)', fontSize: '13px', fontWeight: 500, color: 'var(--color-text-primary)' }}>
            📖 {novel.title}
          </div>
        )}
        <VolumeTree
          volumes={mockVolumes}
          chapters={mockChapters}
          activeChapterId={activeChapterId}
          onSelectChapter={setActiveChapterId}
        />
      </div>

      <div className="workspace-editor" onClick={handleEditorClick}>
        <EditorArea chapter={activeChapter} draft={activeDraft} novelTitle={novel?.title} />
        <StatusBar chapter={activeChapter} draft={activeDraft} />
      </div>

      <RightToolbar activePanel={activePanel} onTogglePanel={handleTogglePanel} />

      {activePanel && (
        <RightPanel panelType={activePanel} onClose={handleClosePanel} novelId={novelId} />
      )}
    </div>
  );
}

export default WritingWorkspacePage;
