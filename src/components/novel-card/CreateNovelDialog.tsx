import { useId } from 'react';
import { PenLine } from 'lucide-react';
import { ModalFrame } from '../common/ModalFrame';
import { isComposingKeyboardEvent } from '../../utils/keyboardEvent';

interface NovelFields {
  title: string;
  genre: string;
  description: string;
}

export function CreateNovelDialog({
  value,
  onChange,
  busy,
  error,
  onCreate,
  onCancel,
}: {
  value: NovelFields;
  onChange: (patch: Partial<NovelFields>) => void;
  busy: boolean;
  error: string;
  onCreate: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  return (
    <ModalFrame
      title={
        <>
          <PenLine aria-hidden="true" size={18} strokeWidth={1.8} />
          新建作品
        </>
      }
      onDismiss={onCancel}
      busy={busy}
      showCloseButton={false}
      overlayProps={{ 'data-testid': 'project-create-dialog' }}
      initialFocusSelector='[data-testid="project-name-input"]'
      footer={
        <>
          <button className="btn btn-secondary" type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            className="btn btn-primary"
            type="submit"
            form={id}
            data-testid="project-save"
            disabled={busy}
          >
            {busy ? '创建中…' : '创建作品'}
          </button>
        </>
      }
    >
      <form
        id={id}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onCreate();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && isComposingKeyboardEvent(event)) event.preventDefault();
        }}
      >
        <div className="form-group">
          <label className="panel-field-label" htmlFor={`${id}-title`}>
            作品名称 *
          </label>
          <input
            id={`${id}-title`}
            data-testid="project-name-input"
            className="form-input"
            value={value.title}
            placeholder="请输入作品名称"
            disabled={busy}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => onChange({ title: event.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="panel-field-label" htmlFor={`${id}-genre`}>
            题材
          </label>
          <input
            id={`${id}-genre`}
            className="form-input"
            value={value.genre}
            placeholder="如：科幻、仙侠、悬疑"
            disabled={busy}
            onChange={(event) => onChange({ genre: event.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="panel-field-label" htmlFor={`${id}-description`}>
            简介
          </label>
          <textarea
            id={`${id}-description`}
            className="form-textarea"
            value={value.description}
            rows={4}
            placeholder="简要介绍作品背景和主要情节方向"
            disabled={busy}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </div>
        {error && (
          <p id={`${id}-error`} data-testid="error-notice" role="alert" className="text-error">
            {error}
          </p>
        )}
      </form>
    </ModalFrame>
  );
}
