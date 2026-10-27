/**
 * AI Novel Studio - 作品详情页导出卡片
 */
import { useRef, useState } from 'react';
import { Download, FileJson, FileText } from 'lucide-react';
import { exportService } from '../../services/export/exportService';
import { describeUnknownError } from '../../utils/errorMessage';
import {
  formatExportProgress,
  type ManuscriptExportOptions,
} from '../../services/export/manuscriptExport';

interface ExportCardProps {
  novelId: string;
  novelTitle: string;
}

function ExportCard({ novelId }: ExportCardProps) {
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const exporting = useRef(false);

  const handleExport = async (fn: (options: ManuscriptExportOptions) => Promise<string | void>) => {
    if (exporting.current) return;
    exporting.current = true;
    setBusy(true);
    setErr('');
    setMsg('正在导出...');
    try {
      let receipt = '导出成功';
      const savedPath = await fn({
        onProgress: (progress) => {
          const message = formatExportProgress(progress);
          if (progress.stage === 'complete') receipt = message;
          setMsg(message);
        },
      });
      setMsg(savedPath ? `${receipt}：${savedPath}` : receipt);
    } catch (e: unknown) {
      setErr(describeUnknownError(e, '导出失败'));
      setMsg('');
    } finally {
      exporting.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="detail-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Download aria-hidden="true" size={18} strokeWidth={1.8} />
        <span style={{ fontSize: 16, fontWeight: 600 }}>导出作品</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() =>
            handleExport((options) => exportService.exportNovelToTxt(novelId, options))
          }
        >
          <FileText aria-hidden="true" size={14} strokeWidth={1.8} />
          导出整本 TXT
        </button>
        <button
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() =>
            handleExport((options) => exportService.exportNovelToMarkdown(novelId, options))
          }
        >
          <FileText aria-hidden="true" size={14} strokeWidth={1.8} />
          导出整本 Markdown
        </button>
        <button
          className="btn btn-secondary btn-sm"
          disabled={busy}
          onClick={() => handleExport(() => exportService.exportNovelBackupJson(novelId))}
        >
          <FileJson aria-hidden="true" size={14} strokeWidth={1.8} />
          备份完整 JSON
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
        仅导出已采用的章节正文。完整 JSON 可在桌面版恢复为新的作品。
      </div>
      {msg && (
        <div role="status" style={{ fontSize: 12, color: 'var(--color-success)', marginTop: 4 }}>
          {msg}
        </div>
      )}
      {err && (
        <div
          role="alert"
          style={{
            fontSize: 12,
            color: 'var(--color-error)',
            marginTop: 4,
            whiteSpace: 'pre-wrap',
          }}
        >
          {err}
        </div>
      )}
    </div>
  );
}

export default ExportCard;
