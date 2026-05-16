import type { PanelType } from '../../pages/WritingWorkspace/WritingWorkspacePage';

interface ToolbarButton {
  id: PanelType;
  icon: string;
  label: string;
}

const toolbarButtons: ToolbarButton[] = [
  { id: 'ai-generate', icon: '🤖', label: 'AI生成' },
  { id: 'outline', icon: '📋', label: '大纲' },
  { id: 'characters', icon: '👥', label: '角色' },
  { id: 'events', icon: '⚡', label: '事件' },
  { id: 'setting', icon: '🌍', label: '设定' },
  { id: 'style', icon: '🎨', label: '风格' },
  { id: 'check', icon: '🔍', label: '检查' },
  { id: 'polish', icon: '✨', label: '润色' },
];

interface RightToolbarProps {
  activePanel: PanelType;
  onTogglePanel: (panel: PanelType) => void;
}

function RightToolbar({ activePanel, onTogglePanel }: RightToolbarProps) {
  return (
    <div className="right-toolbar">
      {toolbarButtons.map((btn) => (
        <div
          key={btn.id}
          className={`right-toolbar-btn ${activePanel === btn.id ? 'active' : ''}`}
          onClick={() => onTogglePanel(btn.id)}
          title={btn.label}
        >
          <span className="tb-icon">{btn.icon}</span>
          <span className="tb-label">{btn.label}</span>
        </div>
      ))}
    </div>
  );
}

export default RightToolbar;
