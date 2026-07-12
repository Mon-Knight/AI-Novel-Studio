import { useState } from 'react';
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

const primaryButtons: ToolbarButton[] = [
  { kind: 'command', command: 'save', icon: '💾', label: '保存' },
  { kind: 'panel', id: 'draft-history', icon: '📚', label: '版本' },
  { kind: 'panel', id: 'ai-generate', icon: '🤖', label: 'AI创作' },
  { kind: 'panel', id: 'outline', icon: '📋', label: '规划' },
  { kind: 'panel', id: 'check', icon: '🔍', label: '审查' },
];

const secondaryButtons: ToolbarButton[] = [
  { kind: 'panel', id: 'characters', icon: '👥', label: '角色' },
  { kind: 'panel', id: 'events', icon: '⚡', label: '事件' },
  { kind: 'panel', id: 'setting', icon: '🌍', label: '设定' },
  { kind: 'panel', id: 'style', icon: '🎨', label: '风格' },
  { kind: 'panel', id: 'context-view', icon: '📦', label: '上下文' },
  { kind: 'panel', id: 'chapter-summary', icon: '📝', label: '总结' },
  { kind: 'panel', id: 'polish', icon: '✨', label: '润色' },
  { kind: 'command', command: 'format', icon: '📐', label: '排版' },
  { kind: 'panel', id: 'engineering', icon: '🧩', label: '高级工程' },
];

interface RightToolbarProps {
  activePanel: PanelType;
  onTogglePanel: (panel: PanelType) => void;
  onRunCommand?: (command: EditorCommandType) => void;
  documentAvailable?: boolean;
}

const DOCUMENT_REQUIRED_PANELS = new Set<Exclude<PanelType, null>>([
  'ai-generate',
  'engineering',
  'check',
  'polish',
  'chapter-summary',
]);

function buttonKey(button: ToolbarButton): string {
  return button.kind === 'panel' ? button.id : button.command;
}

function RightToolbar({ activePanel, onTogglePanel, onRunCommand, documentAvailable = true }: RightToolbarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const secondaryActive = secondaryButtons.some((button) => button.kind === 'panel' && button.id === activePanel);

  const renderButton = (button: ToolbarButton, compact = false) => {
    const disabled = !documentAvailable && (
      (button.kind === 'panel' && DOCUMENT_REQUIRED_PANELS.has(button.id))
      || button.kind === 'command'
    );
    const active = button.kind === 'panel' && activePanel === button.id;
    return (
      <button
        type="button"
        key={buttonKey(button)}
        className={`${compact ? 'right-toolbar-more-btn' : 'right-toolbar-btn'}${active ? ' active' : ''}`}
        onClick={() => {
          if (button.kind === 'panel') onTogglePanel(button.id);
          else onRunCommand?.(button.command);
          if (compact) setMoreOpen(false);
        }}
        title={disabled ? `${button.label}：完整正文不可用` : button.label}
        disabled={disabled}
        aria-disabled={disabled}
      >
        <span className="tb-icon">{button.icon}</span>
        <span className="tb-label">{button.label}</span>
      </button>
    );
  };

  return (
    <div className="right-toolbar">
      {primaryButtons.map((button) => renderButton(button))}
      <div className="right-toolbar-spacer" />
      <button
        type="button"
        className={`right-toolbar-btn${moreOpen || secondaryActive ? ' active' : ''}`}
        onClick={() => setMoreOpen((open) => !open)}
        aria-expanded={moreOpen}
        title="更多工具"
      >
        <span className="tb-icon">•••</span>
        <span className="tb-label">更多</span>
      </button>
      {moreOpen && (
        <div className="right-toolbar-more" role="menu" aria-label="更多写作工具">
          <div className="right-toolbar-more-title">更多工具</div>
          {secondaryButtons.map((button) => renderButton(button, true))}
        </div>
      )}
    </div>
  );
}

export default RightToolbar;
