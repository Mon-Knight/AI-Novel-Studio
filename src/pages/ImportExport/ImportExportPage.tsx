/**
 * AI Novel Studio - 导入导出中心页面
 * 统一风格方案管理 UI 结构设计
 */
import { useState, useEffect, useCallback } from 'react';
import { ArrowDownToLine, FileJson, Upload } from 'lucide-react';
import BackButton from '../../components/common/BackButton';
import ImportTxtDialog from '../../components/import/ImportTxtDialog';
import ImportJsonDialog from '../../components/import/ImportJsonDialog';
import { novelRepository } from '../../services/database/novelRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { exportService } from '../../services/export/exportService';
import type { Novel } from '../../types/novel';
import type { Chapter } from '../../types/chapter';
import { describeUnknownError } from '../../utils/errorMessage';
import { NovelExportSection, NovelImportSection } from './ImportExportSections';

type ImportExportTab = 'export' | 'import';

function ImportExportPage() {
  const [activeTab, setActiveTab] = useState<ImportExportTab>('export');
  const [novels, setNovels] = useState<Novel[]>([]);
  const [selectedNovelId, setSelectedNovelId] = useState('');
  const [chapters, setChapters] = useState<Chapter[]>([]);
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
      setSelectedChapterId('');
    }
  }, []);

  useEffect(() => {
    void loadNovels();
  }, [loadNovels]);

  useEffect(() => {
    if (!selectedNovelId) {
      setChapters([]);
      setSelectedChapterId('');
      return;
    }
    let cancelled = false;
    chapterRepository.getByNovelId(selectedNovelId).then((list) => {
      if (cancelled) return;
      setChapters(list);
      const adopted = list.filter((c) => c.status === 'adopted' || c.status === 'summarized');
      setSelectedChapterId((current) => {
        if (current && adopted.some((chapter) => chapter.id === current)) return current;
        return adopted[0]?.id ?? '';
      });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedNovelId]);

  const handleExport = async (fn: () => Promise<string | void>) => {
    setErr('');
    setMsg('导出中...');
    try {
      const savedPath = await fn();
      setMsg(savedPath ? `导出成功：${savedPath}` : '导出成功！');
      setTimeout(() => setMsg(''), 4000);
    } catch (e: unknown) {
      setErr(describeUnknownError(e, '导出失败'));
      setMsg('');
    }
  };

  return (
    <div
      style={{
        padding: 32,
        maxWidth: 1000,
        margin: '0 auto',
        height: '100%',
        overflowY: 'auto',
      }}
    >
      <BackButton label="返回工作台" to="/" />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 22,
          fontWeight: 700,
          marginBottom: 8,
          marginTop: 12,
        }}
      >
        <ArrowDownToLine aria-hidden="true" size={22} strokeWidth={1.8} />
        导入导出中心
      </div>
      <div className="text-sm text-muted" style={{ marginBottom: 20 }}>
        导出已采用章节正文、Markdown 排版与完整 JSON 备份；导入外部小说原稿与配置资产。
      </div>

      {msg && (
        <div
          style={{
            fontSize: 13,
            padding: '6px 12px',
            background: 'var(--color-primary-light, #e0e7ff)',
            borderRadius: 6,
            marginBottom: 16,
            color: 'var(--color-primary, #4338ca)',
          }}
        >
          {msg}
        </div>
      )}
      {err && (
        <div
          style={{
            fontSize: 13,
            padding: '6px 12px',
            background: 'var(--color-error-bg, #fee2e2)',
            borderRadius: 6,
            marginBottom: 16,
            color: 'var(--color-error, #b91c1c)',
          }}
        >
          {err}
        </div>
      )}

      {/* 统一 Tab 导航条 */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          marginBottom: 20,
          borderBottom: '2px solid var(--color-border)',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex' }}>
          <button
            type="button"
            onClick={() => setActiveTab('export')}
            style={{
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: activeTab === 'export' ? 600 : 400,
              color:
                activeTab === 'export' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              borderBottom:
                activeTab === 'export' ? '2px solid var(--color-primary)' : '2px solid transparent',
              marginBottom: -2,
              background: 'none',
              cursor: 'pointer',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
            }}
          >
            作品导出 ({novels.length > 0 ? 3 : 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('import')}
            style={{
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: activeTab === 'import' ? 600 : 400,
              color:
                activeTab === 'import' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
              borderBottom:
                activeTab === 'import' ? '2px solid var(--color-primary)' : '2px solid transparent',
              marginBottom: -2,
              background: 'none',
              cursor: 'pointer',
              borderTop: 'none',
              borderLeft: 'none',
              borderRight: 'none',
            }}
          >
            数据导入 (2)
          </button>
        </div>

        {activeTab === 'import' && (
          <div style={{ display: 'flex', gap: 8, paddingBottom: 6 }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setShowTxtImport(true)}
            >
              <Upload aria-hidden="true" size={15} strokeWidth={1.8} />
              导入 TXT
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowJsonImport(true)}
            >
              <FileJson aria-hidden="true" size={15} strokeWidth={1.8} />
              导入 JSON
            </button>
          </div>
        )}
      </div>

      {activeTab === 'export' && (
        <NovelExportSection
          novels={novels}
          selectedNovelId={selectedNovelId}
          onSelectNovelId={setSelectedNovelId}
          chapters={chapters}
          selectedChapterId={selectedChapterId}
          onSelectChapterId={setSelectedChapterId}
          onExport={handleExport}
          exportNovelToTxt={exportService.exportNovelToTxt}
          exportNovelToMarkdown={exportService.exportNovelToMarkdown}
          exportNovelBackupJson={exportService.exportNovelBackupJson}
          exportChapterToTxt={exportService.exportChapterToTxt}
          exportChapterToMarkdown={exportService.exportChapterToMarkdown}
        />
      )}

      {activeTab === 'import' && (
        <NovelImportSection
          onOpenTxt={() => setShowTxtImport(true)}
          onOpenJson={() => setShowJsonImport(true)}
        />
      )}

      {showTxtImport && (
        <ImportTxtDialog
          onClose={() => {
            setShowTxtImport(false);
            void loadNovels();
          }}
        />
      )}
      {showJsonImport && (
        <ImportJsonDialog
          onClose={() => {
            setShowJsonImport(false);
            void loadNovels();
          }}
        />
      )}
    </div>
  );
}

export default ImportExportPage;
