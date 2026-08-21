import type { PanelType } from '../../types/rightSidebar';
import { WORKSPACE_E2E_PANELS } from '../../types/rightSidebar';
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

interface ReadinessToolbarButton {
  kind: 'readiness';
  icon: string;
  label: string;
}

type ToolbarButton = PanelToolbarButton | CommandToolbarButton | ReadinessToolbarButton;

const reviewToolbarButtons: ToolbarButton[] = [
  { kind: 'command', command: 'save', icon: '💾', label: '保存' },
  { kind: 'panel', id: 'draft-history', icon: '📚', label: '草稿' },
  { kind: 'readiness', icon: '▣', label: '准备' },
  { kind: 'panel', id: 'chapter-summary', icon: '📝', label: '总结' },
  { kind: 'command', command: 'format', icon: '📐', label: '排版' },
  { kind: 'command', command: 'adopt-current', icon: '✅', label: '采用' },
];

const e2eToolbarButtons: PanelToolbarButton[] = [
  { kind: 'panel', id: 'ai-generate', icon: '🤖', label: 'AI生成' },
  { kind: 'panel', id: 'engineering', icon: '🧩', label: '工程' },
  { kind: 'panel', id: 'setting', icon: '🌍', label: '设定' },
  { kind: 'panel', id: 'check', icon: '🔍', label: '检查' },
];

const DOCUMENT_REQUIRED_PANELS = new Set<Exclude<PanelType, null>>([
  'ai-generate',
  'engineering',
  'check',
  'chapter-summary',
]);

interface RightToolbarProps {
  activePanel: PanelType;
  onTogglePanel: (panel: PanelType) => void;
  onRunCommand?: (command: EditorCommandType) => void;
  onToggleReadiness?: () => void;
  readinessOpen?: boolean;
  documentAvailable?: boolean;
}

function panelTestId(id: Exclude<PanelType, null>): string | undefined {
  if (id === 'ai-generate') return 'ai-generate';
  if (id === 'engineering') return 'chapter-engineering';
  if (id === 'setting') return 'setting-tool';
  if (id === 'chapter-summary') return 'chapter-summary';
  if (id === 'check') return 'quality-check';
  return undefined;
}

function RightToolbar({
  activePanel,
  onTogglePanel,
  onRunCommand,
  onToggleReadiness,
  readinessOpen = false,
  documentAvailable = true,
}: RightToolbarProps) {
  const e2eEnabled = import.meta.env.VITE_AI_NOVEL_STUDIO_E2E === '1';
  const buttons = e2eEnabled
    ? [
        ...reviewToolbarButtons.slice(0, 4),
        ...e2eToolbarButtons.filter((button) =>
          (WORKSPACE_E2E_PANELS as readonly string[]).includes(button.id),
        ),
        ...reviewToolbarButtons.slice(4),
      ]
    : reviewToolbarButtons;

  return (
    <div className="right-toolbar">
      {buttons.map((btn) => {
        const disabled =
          !documentAvailable &&
          ((btn.kind === 'panel' && DOCUMENT_REQUIRED_PANELS.has(btn.id)) ||
            btn.kind === 'command');
        const key =
          btn.kind === 'panel' ? btn.id : btn.kind === 'command' ? btn.command : 'readiness';
        const testId =
          btn.kind === 'command' && btn.command === 'save'
            ? 'chapter-save'
            : btn.kind === 'command' && btn.command === 'adopt-current'
              ? 'chapter-adopt'
              : btn.kind === 'readiness'
                ? 'chapter-readiness-toggle'
                : btn.kind === 'panel'
                  ? panelTestId(btn.id)
                  : undefined;
        const active =
          (btn.kind === 'panel' && activePanel === btn.id) ||
          (btn.kind === 'readiness' && readinessOpen);
        return (
          <button
            type="button"
            key={key}
            data-testid={testId}
            className={`right-toolbar-btn ${active ? 'active' : ''}`}
            onClick={() => {
              if (btn.kind === 'panel') onTogglePanel(btn.id);
              else if (btn.kind === 'command') onRunCommand?.(btn.command);
              else onToggleReadiness?.();
            }}
            title={disabled ? `${btn.label}：完整正文不可用` : btn.label}
            disabled={disabled}
            aria-disabled={disabled}
          >
            <span className="tb-icon">{btn.icon}</span>
            <span className="tb-label">{btn.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default RightToolbar;
