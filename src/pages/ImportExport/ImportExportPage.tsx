/**
 * AI Novel Studio - 导入导出中心页面
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import BackButton from '../../components/common/BackButton';
import ImportTxtDialog from '../../components/import/ImportTxtDialog';
import ImportJsonDialog from '../../components/import/ImportJsonDialog';
import { novelRepository } from '../../services/database/novelRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { draftVersionService } from '../../services/database/draftVersionService';
import { exportService } from '../../services/export/exportService';
import type { Novel } from '../../types/novel';
import type { Chapter } from '../../types/chapter';

function ImportExportPage() {
  const navigate = useNavigate();
  const [novels, setNovels] = useState<Novel[]>([]);
  const [selectedNovelId, setSelectedNovelId] = useState('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [exportableChapterIds, setExportableChapterIds] = useState<Set<string>>(new Set());
  const [selectedChapterId, setSelectedChapterId] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [showTxtImport, setShowTxtImport] = useState(false);
  const [showJsonImport, setShowJsonImport] = useState(false);

  const loadNovels = useCallback(async () => {
    const list = await novelRepository.getAll();
    setNovels(list);
    setSelectedNovelId((current) => {
      if (current && list.some((novel) => novel.id === current)) return current;
      return list[0]?.id ?? '';
    });
    if (list.length === 0) {
      setChapters([]);
      setExportableChapterIds(new Set());
      setSelectedChapterId('');
    }
  }, []);

  useEffect(() => {
    void loadNovels();
  }, [loadNovels]);

  useEffect(() => {
    if (!selectedNovelId) {
      setChapters([]);
      setExportableChapterIds(new Set());
      setSelectedChapterId('');
      return;
    }
    let cancelled = false;
    setExportableChapterIds(new Set());
    chapterRepository.getByNovelId(selectedNovelId).then(async (list) => {
      const adoptedIds = new Set((await Promise.all(list.map(async (chapter) => ({
        id: chapter.id,
        draft: await draftVersionService.getAdoptedByChapterId(chapter.id),
      })))).filter((entry) => !!entry.draft?.content).map((entry) => entry.id));
      if (cancelled) return;
      setChapters(list);
      setExportableChapterIds(adoptedIds);
      const adopted = list.filter((chapter) => adoptedIds.has(chapter.id));
      setSelectedChapterId((current) => {
        if (current && adopted.some((chapter) => chapter.id === current)) return current;
        return adopted[0]?.id ?? '';
      });
    }).catch((error: unknown) => {
      if (!cancelled) setErr(error instanceof Error ? error.message : '章节读取失败');
    });
    return () => { cancelled = true; };
  }, [selectedNovelId]);

  const handleExport = async (fn: () => Promise<string | null | void>) => {
    setErr(''); setMsg('导出中...');
    try {
      const savedPath = await fn();
      setMsg(savedPath ? `导出成功：${savedPath}` : '已取消导出');
      setTimeout(() => setMsg(''), 4000);
    }
    catch (e: any) { setErr(e.message || '导出失败'); setMsg(''); }
  };

  const adoptedChapters = chapters.filter((chapter) => exportableChapterIds.has(chapter.id));
  return (
    <div className="page-container form-page" style={{ height: '100%', overflowY: 'auto' }}>
      <BackButton label="返回首页" to="/" />
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>📥 导入导出中心</div>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>导出已采用章节正文或可恢复的项目 JSON 备份，导入作品、风格方案和输出控制</div>

      {msg && <div style={{ padding: '8px 16px', marginBottom: 16, background: 'var(--color-primary-light)', borderRadius: 6, fontSize: 13, color: 'var(--color-primary)' }}>{msg}</div>}
      {err && <div style={{ padding: '8px 16px', marginBottom: 16, background: '#fee2e2', borderRadius: 6, fontSize: 13, color: 'var(--color-error)' }}>{err}</div>}

      {/* 作品选择 */}
      <div className="detail-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>📖</span>
          <span style={{ fontWeight: 600 }}>选择作品</span>
        </div>
        {novels.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 16, color: 'var(--color-text-muted)', fontSize: 13 }}>
            暂无作品，请先在首页创建
          </div>
        ) : (
          <select className="input" value={selectedNovelId} onChange={(e) => setSelectedNovelId(e.target.value)} style={{ width: '100%' }}>
            {novels.map((n) => <option key={n.id} value={n.id}>{n.title}</option>)}
          </select>
        )}
      </div>

      {/* 导出整本作品 */}
      <div className="detail-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>📚</span>
          <span style={{ fontWeight: 600 }}>导出整本作品</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
          已采用章节：{adoptedChapters.length} / {chapters.length} 章
          {adoptedChapters.length === 0 && <span style={{ color: 'var(--color-warning)' }}> — 没有已采用章节可导出</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" disabled={adoptedChapters.length === 0}
            onClick={() => handleExport(() => exportService.exportNovelToTxt(selectedNovelId))}>
            📄 导出 TXT
          </button>
          <button className="btn btn-secondary btn-sm" disabled={adoptedChapters.length === 0}
            onClick={() => handleExport(() => exportService.exportNovelToMarkdown(selectedNovelId))}>
            📝 导出 Markdown
          </button>
          <button className="btn btn-secondary btn-sm" disabled={!selectedNovelId}
            onClick={() => handleExport(() => exportService.exportNovelBackupJson(selectedNovelId))}>
            💾 备份项目 JSON
          </button>
        </div>
      </div>

      {/* 导出章节 */}
      <div className="detail-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>📄</span>
          <span style={{ fontWeight: 600 }}>导出当前章节</span>
        </div>
        {chapters.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: 8 }}>暂无章节</div>
        ) : (
          <select className="input" value={selectedChapterId} onChange={(e) => setSelectedChapterId(e.target.value)} style={{ width: '100%', marginBottom: 8 }}>
            {adoptedChapters.map((c) => <option key={c.id} value={c.id}>第{c.chapterNumber}章 {c.title}（已采用）</option>)}
            {chapters.filter((c) => !adoptedChapters.includes(c)).map((c) => <option key={c.id} value={c.id} disabled>第{c.chapterNumber}章 {c.title}（未采用，无法导出）</option>)}
          </select>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-secondary btn-sm" disabled={!selectedChapterId || !adoptedChapters.some((c) => c.id === selectedChapterId)}
            onClick={() => handleExport(() => exportService.exportChapterToTxt(selectedChapterId))}>
            📄 导出 TXT
          </button>
          <button className="btn btn-secondary btn-sm" disabled={!selectedChapterId || !adoptedChapters.some((c) => c.id === selectedChapterId)}
            onClick={() => handleExport(() => exportService.exportChapterToMarkdown(selectedChapterId))}>
            📝 导出 Markdown
          </button>
        </div>
      </div>

      {/* 导入区域 */}
      <div className="detail-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>📥</span>
          <span style={{ fontWeight: 600 }}>导入</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowTxtImport(true)}>
            📄 导入 TXT
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowJsonImport(true)}>
            📋 导入 JSON
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
          支持导入 TXT 小说文件（自动识别章节标题切分）和 JSON 配置文件（风格方案/输出控制）
        </div>
      </div>

      <button className="btn btn-secondary btn-sm" onClick={() => navigate('/')}>← 返回首页</button>

      {/* 导入弹窗 */}
      {showTxtImport && <ImportTxtDialog onClose={() => { setShowTxtImport(false); void loadNovels(); }} />}
      {showJsonImport && <ImportJsonDialog onClose={() => { setShowJsonImport(false); void loadNovels(); }} />}
    </div>
  );
}

export default ImportExportPage;
