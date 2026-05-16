import type { PanelType } from '../../pages/WritingWorkspace/WritingWorkspacePage';
import AiGeneratePanel from './panels/AiGeneratePanel';
import OutlinePanel from './panels/OutlinePanel';
import CharactersPanel from './panels/CharactersPanel';
import EventsPanel from './panels/EventsPanel';
import SettingPanel from './panels/SettingPanel';
import StylePanel from './panels/StylePanel';
import CheckPanel from './panels/CheckPanel';
import PolishPanel from './panels/PolishPanel';

interface RightPanelProps {
  panelType: PanelType;
  onClose: () => void;
  novelId?: string;
}

const panelConfig: Record<string, { title: string; component: React.FC<{ novelId?: string }> }> = {
  'ai-generate': { title: 'AI 章节生成', component: AiGeneratePanel },
  'outline': { title: '大纲查看', component: OutlinePanel },
  'characters': { title: '角色管理', component: CharactersPanel },
  'events': { title: '事件管理', component: EventsPanel },
  'setting': { title: '设定查看', component: SettingPanel },
  'style': { title: '风格方案', component: StylePanel },
  'check': { title: '质量检查', component: CheckPanel },
  'polish': { title: '润色优化', component: PolishPanel },
};

function RightPanel({ panelType, onClose, novelId }: RightPanelProps) {
  if (!panelType) return null;
  const config = panelConfig[panelType];
  if (!config) return null;

  const PanelComponent = config.component;

  return (
    <>
      {/* 遮罩层，点击关闭 */}
      <div className="right-panel-overlay" onClick={onClose} />
      <div className="right-panel" onClick={(e) => e.stopPropagation()}>
        <div className="right-panel-header">
          <span className="right-panel-title">{config.title}</span>
          <button className="right-panel-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="right-panel-body">
          <PanelComponent novelId={novelId} />
        </div>
      </div>
    </>
  );
}

export default RightPanel;
