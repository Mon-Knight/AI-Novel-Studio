/**
 * AI Novel Studio - 作品详情页导出卡片
 */
import { useState } from 'react';
import { exportService } from '../../services/export/exportService';

interface ExportCardProps { novelId: string; novelTitle: string; }

function ExportCard({ novelId, novelTitle }: ExportCardProps) {
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const handleExport = async (fn: () => Promise<void>) => {
    setErr(''); setMsg('正在导出...');
    try { await fn(); setMsg('导出成功！'); setTimeout(() => setMsg(''), 2000); }
    catch (e: any) { setErr(e.message || '导出失败'); setMsg(''); }
  };

  return (
    <div className="detail-card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 18 }}>📥</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>导出作品</span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => handleExport(() => exportService.exportNovelToTxt(novelId))}>
          📄 导出整本 TXT
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => handleExport(() => exportService.exportNovelToMarkdown(novelId))}>
          📝 导出整本 Markdown
        </button>
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
        仅导出已采用的章节正文。未采用的章节不会被导出。
      </div>
      {msg && <div style={{ fontSize: 12, color: 'var(--color-success)', marginTop: 4 }}>{msg}</div>}
      {err && <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 4 }}>{err}</div>}
    </div>
  );
}

export default ExportCard;
