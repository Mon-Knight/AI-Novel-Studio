import { useRef, useState } from 'react';
import { generateId, isTauri } from '../../services/database/db';
import { referenceLibraryService } from '../../services/references/referenceLibraryService';
import { analyzeReferenceFile } from '../../services/references/referenceTextParser';
import { describeUnknownError } from '../../utils/errorMessage';
import { formatNumber } from '../../utils/format';
import type {
  ReferenceDuplicateAction,
  ReferenceDuplicateMatch,
  ReferenceFileAnalysis,
  ReferencePurpose,
  ReferenceWork,
} from '../../types/reference';

interface ReferenceImportCardProps {
  novelId: string;
  works: ReferenceWork[];
  onImported: (workId: string) => Promise<void>;
  onStatus: (message: string, error?: boolean) => void;
}

function operationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? generateId();
}

function ReferenceImportCard({ novelId, works, onImported, onStatus }: ReferenceImportCardProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [fileAnalysis, setFileAnalysis] = useState<ReferenceFileAnalysis | null>(null);
  const [duplicates, setDuplicates] = useState<ReferenceDuplicateMatch[]>([]);
  const [duplicateAction, setDuplicateAction] = useState<ReferenceDuplicateAction>('createWork');
  const [duplicateImportId, setDuplicateImportId] = useState('');
  const [targetWorkId, setTargetWorkId] = useState('');
  const [title, setTitle] = useState('');
  const [purpose, setPurpose] = useState<ReferencePurpose>('style');
  const [description, setDescription] = useState('');
  const [sourceFilePath, setSourceFilePath] = useState<string | undefined>();

  const reset = () => {
    setFileAnalysis(null);
    setDuplicates([]);
    setDuplicateAction('createWork');
    setDuplicateImportId('');
    setTitle('');
    setDescription('');
    setSourceFilePath(undefined);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const inspectBytes = async (
    fileName: string,
    bytes: Uint8Array,
    trustedSourceFilePath?: string,
  ) => {
    setBusy(true);
    onStatus('正在校验编码、哈希与章节边界…');
    try {
      const analysis = await analyzeReferenceFile({
        fileName,
        bytes,
      });
      const duplicateResult = await referenceLibraryService.inspectDuplicates(
        novelId,
        analysis.sourceHash,
      );
      setFileAnalysis(analysis);
      setSourceFilePath(trustedSourceFilePath);
      setDuplicates(duplicateResult.matches);
      setTitle(fileName.replace(/\.txt$/iu, ''));
      if (duplicateResult.matches.length > 0) {
        setDuplicateAction('skip');
        setDuplicateImportId(duplicateResult.matches[0].importId);
        setTargetWorkId(duplicateResult.matches[0].workId);
      } else {
        setDuplicateAction('createWork');
        setDuplicateImportId('');
        setTargetWorkId(works[0]?.id ?? '');
      }
      onStatus('文件校验完成，请确认导入决策。');
    } catch (caught: unknown) {
      reset();
      onStatus(describeUnknownError(caught, '参考资料解析失败'), true);
    } finally {
      setBusy(false);
    }
  };

  const inspectFile = async (file: File | undefined) => {
    if (!file) return;
    await inspectBytes(file.name, new Uint8Array(await file.arrayBuffer()));
  };

  const chooseFile = async () => {
    if (!isTauri()) {
      fileInputRef.current?.click();
      return;
    }
    setBusy(true);
    onStatus('正在打开桌面文件选择器…');
    try {
      const [{ open }, { readBinaryFile }] = await Promise.all([
        import('@tauri-apps/api/dialog'),
        import('@tauri-apps/api/fs'),
      ]);
      const selected = await open({
        title: '选择 TXT 参考资料',
        multiple: false,
        directory: false,
        filters: [{ name: 'TXT 文本', extensions: ['txt'] }],
      });
      if (typeof selected !== 'string') {
        onStatus('已取消选择参考资料。');
        return;
      }
      const fileName = selected.split(/[\\/]/u).pop() ?? '';
      const bytes = await readBinaryFile(selected);
      await inspectBytes(fileName, bytes, selected);
    } catch (caught: unknown) {
      reset();
      onStatus(describeUnknownError(caught, '桌面参考资料读取失败'), true);
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!fileAnalysis) return;
    setBusy(true);
    onStatus('正在提交参考资料版本…');
    try {
      const result = await referenceLibraryService.import({
        operationId: operationId(),
        novelId,
        duplicateAction,
        duplicateImportId: duplicateAction === 'skip' ? duplicateImportId : undefined,
        workId: duplicateAction === 'createVersion' ? targetWorkId : undefined,
        title: duplicateAction === 'createWork' ? title : undefined,
        purpose: duplicateAction === 'createWork' ? purpose : undefined,
        description: duplicateAction === 'createWork' ? description : undefined,
        sourceFilePath,
        analysis: fileAnalysis,
      });
      await onImported(result.bundle.work.id);
      reset();
      onStatus(result.created ? '参考资料已保存。' : '检测到相同来源，已保留现有版本。');
    } catch (caught: unknown) {
      onStatus(describeUnknownError(caught, '参考资料导入失败'), true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="reference-import-card" aria-label="导入参考资料">
      <div className="reference-import-title">
        <div>
          <strong>导入 TXT 参考资料</strong>
          <span>支持 UTF-8、UTF-16 与 GB18030，保留原始字节和章节计划哈希。</span>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => void chooseFile()}
        >
          选择 TXT
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".txt,text/plain"
          disabled={busy}
          hidden
          onChange={(event) => void inspectFile(event.target.files?.[0])}
        />
      </div>

      {fileAnalysis && (
        <div className="reference-import-review">
          <div className="reference-file-facts">
            <span>{fileAnalysis.fileName}</span>
            <span>{fileAnalysis.encoding.toUpperCase()}</span>
            <span>{formatNumber(fileAnalysis.totalChars)} 字符</span>
            <span>{fileAnalysis.sections.length} 个片段</span>
            <code>{fileAnalysis.sourceHash.slice(0, 12)}…</code>
          </div>
          {fileAnalysis.warnings.map((warning) => (
            <p className="reference-warning" key={warning}>
              {warning}
            </p>
          ))}
          <div className="reference-decision-row">
            <label>
              导入决策
              <select
                className="panel-select"
                value={duplicateAction}
                onChange={(event) =>
                  setDuplicateAction(event.target.value as ReferenceDuplicateAction)
                }
              >
                <option value="createWork">新建参考作品</option>
                <option value="createVersion" disabled={works.length === 0}>
                  作为已有作品的新版本
                </option>
                <option value="skip" disabled={duplicates.length === 0}>
                  跳过并使用重复版本
                </option>
              </select>
            </label>
            {duplicateAction === 'createWork' && (
              <>
                <label>
                  作品标题
                  <input
                    className="form-input"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </label>
                <label>
                  用途
                  <select
                    className="panel-select"
                    value={purpose}
                    onChange={(event) => setPurpose(event.target.value as ReferencePurpose)}
                  >
                    <option value="style">风格分析</option>
                    <option value="research">资料研究</option>
                    <option value="inspiration">灵感参考</option>
                  </select>
                </label>
              </>
            )}
            {duplicateAction === 'createVersion' && (
              <label>
                目标作品
                <select
                  className="panel-select"
                  value={targetWorkId}
                  onChange={(event) => setTargetWorkId(event.target.value)}
                >
                  {works.map((work) => (
                    <option key={work.id} value={work.id}>
                      {work.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {duplicateAction === 'skip' && (
              <label>
                重复版本
                <select
                  className="panel-select"
                  value={duplicateImportId}
                  onChange={(event) => setDuplicateImportId(event.target.value)}
                >
                  {duplicates.map((match) => (
                    <option key={match.importId} value={match.importId}>
                      {match.workTitle} · v{match.importVersion}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {duplicateAction === 'createWork' && (
            <textarea
              className="form-textarea reference-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="可选：记录这部参考作品的使用范围。"
            />
          )}
          <div className="reference-review-actions">
            <button className="btn btn-secondary" onClick={reset} disabled={busy}>
              取消
            </button>
            <button className="btn btn-primary" onClick={() => void commit()} disabled={busy}>
              {busy ? '提交中…' : '确认导入'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export default ReferenceImportCard;
