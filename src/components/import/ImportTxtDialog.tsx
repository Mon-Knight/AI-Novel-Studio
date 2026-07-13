/**
 * AI Novel Studio - TXT 系统文件导入
 */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { runWithLoading } from '../../lib/runWithLoading';
import { importTxtNovel } from '../../services/import/projectImportService';
import {
  parseTxtImportPreview,
  type TxtImportPreview,
} from '../../services/import/importPreviewService';
import {
  systemFilePickerService,
  type SelectedImportFile,
} from '../../services/import/systemFilePickerService';
import { describeUnknownError } from '../../utils/errorMessage';
import { formatNumber } from '../../utils/format';
import ImportFileStatusCard, { type ImportParseStatus } from './ImportFileStatusCard';
import '../../styles/import-dialog.css';

interface ImportTxtDialogProps {
  onClose: () => void;
}

function ImportTxtDialog({ onClose }: ImportTxtDialogProps) {
  const navigate = useNavigate();
  const importLock = useRef(false);
  const [selectedFile, setSelectedFile] = useState<SelectedImportFile | null>(null);
  const [parseStatus, setParseStatus] = useState<ImportParseStatus>('selected');
  const [preview, setPreview] = useState<TxtImportPreview | null>(null);
  const [novelTitle, setNovelTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [description, setDescription] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [doneMessage, setDoneMessage] = useState('');
  const [error, setError] = useState('');

  const resetSelectionState = () => {
    setSelectedFile(null);
    setParseStatus('selected');
    setPreview(null);
    setNovelTitle('');
    setGenre('');
    setDescription('');
    setDoneMessage('');
    setError('');
  };

  const handleChooseFile = async () => {
    if (selecting || importing) return;
    resetSelectionState();
    setSelecting(true);
    try {
      const file = await systemFilePickerService.select('txt');
      if (!file) return;
      setSelectedFile(file);
      setParseStatus('selected');
    } catch (selectionError) {
      setError(describeUnknownError(selectionError, '选择文件失败'));
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
      const nextPreview = parseTxtImportPreview(content, selectedFile.name);
      setPreview(nextPreview);
      setNovelTitle(nextPreview.suggestedTitle);
      setParseStatus('ready');
    } catch (parseError) {
      setParseStatus('error');
      setError(describeUnknownError(parseError, 'TXT 解析失败'));
    }
  };

  const handleImport = async () => {
    if (importLock.current || !preview || parseStatus !== 'ready' || !novelTitle.trim()) return;
    importLock.current = true;
    setImporting(true);
    setError('');
    try {
      const result = await runWithLoading(
        {
          title: '正在导入 TXT 文件',
          initialMessage: '正在创建作品和章节……',
          successMessage: '导入成功',
          errorMessage: '导入失败',
          successAutoCloseMs: 1200,
        },
        async ({ setMessage, setStage, setPercent }) => {
          setStage('创建作品');
          return importTxtNovel({
            title: novelTitle,
            genre,
            description,
            analysis: preview.analysis,
            onProgress: ({ stage, current, total }) => {
              setStage(`正在写入：${stage}`);
              setMessage(`正在导入并采用章节 ${current} / ${total}……`);
              setPercent(Math.round((current / Math.max(total, 1)) * 90));
            },
          });
        },
      );
      setDoneMessage(`已创建作品《${result.novelTitle}》，共导入并采用 ${result.adoptedChapterCount} 章。`);
      setTimeout(() => {
        onClose();
        navigate(`/novels/${result.novelId}`);
      }, 1500);
    } catch (importError) {
      setError(describeUnknownError(importError, '导入失败，未写入不完整作品'));
    } finally {
      importLock.current = false;
      setImporting(false);
    }
  };

  const closeIfIdle = () => {
    if (!importing) onClose();
  };

  return (
    <div className="modal-overlay import-dialog-overlay" onClick={closeIfIdle} role="presentation">
      <div
        className="modal-dialog import-dialog-modal import-dialog-modal-txt"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="导入 TXT"
      >
        <header className="import-dialog-header">
          <span>导入 TXT</span>
          <button type="button" onClick={closeIfIdle} disabled={importing} aria-label="关闭">×</button>
        </header>

        {!doneMessage && (
          <>
            <p className="import-dialog-description">
              请选择 UTF-8 编码的 TXT 小说文本。文件只会在解析通过并确认预览后写入。
            </p>
            {!selectedFile ? (
              <section className="import-file-picker">
                <div className="import-file-picker-icon">📄</div>
                <p>当前仅支持 .txt 文件</p>
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
              <section className="import-preview-card" data-testid="txt-import-preview">
                <div className="import-preview-title">导入预览</div>
                <div className="import-preview-summary">
                  {formatNumber(preview.analysis.totalChars)} 字符 · {formatNumber(preview.analysis.totalWords)} 字 · {preview.analysis.chapters.length} 章
                </div>
                {preview.analysis.warnings.map((warning) => (
                  <div key={warning} className="import-preview-warning">⚠ {warning}</div>
                ))}
                <div className="import-preview-list">
                  {preview.analysis.chapters.map((chapter, index) => (
                    <div key={`${chapter.title}-${index}`}>{index + 1}. {chapter.title}（{chapter.wordCount} 字）</div>
                  ))}
                </div>
                <div className="import-form-grid">
                  <label>
                    <span>作品名称 *</span>
                    <input className="input" value={novelTitle} onChange={(event) => setNovelTitle(event.target.value)} />
                  </label>
                  <label>
                    <span>题材</span>
                    <input className="input" value={genre} onChange={(event) => setGenre(event.target.value)} placeholder="如：玄幻 / 科幻 / 都市" />
                  </label>
                  <label>
                    <span>简介</span>
                    <textarea className="input" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
                  </label>
                </div>
                <div className="import-confirm-note">确认后将创建新作品，并把预览中的章节写入为已采用正文。</div>
                <div className="import-dialog-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={closeIfIdle} disabled={importing}>取消</button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleImport}
                    disabled={importing || !novelTitle.trim()}
                    data-testid="confirm-txt-import"
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
    </div>
  );
}

export default ImportTxtDialog;
