/**
 * AI Novel Studio - TXT 导入确认弹窗
 */
import { useState, useRef, useEffect } from 'react';
import { CircleCheck, FileText, FolderOpen, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { novelService } from '../../services/novels/novelService';
import { volumeRepository } from '../../services/database/volumeRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { draftVersionService } from '../../services/database/draftVersionService';
import {
  analyzeTxtForChapters,
  importTxtNovel,
  readTextFile,
} from '../../services/import/txtImportService';
import type { TxtAnalyzeResult } from '../../services/import/txtImportService';
import { formatNumber } from '../../utils/format';
import { runWithLoading } from '../../lib/runWithLoading';
import { describeUnknownError } from '../../utils/errorMessage';
import { ModalFrame } from '../common/ModalFrame';

interface ImportTxtDialogProps {
  onClose: () => void;
}

function ImportTxtDialog({ onClose }: ImportTxtDialogProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'select' | 'analyze' | 'importing' | 'done'>('select');
  const [fileName, setFileName] = useState('');
  const [analyzeResult, setAnalyzeResult] = useState<TxtAnalyzeResult | null>(null);
  const [novelTitle, setNovelTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [desc, setDesc] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [resultMsg, setResultMsg] = useState('');
  const closeTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setFileName(file.name);
    try {
      const text = await readTextFile(file);
      if (!text.trim()) {
        setError('文件内容为空');
        return;
      }
      const result = analyzeTxtForChapters(text);
      setAnalyzeResult(result);
      setNovelTitle(file.name.replace(/\.(txt|TXT)$/, '').slice(0, 40));
      setStep('analyze');
    } catch (err: unknown) {
      setError(describeUnknownError(err, '读取失败'));
    }
  };

  const handleImport = async () => {
    if (importing || !analyzeResult || !novelTitle.trim()) return;
    setImporting(true);
    setError('');
    try {
      await runWithLoading(
        {
          title: '正在导入 TXT 文件',
          initialMessage: '正在创建作品和章节……',
          successMessage: `导入成功！共导入章节`,
          errorMessage: '导入失败',
          successAutoCloseMs: 1500,
        },
        async ({ setMessage, setStage, setPercent }) => {
          setStage('创建作品……');
          // 桌面端由 Rust 在单一事务内写入作品、卷、章节与草稿；浏览器模式逐步写入并在失败时级联回收。
          const result = await importTxtNovel(
            {
              title: novelTitle.trim(),
              genre: genre.trim() || undefined,
              description: desc.trim() || undefined,
              chapters: analyzeResult.chapters,
            },
            {
              createNovel: (input) => novelService.createNovel(input),
              createVolume: (input) => volumeRepository.create(input),
              createChapter: (input) =>
                chapterRepository.create({ ...input, targetWordCount: undefined, outline: '' }),
              createDraft: (input) => draftVersionService.create({ ...input, source: 'imported' }),
              deleteNovelCascade: (novelId) => novelService.deleteNovelCascade(novelId),
            },
            (progress) => {
              setStage(progress.stage);
              setMessage(progress.message);
              setPercent(progress.percent);
            },
          );
          setPercent(100);
          setImporting(false);
          setResultMsg(`导入成功！已创建作品《${novelTitle}》，共导入 ${result.chapterCount} 章。`);
          setStep('done');
          closeTimer.current = setTimeout(() => {
            onClose();
            navigate(`/novels/${result.novel.id}`);
          }, 1500);
        },
      );
    } catch (err: unknown) {
      setError(describeUnknownError(err, '导入失败'));
      setImporting(false);
    }
  };

  return (
    <ModalFrame
      title={
        <>
          <FileText aria-hidden="true" size={18} strokeWidth={1.8} />
          导入 TXT 小说
        </>
      }
      maxWidth={540}
      onDismiss={onClose}
      busy={importing}
      closeLabel="关闭 TXT 导入"
      footer={
        step === 'analyze' && analyzeResult ? (
          <>
            <button className="btn btn-secondary btn-sm" onClick={onClose} disabled={importing}>
              取消
            </button>
            <button
              className="btn btn-primary btn-sm"
              data-testid="txt-import-confirm"
              onClick={handleImport}
              disabled={importing || !novelTitle.trim()}
            >
              {importing ? (
                <>
                  <LoaderCircle aria-hidden="true" size={15} strokeWidth={1.8} />
                  导入中...
                </>
              ) : (
                <>
                  <CircleCheck aria-hidden="true" size={15} strokeWidth={1.8} />
                  确认导入
                </>
              )}
            </button>
          </>
        ) : undefined
      }
    >
      {step === 'select' && (
        <div>
          <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--color-text-secondary)' }}>
            选择本地 TXT 文件，系统将自动识别章节标题并智能划分卷章结构。
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '20px 16px',
              border: '1.5px dashed var(--color-border)',
              borderRadius: 8,
              textAlign: 'center',
              cursor: 'pointer',
              background: 'var(--color-bg-hover, #f8fafc)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              color: 'var(--color-text-primary)',
            }}
          >
            <FolderOpen aria-hidden="true" size={26} strokeWidth={1.8} />
            <div style={{ fontSize: 13, fontWeight: 500 }}>点击选择 TXT 文件</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              支持 UTF-8 编码文本
            </div>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            aria-label="选择 TXT 文件"
            data-testid="txt-import-file"
            accept=".txt,.TXT"
            onChange={handleFileSelect}
            hidden
          />
        </div>
      )}

      {step === 'analyze' && analyzeResult && (
        <div>
          <div
            style={{
              fontSize: 13,
              marginBottom: 12,
              padding: 8,
              background: 'var(--color-info-bg)',
              borderRadius: 6,
              border: '1px solid var(--color-info-border)',
            }}
          >
            <FileText
              aria-hidden="true"
              size={16}
              strokeWidth={1.8}
              style={{ verticalAlign: 'text-bottom', marginRight: 6 }}
            />
            {fileName} · {formatNumber(analyzeResult.totalChars)} 字符 ·{' '}
            {formatNumber(analyzeResult.totalWords)} 字
            {analyzeResult.detectedChapterCount > 0 && (
              <>
                {' '}
                · 识别到 <strong>{analyzeResult.detectedChapterCount}</strong> 个章节
              </>
            )}
          </div>
          {analyzeResult.warnings.map((w, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: 'var(--color-warning)',
                marginBottom: 8,
              }}
            >
              <TriangleAlert aria-hidden="true" size={15} strokeWidth={1.8} />
              {w}
            </div>
          ))}
          {analyzeResult.chapters.length <= 6 && (
            <div style={{ fontSize: 12, marginBottom: 12, maxHeight: 150, overflowY: 'auto' }}>
              {analyzeResult.chapters.map((ch, i) => (
                <div key={i} style={{ padding: '2px 0' }}>
                  · {ch.title}（{ch.wordCount} 字）
                </div>
              ))}
            </div>
          )}
          {analyzeResult.chapters.length > 6 && (
            <div style={{ fontSize: 12, marginBottom: 12, color: 'var(--color-text-muted)' }}>
              前 6 章：
              {analyzeResult.chapters
                .slice(0, 6)
                .map((c) => c.title)
                .join(' / ')}{' '}
              ……
            </div>
          )}
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 3 }}>
                  作品名称 *
                </label>
                <input
                  aria-label="作品名称"
                  className="input"
                  value={novelTitle}
                  onChange={(e) => setNovelTitle(e.target.value)}
                  style={{ width: '100%', fontSize: 12, padding: '5px 8px' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 3 }}>
                  题材
                </label>
                <input
                  aria-label="题材"
                  className="input"
                  value={genre}
                  onChange={(e) => setGenre(e.target.value)}
                  placeholder="如：玄幻/科幻/都市"
                  style={{ width: '100%', fontSize: 12, padding: '5px 8px' }}
                />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 3 }}>
                简介
              </label>
              <textarea
                aria-label="简介"
                className="input"
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={2}
                style={{ width: '100%', resize: 'vertical', fontSize: 12, padding: '5px 8px' }}
              />
            </div>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div style={{ textAlign: 'center', padding: 32 }} data-testid="txt-import-done">
          <CircleCheck
            aria-hidden="true"
            size={40}
            strokeWidth={1.8}
            style={{ marginBottom: 12, color: 'var(--color-success)' }}
          />
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-success)' }}>
            {resultMsg}
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: 8,
            background: 'var(--color-error-bg)',
            borderRadius: 6,
            color: 'var(--color-error)',
            fontSize: 13,
            marginTop: 8,
          }}
        >
          {error}
        </div>
      )}
    </ModalFrame>
  );
}

export default ImportTxtDialog;
