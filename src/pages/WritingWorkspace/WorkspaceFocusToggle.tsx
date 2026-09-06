import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

export function WorkspaceFocusToggle({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  const Icon = active ? PanelLeftOpen : PanelLeftClose;
  return (
    <button
      type="button"
      className="btn btn-secondary btn-sm"
      data-testid="workspace-focus-toggle"
      aria-pressed={active}
      aria-controls="workspace-chapter-directory"
      onClick={onToggle}
    >
      <Icon aria-hidden="true" size={16} strokeWidth={1.8} />
      {active ? '显示章节目录' : '专注正文'}
    </button>
  );
}
