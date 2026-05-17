/**
 * AI Novel Studio - TXT 导入确认弹窗
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { novelRepository } from '../../services/database/novelRepository';
import { volumeRepository } from '../../services/database/volumeRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { draftVersionService } from '../../services/database/draftVersionService';
import { readTextFile, analyzeTxtForChapters } from '../../services/import/txtImportService';
import type { TxtAnalyzeResult } from '../../services/import/txtImportService';

interface ImportTxtDialogProps {
  onClose: () => void;
}

function ImportTxtDialog({ onClose }: ImportTxtDialogProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<'select' | 'analyze' | 'importing' | 'done'>('select');
  const [fileName, setFileName] = useState('');
  const [content, setContent] = useState('');
  const [analyzeResult, setAnalyzeResult] = useState<TxtAnalyzeResult | null>(null);
  const [novelTitle, setNovelTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [desc, setDesc] = useState('');
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [resultMsg, setResultMsg] = useState('');

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setFileName(file.name);
    try {
      const text = await readTextFile(file);
      if (!text.trim()) { setError('文件内容为空'); return; }
      setContent(text);
      const result = analyzeTxtForChapters(text);
      setAnalyzeResult(result);
      setNovelTitle(file.name.replace(/\.(txt|TXT)$/, '').slice(0, 40));
      setStep('analyze');
    } catch (err: any) { setError(err.message || '读取失败'); }
  };

  const handleImport = async () => {
    if (!analyzeResult || !novelTitle.trim()) return;
    setImporting(true); setError('');
    try {
      const novel = await novelRepository.create({ title: novelTitle.trim(), genre: genre.trim() || undefined, description: desc.trim() || '由 TXT 导入' });
      const volume = await volumeRepository.create({ novelId: novel.id, title: '第一卷', orderIndex: 1 });
      let count = 0;
      for (const ch of analyzeResult.chapters) {
        const chapter = await chapterRepository.create({
          novelId: novel.id, volumeId: volume.id, title: ch.title,
          orderIndex: ch.orderIndex, targetWordCount: undefined, outline: '',
        });
        await draftVersionService.create({
          novelId: novel.id, chapterId: chapter.id,
          content: ch.content, source: 'imported',
        });
        count++;
      }
      setImporting(false);
      setResultMsg(`导入成功！已创建作品《${novelTitle}》，共导入 ${count} 章。`);
      setStep('done');
      setTimeout(() => { onClose(); navigate(`/novels/${novel.id}`); }, 1500);
    } catch (err: any) { setError(err.message || '导入失败'); setImporting(false); }
  };

  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal-content" style={{ maxWidth: 580, width: '90%', maxHeight: '80vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>📄 导入 TXT</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>✕</button>
        </div>

        {step === 'select' && (
          <div>
            <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--color-text-secondary)' }}>
              选择要导入的 TXT 文件，支持 UTF-8 编码的中文小说文本。
            </div>
            <label style={{ display: 'block', padding: 32, border: '2px dashed var(--color-border-light)', borderRadius: 8, textAlign: 'center', cursor: 'pointer' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
              <div style={{ fontSize: 14 }}>点击选择 TXT 文件</div>
              <input type="file" accept=".txt,.TXT" onChange={handleFileSelect} style={{ display: 'none' }} />
            </label>
          </div>
        )}

        {step === 'analyze' && analyzeResult && (
          <div>
            <div style={{ fontSize: 13, marginBottom: 12, padding: 8, background: '#f0f9ff', borderRadius: 6, border: '1px solid #bae6fd' }}>
              📄 {fileName} · {analyzeResult.totalChars.toLocaleString()} 字符 · {analyzeResult.totalWords.toLocaleString()} 字
              {analyzeResult.detectedChapterCount > 0 && <> · 识别到 <strong>{analyzeResult.detectedChapterCount}</strong> 个章节</>}
            </div>
            {analyzeResult.warnings.map((w, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--color-warning)', marginBottom: 8 }}>⚠️ {w}</div>
            ))}
            {analyzeResult.chapters.length <= 6 && (
              <div style={{ fontSize: 12, marginBottom: 12, maxHeight: 150, overflowY: 'auto' }}>
                {analyzeResult.chapters.map((ch, i) => <div key={i} style={{ padding: '2px 0' }}>· {ch.title}（{ch.wordCount} 字）</div>)}
              </div>
            )}
            {analyzeResult.chapters.length > 6 && (
              <div style={{ fontSize: 12, marginBottom: 12, color: 'var(--color-text-muted)' }}>
                前 6 章：{analyzeResult.chapters.slice(0, 6).map((c) => c.title).join(' / ')} ……
              </div>
            )}
            <div style={{ display: 'grid', gap: 8 }}>
              <div>
                <label style={{ fontSize: 12 }}>作品名称 *</label>
                <input className="input" value={novelTitle} onChange={(e) => setNovelTitle(e.target.value)} style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 12 }}>题材</label>
                <input className="input" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="如：玄幻/科幻/都市" style={{ width: '100%' }} />
              </div>
              <div>
                <label style={{ fontSize: 12 }}>简介</label>
                <textarea className="input" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} style={{ width: '100%', resize: 'vertical' }} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn btn-secondary btn-sm" onClick={onClose}>取消</button>
              <button className="btn btn-primary btn-sm" onClick={handleImport} disabled={importing || !novelTitle.trim()}>
                {importing ? '⏳ 导入中...' : '✅ 确认导入'}
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-success)' }}>{resultMsg}</div>
          </div>
        )}

        {error && <div style={{ padding: 8, background: '#fee2e2', borderRadius: 6, color: 'var(--color-error)', fontSize: 13, marginTop: 8 }}>{error}</div>}
      </div>
    </>
  );
}

export default ImportTxtDialog;
