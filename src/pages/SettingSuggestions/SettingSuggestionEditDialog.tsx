import { ModalFrame } from '../../components/common/ModalFrame';

export function SettingSuggestionEditDialog({
  value,
  onChange,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  value: string;
  onChange: (value: string) => void;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalFrame
      title="编辑后采纳"
      maxWidth={720}
      busy={busy}
      onDismiss={onClose}
      className="setting-suggestions-modal"
      initialFocusSelector='[data-setting-json="true"]'
      footer={
        <>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onConfirm}>
            {busy ? '采纳中…' : '确认采纳'}
          </button>
        </>
      }
    >
      <div className="setting-suggestions-muted">
        修改 JSON 字段后保存，会写入正式模块并把候选标记为“编辑后采纳”。
      </div>
      <textarea
        className="input setting-suggestions-json-editor"
        aria-label="待采纳的设定 JSON"
        data-setting-json="true"
        disabled={busy}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {error && (
        <p role="alert" className="setting-suggestions-error">
          {error}
        </p>
      )}
    </ModalFrame>
  );
}
