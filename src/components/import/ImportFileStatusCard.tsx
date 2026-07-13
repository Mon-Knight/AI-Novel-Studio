import type { SelectedImportFile } from '../../services/import/systemFilePickerService';

export type ImportParseStatus = 'selected' | 'parsing' | 'ready' | 'error';

const STATUS_LABELS: Record<ImportParseStatus, string> = {
  selected: '等待解析',
  parsing: '正在解析',
  ready: '解析完成',
  error: '解析失败',
};

interface ImportFileStatusCardProps {
  file: SelectedImportFile;
  status: ImportParseStatus;
  disabled?: boolean;
  onParse: () => void;
  onReselect: () => void;
}

function ImportFileStatusCard({
  file, status, disabled = false, onParse, onReselect,
}: ImportFileStatusCardProps) {
  return (
    <section className="import-file-card" data-testid="import-file-card">
      <div className="import-file-card-header">
        <strong>{file.name}</strong>
        <span className={`import-file-status status-${status}`}>{STATUS_LABELS[status]}</span>
      </div>
      <div className="import-file-path" title={file.path}>{file.path}</div>
      <div className="import-file-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onReselect} disabled={disabled}>重新选择文件</button>
        {(status === 'selected' || status === 'error') && (
          <button type="button" className="btn btn-primary btn-sm" onClick={onParse} disabled={disabled}>解析并预览</button>
        )}
      </div>
    </section>
  );
}

export default ImportFileStatusCard;
