export interface WorkbenchTemplateUndo {
  before: string;
  after: string;
}

export function WorkbenchTemplateUndoNotice({
  undo,
  value,
  disabled,
  onUndo,
}: {
  undo: WorkbenchTemplateUndo | null;
  value: string;
  disabled: boolean;
  onUndo: () => void;
}) {
  if (!undo) return null;
  return (
    <div className="workbench-template-undo" role="status" data-testid="workbench-template-undo">
      <span>
        {value === undo.after
          ? '模板已填入，尚未发送。'
          : '目标已继续编辑；为保护新输入，本次模板撤销已停用。'}
      </span>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={disabled || value !== undo.after}
        onClick={onUndo}
      >
        撤销模板
      </button>
    </div>
  );
}
