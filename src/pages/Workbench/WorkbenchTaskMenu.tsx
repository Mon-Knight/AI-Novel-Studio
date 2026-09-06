import type { RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Archive, ArchiveRestore, Pencil } from 'lucide-react';
import type { TaskConversation } from '../../types/conversation';

export function WorkbenchTaskMenu({
  conversation,
  menuRef,
  position,
  busy,
  running,
  onRename,
  onArchive,
}: {
  conversation: TaskConversation;
  menuRef: RefObject<HTMLDivElement>;
  position: { top: number; left: number };
  busy: boolean;
  running: boolean;
  onRename: () => void;
  onArchive: (archived: boolean) => void;
}) {
  const archived = Boolean(conversation.archivedAt || conversation.status === 'archived');
  return createPortal(
    <div
      ref={menuRef}
      className="workbench-task-menu"
      role="menu"
      aria-label={`${conversation.title}的任务操作`}
      style={position}
    >
      {!archived && (
        <button type="button" role="menuitem" onClick={onRename}>
          <Pencil aria-hidden="true" size={14} strokeWidth={1.8} />
          <span>重命名</span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        disabled={busy || running}
        title={running ? '请先停止运行中的任务' : undefined}
        onClick={() => onArchive(!archived)}
      >
        {archived ? (
          <ArchiveRestore aria-hidden="true" size={14} strokeWidth={1.8} />
        ) : (
          <Archive aria-hidden="true" size={14} strokeWidth={1.8} />
        )}
        <span>{archived ? '恢复任务' : '归档任务'}</span>
      </button>
    </div>,
    document.body,
  );
}
