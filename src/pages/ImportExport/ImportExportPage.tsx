/**
 * AI Novel Studio - 导入导出中心页面
 * 统一风格方案管理 UI 结构设计
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowDownToLine, FileJson, Upload } from 'lucide-react';
import BackButton from '../../components/common/BackButton';
import { PageHeader, PageLayout, PageTabs } from '../../components/common/PageLayout';
import ImportTxtDialog from '../../components/import/ImportTxtDialog';
import ImportJsonDialog from '../../components/import/ImportJsonDialog';
import { novelRepository } from '../../services/database/novelRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { exportService } from '../../services/export/exportService';
import {
  formatExportProgress,
  hasFormalChapter,
  type ManuscriptExportOptions,
} from '../../services/export/manuscriptExport';
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
  const [exporting, setExporting] = useState(false);
  const exportActive = useRef(false);
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
      const adopted = list.filter(hasFormalChapter);
      setSelectedChapterId((current) => {
        if (current && adopted.some((chapter) => chapter.id === current)) return current;
        return adopted[0]?.id ?? '';
      });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedNovelId]);

  const handleExport = async (fn: (options: ManuscriptExportOptions) => Promise<string | void>) => {
    if (exportActive.current) return;
    exportActive.current = true;
    setExporting(true);
    setErr('');
    setMsg('导出中...');
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
      exportActive.current = false;
      setExporting(false);
    }
  };

  const pageActions = (
    <>
      {activeTab === 'import' && (
        <div className="resource-row resource-row--wrap">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-testid="project-import-txt"
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
    </>
  );
  return (
    <PageLayout>
      <BackButton label="返回工作台" to="/" />
      <PageHeader
        title="导入导出中心"
        description="导出已采用章节正文、Markdown 排版与完整 JSON 备份；导入外部小说原稿与配置资产。"
        icon={ArrowDownToLine}
        actions={pageActions}
      />

      {msg && (
        <div className="resource-notice resource-notice--success" role="status">
          {msg}
        </div>
      )}
      {err && (
        <div className="resource-notice resource-notice--error" role="alert">
          {err}
        </div>
      )}

      <PageTabs<ImportExportTab>
        label="导入导出分类"
        value={activeTab}
        onChange={setActiveTab}
        items={[
          { value: 'export', label: '作品导出', count: novels.length > 0 ? 3 : 0 },
          { value: 'import', label: '数据导入', count: 2, testId: 'project-import-tab' },
        ]}
      >
        {activeTab === 'export' && (
          <NovelExportSection
            busy={exporting}
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
      </PageTabs>

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
    </PageLayout>
  );
}

export default ImportExportPage;
