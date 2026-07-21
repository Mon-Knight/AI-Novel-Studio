import type { PanelType } from '../../pages/WritingWorkspace/WritingWorkspacePage';
import type { EditorCommandType } from '../workspace/EditorArea';

interface PanelToolbarButton {
  kind: 'panel';
  id: Exclude<PanelType, null>;
  icon: string;
  label: string;
}

interface CommandToolbarButton {
  kind: 'command';
  command: EditorCommandType;
  icon: string;
  label: string;
}

type ToolbarButton = PanelToolbarButton | CommandToolbarButton;

const toolbarButtons: ToolbarButton[] = [
  { kind: 'command', command: 'save', icon: '💾', label: '保存' },
  { kind: 'panel', id: 'draft-history', icon: '📚', label: '草稿' },
  { kind: 'panel', id: 'ai-generate', icon: '🤖', label: 'AI生成' },
  { kind: 'panel', id: 'engineering', icon: '🧩', label: '工程' },
  { kind: 'panel', id: 'outline', icon: '📋', label: '大纲' },
  { kind: 'panel', id: 'characters', icon: '👥', label: '角色' },
  { kind: 'panel', id: 'events', icon: '⚡', label: '事件' },
  { kind: 'panel', id: 'setting', icon: '🌍', label: '设定' },
  { kind: 'panel', id: 'style', icon: '🎨', label: '风格' },
  { kind: 'panel', id: 'context-view', icon: '📦', label: '上下文' },
  { kind: 'panel', id: 'chapter-summary', icon: '📝', label: '总结' },
  { kind: 'panel', id: 'check', icon: '🔍', label: '检查' },
  { kind: 'panel', id: 'polish', icon: '✨', label: '润色' },
  { kind: 'command', command: 'format', icon: '📐', label: '排版' },
  { kind: 'command', command: 'adopt-current', icon: '✅', label: '采用' },
];

interface RightToolbarProps {
  activePanel: PanelType;
  onTogglePanel: (panel: PanelType) => void;
  onRunCommand?: (command: EditorCommandType) => void;
}

function RightToolbar({ activePanel, onTogglePanel, onRunCommand }: RightToolbarProps) {
  return (
    <div className="right-toolbar">
      {toolbarButtons.map((btn) => (
        <button
          type="button"
          key={btn.kind === 'panel' ? btn.id : btn.command}
          data-testid={btn.kind === 'command' && btn.command === 'save'
            ? 'chapter-save'
            : btn.kind === 'command' && btn.command === 'adopt-current'
              ? 'chapter-adopt'
              : btn.kind === 'panel' && btn.id === 'ai-generate'
                ? 'ai-generate'
                : btn.kind === 'panel' && btn.id === 'engineering'
                  ? 'chapter-engineering'
                : undefined}
          className={`right-toolbar-btn ${btn.kind === 'panel' && activePanel === btn.id ? 'active' : ''}`}
          onClick={() => {
            if (btn.kind === 'panel') onTogglePanel(btn.id);
            else onRunCommand?.(btn.command);
          }}
          title={btn.label}
        >
          <span className="tb-icon">{btn.icon}</span>
          <span className="tb-label">{btn.label}</span>
        </button>
      ))}
    </div>
  );
}

export default RightToolbar;
