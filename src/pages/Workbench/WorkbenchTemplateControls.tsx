import { useState } from 'react';
import {
  isWorkbenchTaskTemplateEnabled,
  type WorkbenchTaskTemplate,
} from './workbenchTaskTemplates';

interface Props {
  templates: WorkbenchTaskTemplate[];
  hasChapter: boolean;
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
}

export function WorkbenchTemplateControls({
  templates,
  hasChapter,
  disabled,
  value,
  onChange,
}: Props) {
  const [pending, setPending] = useState<WorkbenchTaskTemplate | null>(null);
  const [undo, setUndo] = useState<{ before: string; after: string } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const common = templates
    .filter((template) => isWorkbenchTaskTemplateEnabled(template, hasChapter))
    .slice(0, 3);
  const more = templates.filter((template) => !common.includes(template));
  const validPending =
    pending && isWorkbenchTaskTemplateEnabled(pending, hasChapter) ? pending : null;

  const apply = (template: WorkbenchTaskTemplate, mode: 'insert' | 'replace') => {
    if (disabled || !isWorkbenchTaskTemplateEnabled(template, hasChapter)) return;
    const after =
      mode === 'insert' && value
        ? `${value}${value.endsWith('\n') ? '\n' : '\n\n'}${template.goal}`
        : template.goal;
    setUndo({ before: value, after });
    setPending(null);
    onChange(after);
  };
  const templateButton = (template: WorkbenchTaskTemplate) => (
    <button
      type="button"
      className="workbench-template-chip"
      key={template.id}
      data-testid={`workbench-template-${template.id}`}
      disabled={disabled || !isWorkbenchTaskTemplateEnabled(template, hasChapter)}
      title={
        !isWorkbenchTaskTemplateEnabled(template, hasChapter)
          ? hasChapter
            ? '请在整个小说项目范围的新任务中使用'
            : '请先选择目标章节'
          : undefined
      }
      onClick={() => (value.trim().length ? setPending(template) : apply(template, 'replace'))}
    >
      {template.label}
    </button>
  );
  return (
    <div className="workbench-template-controls" data-testid="workbench-task-templates">
      <div className="workbench-template-row">
        {common.map(templateButton)}
        {more.length > 0 && (
          <details
            className="workbench-template-more"
            open={moreOpen}
            onToggle={(event) => setMoreOpen(event.currentTarget.open)}
          >
            <summary>更多模板</summary>
            <div
              className="workbench-template-row"
              hidden={!moreOpen}
              style={{ display: moreOpen ? undefined : 'none' }}
            >
              {more.map(templateButton)}
            </div>
          </details>
        )}
      </div>
      {validPending && (
        <div
          className="workbench-template-confirm"
          role="group"
          aria-label="模板插入方式"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setPending(null);
            }
          }}
        >
          <span>已有目标：如何使用“{validPending.label}”？</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={disabled}
            onClick={() => apply(validPending, 'insert')}
          >
            追加到目标
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={disabled}
            onClick={() => apply(validPending, 'replace')}
          >
            替换目标
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => setPending(null)}
          >
            取消
          </button>
        </div>
      )}
      {undo && (
        <div className="workbench-template-undo" role="status">
          <span>
            {value === undo.after
              ? '模板已填入，尚未发送。'
              : '目标已继续编辑；为保护新输入，本次模板撤销已停用。'}
          </span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={disabled || value !== undo.after}
            onClick={() => {
              onChange(undo.before);
              setUndo(null);
            }}
          >
            撤销模板
          </button>
        </div>
      )}
    </div>
  );
}
