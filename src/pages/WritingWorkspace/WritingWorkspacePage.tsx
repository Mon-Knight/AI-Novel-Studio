import { useState, useCallback, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import VolumeTree from '../../components/workspace/VolumeTree';
import EditorArea from '../../components/workspace/EditorArea';
import StatusBar from '../../components/workspace/StatusBar';
import RightToolbar from '../../components/right-dock/RightToolbar';
import RightPanel from '../../components/right-dock/RightPanel';
import { mockChapters, mockVolumes, mockDrafts } from '../../features/chapters/mockChapters';
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

  const activeChapter = mockChapters.find((ch) => ch.id === activeChapterId);
  const activeDraft = activeChapterId ? mockDrafts[activeChapterId]?.[0] : undefined;

  // 切换面板
  const handleTogglePanel = useCallback((panel: PanelType) => {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }, []);

  // 关闭面板
  const handleClosePanel = useCallback(() => {
    setActivePanel(null);
  }, []);

  // 按 Esc 关闭面板
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setActivePanel(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // 点击正文区关闭面板
  const handleEditorClick = useCallback(() => {
    setActivePanel(null);
  }, []);

  return (
    <div className="workspace-page">
      {/* 左侧卷章目录树 */}
      <div className="workspace-sidebar">
        <VolumeTree
          volumes={mockVolumes}
          chapters={mockChapters}
          activeChapterId={activeChapterId}
          onSelectChapter={setActiveChapterId}
        />
      </div>

      {/* 中间正文编辑区 */}
      <div className="workspace-editor" onClick={handleEditorClick}>
        <EditorArea
          chapter={activeChapter}
          draft={activeDraft}
        />
        <StatusBar
          chapter={activeChapter}
          draft={activeDraft}
        />
      </div>

      {/* 右侧工具栏 */}
      <RightToolbar
        activePanel={activePanel}
        onTogglePanel={handleTogglePanel}
      />

      {/* 右侧弹出面板 */}
      {activePanel && (
        <RightPanel
          panelType={activePanel}
          onClose={handleClosePanel}
        />
      )}
    </div>
  );
}

export default WritingWorkspacePage;
