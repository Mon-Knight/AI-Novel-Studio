import { useEffect, useRef, useState } from 'react';
import { isComposingKeyboardEvent } from '../../utils/keyboardEvent';
import {
  WorkbenchTemplateUndoNotice,
  type WorkbenchTemplateUndo,
} from './WorkbenchTemplateUndoNotice';
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
  onApplied?: (undo: WorkbenchTemplateUndo) => void;
}

export function WorkbenchTemplateControls({
  templates,
  hasChapter,
  disabled,
  value,
  onChange,
  onApplied,
}: Props) {
  const [pending, setPending] = useState<WorkbenchTaskTemplate | null>(null);
  const [undo, setUndo] = useState<WorkbenchTemplateUndo | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const templateTriggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (pending) {
      confirmRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    }
  }, [pending]);
  const cancelPending = () => {
    setPending(null);
    templateTriggerRef.current?.focus({ preventScroll: true });
  };
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
    onApplied?.({ before: value, after });
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
      onClick={(event) => {
        templateTriggerRef.current = event.currentTarget;
        if (value.trim().length) setPending(template);
        else apply(template, 'replace');
      }}
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
          ref={confirmRef}
          className="workbench-template-confirm"
          role="group"
          aria-label="模板插入方式"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !isComposingKeyboardEvent(event)) {
              event.preventDefault();
              event.stopPropagation();
              cancelPending();
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
          <button type="button" className="btn btn-secondary btn-sm" onClick={cancelPending}>
            取消
          </button>
        </div>
      )}
      {!onApplied && (
        <WorkbenchTemplateUndoNotice
          undo={undo}
          value={value}
          disabled={disabled}
          onUndo={() => {
            if (!undo || disabled || value !== undo.after) return;
            onChange(undo.before);
            setUndo(null);
          }}
        />
      )}
    </div>
  );
}
