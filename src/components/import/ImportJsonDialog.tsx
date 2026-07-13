/**
 * AI Novel Studio - JSON 系统文件导入
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { runWithLoading } from '../../lib/runWithLoading';
import {
  executeJsonImport,
  jsonImportTypeLabel,
} from '../../services/import/jsonImportExecutionService';
import {
  parseJsonImportPreview,
  type JsonImportPreview,
} from '../../services/import/importPreviewService';
import {
  systemFilePickerService,
  type SelectedImportFile,
} from '../../services/import/systemFilePickerService';
import ImportFileStatusCard, { type ImportParseStatus } from './ImportFileStatusCard';
import '../../styles/import-dialog.css';

interface ImportJsonDialogProps {
  onClose: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function ImportJsonDialog({ onClose }: ImportJsonDialogProps) {
  const navigate = useNavigate();
  const importLock = useRef(false);
  const [selectedFile, setSelectedFile] = useState<SelectedImportFile | null>(null);
  const [parseStatus, setParseStatus] = useState<ImportParseStatus>('selected');
  const [preview, setPreview] = useState<JsonImportPreview | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [doneMessage, setDoneMessage] = useState('');
  const [error, setError] = useState('');

  const resetSelectionState = () => {
    setSelectedFile(null);
    setParseStatus('selected');
    setPreview(null);
    setDoneMessage('');
    setError('');
  };

  const handleChooseFile = async () => {
    if (selecting || importing) return;
    resetSelectionState();
    setSelecting(true);
    try {
      const file = await systemFilePickerService.select('json');
      if (!file) return;
      setSelectedFile(file);
      setParseStatus('selected');
    } catch (selectionError) {
      setError(errorMessage(selectionError, '选择文件失败'));
    } finally {
      setSelecting(false);
    }
  };

  const handleParse = async () => {
    if (!selectedFile || importing || parseStatus === 'parsing') return;
    setError('');
    setPreview(null);
    setParseStatus('parsing');
    try {
      const content = await systemFilePickerService.readText(selectedFile);
      const nextPreview = parseJsonImportPreview(content);
      setPreview(nextPreview);
      setParseStatus('ready');
    } catch (parseError) {
      setParseStatus('error');
      setError(errorMessage(parseError, 'JSON 解析失败'));
    }
  };

  const handleImport = async () => {
    if (importLock.current || !preview || parseStatus !== 'ready') return;
    importLock.current = true;
    setImporting(true);
    setError('');
    try {
      const result = await runWithLoading(
        {
          title: '正在导入 JSON 文件',
          initialMessage: `正在导入${jsonImportTypeLabel(preview.detection.type)}……`,
          successMessage: '导入成功',
          errorMessage: '导入失败',
          successAutoCloseMs: 1200,
        },
        async ({ setMessage }) => executeJsonImport(preview, setMessage),
      );
      setDoneMessage(result.message);
      setTimeout(() => {
        onClose();
        navigate(result.destination);
      }, 1500);
    } catch (importError) {
      setError(errorMessage(importError, '导入失败，未写入不完整数据'));
    } finally {
      importLock.current = false;
      setImporting(false);
    }
  };

  const closeIfIdle = () => {
    if (!importing) onClose();
  };

  return (
    <>
      <div className="modal-overlay" onClick={closeIfIdle} />
      <div
        className="modal-content"
        style={{ maxWidth: 560, width: '90%', maxHeight: '82vh', overflowY: 'auto' }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="导入 JSON"
      >
        <header className="import-dialog-header">
          <span>导入 JSON</span>
          <button type="button" onClick={closeIfIdle} disabled={importing} aria-label="关闭">×</button>
        </header>

        {!doneMessage && (
          <>
            <p className="import-dialog-description">
              支持 AI Novel Studio 项目备份、风格方案和输出控制方案。解析预览不会写入数据。
            </p>
            {!selectedFile ? (
              <section className="import-file-picker">
                <div className="import-file-picker-icon">📋</div>
                <p>当前仅支持 .json 文件</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={handleChooseFile} disabled={selecting}>
                  {selecting ? '正在打开系统窗口……' : '选择文件'}
                </button>
              </section>
            ) : (
              <ImportFileStatusCard
                file={selectedFile}
                status={parseStatus}
                disabled={selecting || importing || parseStatus === 'parsing'}
                onParse={handleParse}
                onReselect={handleChooseFile}
              />
            )}

            {preview && parseStatus === 'ready' && (
              <section className="import-preview-card" data-testid="json-import-preview">
                <div className="import-preview-title">导入预览</div>
                <dl className="import-preview-details">
                  <div><dt>类型</dt><dd>{jsonImportTypeLabel(preview.detection.type)}</dd></div>
                  {preview.detection.name && <div><dt>名称</dt><dd>{preview.detection.name}</dd></div>}
                  {preview.detection.summary && <div><dt>摘要</dt><dd>{preview.detection.summary}</dd></div>}
                </dl>
                <div className="import-confirm-note">确认后才会正式写入；项目备份将创建一个新作品。</div>
                <div className="import-dialog-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={closeIfIdle} disabled={importing}>取消</button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleImport}
                    disabled={importing}
                    data-testid="confirm-json-import"
                  >
                    {importing ? '正在导入……' : '确认导入'}
                  </button>
                </div>
              </section>
            )}
          </>
        )}

        {doneMessage && (
          <div className="import-done" role="status">
            <div>✓</div>
            <strong>{doneMessage}</strong>
          </div>
        )}
        {error && <div className="import-error" role="alert">{error}</div>}
      </div>
    </>
  );
}

export default ImportJsonDialog;
