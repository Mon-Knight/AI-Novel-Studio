import {
  AlignLeft,
  Bot,
  CircleCheckBig,
  FileText,
  Globe2,
  History,
  ListChecks,
  LoaderCircle,
  Save,
  SearchCheck,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useRef } from 'react';
import type { PanelType } from '../../types/rightSidebar';
import { WORKSPACE_E2E_PANELS } from '../../types/rightSidebar';
import type { EditorCommandType } from '../workspace/EditorArea';

interface PanelToolbarButton {
  kind: 'panel';
  id: Exclude<PanelType, null>;
  icon: LucideIcon;
  label: string;
}

interface CommandToolbarButton {
  kind: 'command';
  command: EditorCommandType;
  icon: LucideIcon;
  label: string;
}

interface ReadinessToolbarButton {
  kind: 'readiness';
  icon: LucideIcon;
  label: string;
}

type ToolbarButton = PanelToolbarButton | CommandToolbarButton | ReadinessToolbarButton;

const reviewToolbarButtons: ToolbarButton[] = [
  { kind: 'command', command: 'save', icon: Save, label: '保存' },
  { kind: 'readiness', icon: ListChecks, label: '准备' },
  { kind: 'panel', id: 'chapter-summary', icon: FileText, label: '总结' },
  { kind: 'command', command: 'format', icon: AlignLeft, label: '排版' },
  { kind: 'command', command: 'adopt-current', icon: CircleCheckBig, label: '采用' },
];

const e2eToolbarButtons: PanelToolbarButton[] = [
  { kind: 'panel', id: 'draft-history', icon: History, label: '草稿' },
  { kind: 'panel', id: 'ai-generate', icon: Bot, label: 'AI生成' },
  { kind: 'panel', id: 'engineering', icon: Workflow, label: '工程' },
  { kind: 'panel', id: 'setting', icon: Globe2, label: '设定' },
  { kind: 'panel', id: 'check', icon: SearchCheck, label: '检查' },
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
  reviewLocked?: boolean;
  documentDirty?: boolean;
  documentSaving?: boolean;
  documentAdopting?: boolean;
  hasCurrentDraft?: boolean;
  currentDraftAdopted?: boolean;
  hasReviewCandidate?: boolean;
}

interface CommandGateState {
  documentAvailable: boolean;
  reviewLocked: boolean;
  documentDirty: boolean;
  documentSaving: boolean;
  documentAdopting: boolean;
  hasCurrentDraft: boolean;
  currentDraftAdopted: boolean;
  hasReviewCandidate: boolean;
}

function commandDisabledReason(command: EditorCommandType, state: CommandGateState): string {
  if (!state.documentAvailable) return '完整正文不可用';
  if (state.reviewLocked) return '当前为只读审阅，请先进入编辑';
  if (state.documentSaving) return '正在保存正文';
  if (state.documentAdopting) return '正在采用正文';
  if (command === 'save' && !state.documentDirty && !state.hasReviewCandidate) {
    return '没有未保存修改';
  }
  if (
    command === 'adopt-current' &&
    !state.documentDirty &&
    !state.hasReviewCandidate &&
    (!state.hasCurrentDraft || state.currentDraftAdopted)
  ) {
    return state.currentDraftAdopted ? '当前正文已采用' : '当前没有可采用的草稿';
  }
  return '';
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
  reviewLocked = false,
  documentDirty = true,
  documentSaving = false,
  documentAdopting = false,
  hasCurrentDraft = false,
  currentDraftAdopted = false,
  hasReviewCandidate = false,
}: RightToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const e2eEnabled = import.meta.env.VITE_AI_NOVEL_STUDIO_E2E === '1';
  const buttons = e2eEnabled
    ? [
        ...reviewToolbarButtons.slice(0, 3),
        ...e2eToolbarButtons.filter((button) =>
          (WORKSPACE_E2E_PANELS as readonly string[]).includes(button.id),
        ),
        ...reviewToolbarButtons.slice(3),
      ]
    : reviewToolbarButtons;

  return (
    <div
      ref={toolbarRef}
      className="right-toolbar"
      role="toolbar"
      aria-label="章节工具"
      aria-orientation="vertical"
      onKeyDown={(event) => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const enabledButtons = Array.from(
          toolbarRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
        );
        if (enabledButtons.length === 0) return;
        const currentButton = (event.target as HTMLElement).closest('button');
        const currentIndex = Math.max(
          0,
          enabledButtons.indexOf(currentButton as HTMLButtonElement),
        );
        const nextIndex =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? enabledButtons.length - 1
              : event.key === 'ArrowDown'
                ? (currentIndex + 1) % enabledButtons.length
                : (currentIndex - 1 + enabledButtons.length) % enabledButtons.length;
        event.preventDefault();
        enabledButtons[nextIndex]?.focus();
      }}
    >
      {buttons.map((btn) => {
        const commandReason =
          btn.kind === 'command'
            ? commandDisabledReason(btn.command, {
                documentAvailable,
                reviewLocked,
                documentDirty,
                documentSaving,
                documentAdopting,
                hasCurrentDraft,
                currentDraftAdopted,
                hasReviewCandidate,
              })
            : '';
        const disabled =
          btn.kind === 'command'
            ? Boolean(commandReason)
            : btn.kind === 'panel' && !documentAvailable && DOCUMENT_REQUIRED_PANELS.has(btn.id);
        const busy =
          btn.kind === 'command' &&
          ((btn.command === 'save' && documentSaving) ||
            (btn.command === 'adopt-current' && documentAdopting));
        const Icon = busy ? LoaderCircle : btn.icon;
        const displayLabel =
          btn.kind === 'command' && btn.command === 'save' && documentSaving
            ? '保存中'
            : btn.kind === 'command' && btn.command === 'adopt-current' && documentAdopting
              ? '采用中'
              : btn.label;
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
        const togglesSurface = btn.kind === 'panel' || btn.kind === 'readiness';
        const accessibleLabel = disabled
          ? `${displayLabel}，${commandReason || '完整正文不可用'}`
          : togglesSurface
            ? `${active ? '收起' : '打开'}${btn.label}`
            : displayLabel;
        return (
          <button
            type="button"
            key={key}
            data-testid={testId}
            className={`right-toolbar-btn ${active ? 'active' : ''} ${busy ? 'is-busy' : ''}`.trim()}
            data-kind={btn.kind}
            onClick={() => {
              if (btn.kind === 'panel') onTogglePanel(btn.id);
              else if (btn.kind === 'command') onRunCommand?.(btn.command);
              else onToggleReadiness?.();
            }}
            title={disabled ? `${btn.label}：${commandReason || '完整正文不可用'}` : btn.label}
            disabled={disabled}
            aria-disabled={disabled}
            aria-busy={busy || undefined}
            aria-label={accessibleLabel}
            aria-pressed={togglesSurface ? active : undefined}
            aria-expanded={togglesSurface ? active : undefined}
          >
            <span className="tb-icon" aria-hidden="true">
              <Icon
                className={busy ? 'workspace-spinning-icon' : undefined}
                size={18}
                strokeWidth={1.8}
              />
            </span>
            <span className="tb-label">{displayLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

export default RightToolbar;
