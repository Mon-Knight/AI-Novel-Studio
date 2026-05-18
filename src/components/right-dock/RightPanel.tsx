import { useRef, useEffect } from 'react';
import type { PanelType } from '../../pages/WritingWorkspace/WritingWorkspacePage';
import type { Chapter } from '../../types/chapter';
import type { ChapterDraft } from '../../types/ai';
import AiGeneratePanel from './panels/AiGeneratePanel';
import OutlinePanel from './panels/OutlinePanel';
import CharactersPanel from './panels/CharactersPanel';
import EventsPanel from './panels/EventsPanel';
import SettingPanel from './panels/SettingPanel';
import StylePanel from './panels/StylePanel';
import CheckPanel from './panels/CheckPanel';
import PolishPanel from './panels/PolishPanel';
import ChapterSummaryPanel from './panels/ChapterSummaryPanel';
import ContextViewPanel from './panels/ContextViewPanel';

interface RightPanelProps {
  panelType: PanelType;
  onClose: () => void;
  novelId?: string;
  chapter?: Chapter;
  onGenerated?: (draft: ChapterDraft) => void;
  onAdopted?: () => void;
  onChapterOutlineApplied?: (chapterId: string) => void;
}

const panelConfig: Record<string, { title: string; component: React.FC<{ novelId?: string; chapter?: Chapter; onGenerated?: (draft: ChapterDraft) => void; onAdopted?: () => void; onChapterOutlineApplied?: (chapterId: string) => void }> }> = {
  'ai-generate': { title: 'AI 章节生成', component: AiGeneratePanel },
  'outline': { title: '大纲查看', component: OutlinePanel },
  'characters': { title: '角色管理', component: CharactersPanel },
  'events': { title: '事件管理', component: EventsPanel },
  'setting': { title: '设定查看', component: SettingPanel },
  'style': { title: '风格方案', component: StylePanel },
  'check': { title: '质量检查', component: CheckPanel },
  'polish': { title: '润色优化', component: PolishPanel },
  'chapter-summary': { title: '章节总结', component: ChapterSummaryPanel },
  'context-view': { title: '上下文记录', component: ContextViewPanel },
};

function RightPanel({ panelType, onClose, novelId, chapter, onGenerated, onAdopted, onChapterOutlineApplied }: RightPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // v1.0.24: 全局 mousedown 监听 —— 精确 click-outside 判断
  useEffect(() => {
    if (!panelType) return; // 无面板时不需要监听
    function handleDocumentMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (panelRef.current?.contains(target)) return;
      if (target.closest('.right-toolbar')) return;
      onClose();
    }
    document.addEventListener('mousedown', handleDocumentMouseDown, true);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown, true);
  }, [onClose, panelType]);

  if (!panelType) return null;
  const config = panelConfig[panelType];
  if (!config) return null;

  const PanelComponent = config.component;

  // v1.0.24: 阻止面板内部所有交互事件冒泡到外部
  const stopAll = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation?.();
  };

  return (
    <div className="right-panel-overlay">
      <div
        ref={panelRef}
        className="right-panel"
        onMouseDown={stopAll}
        onClick={stopAll}
      >
        <div className="right-panel-header">
          <span className="right-panel-title">{config.title}</span>
          <button
            className="right-panel-close"
            onMouseDown={stopAll}
            onClick={(e) => { stopAll(e); onClose(); }}
          >
            ✕
          </button>
        </div>
        <div className="right-panel-body" onMouseDown={stopAll} onClick={stopAll}>
          <PanelComponent novelId={novelId} chapter={chapter} onGenerated={onGenerated} onAdopted={onAdopted} onChapterOutlineApplied={onChapterOutlineApplied} />
        </div>
      </div>
    </div>
  );
}

export default RightPanel;
