import { useState, useEffect, useCallback } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterDraft } from '../../../types/ai';
import type { PolishMode, PolishRequestOptions } from '../../../types/polish';
import { PolishModeLabels } from '../../../types/polish';
import { polishService } from '../../../services/quality/polishService';
import { polishAiService } from '../../../services/ai/polishAiService';
import { draftVersionService } from '../../../services/database/draftVersionService';

interface PolishPanelProps {
  novelId?: string; chapter?: Chapter;
  onGenerated?: (draft: ChapterDraft) => void; onAdopted?: () => void;
}

const POLISH_MODES: PolishMode[] = ['keep_plot', 'enhance_description', 'reduce_redundancy', 'strengthen_conflict', 'adjust_pacing', 'unify_style', 'fix_language', 'custom'];

function PolishPanel({ novelId, chapter, onGenerated, onAdopted }: PolishPanelProps) {
  const [mode, setMode] = useState<PolishMode>('keep_plot');
  const [customInstruction, setCustomInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [currentDraft, setCurrentDraft] = useState<ChapterDraft | null>(null);

  const loadDraft = useCallback(async () => {
    if (!chapter?.id) return;
    setCurrentDraft(await draftVersionService.getLatestByChapterId(chapter.id));
  }, [chapter?.id]);

  useEffect(() => { loadDraft(); }, [loadDraft]);

  const handleRunPolish = async () => {
    if (!novelId || !chapter || !currentDraft) return;
    if (currentDraft.content.length < 10) { setError('正文过短，无法润色'); return; }
    setLoading(true); setError(''); setStatusMsg('正在润色正文...');
    try {
      const options: PolishRequestOptions = {
        mode, customInstruction: customInstruction.trim() || undefined,
        preservePlot: true, preserveCharacters: true, preserveKeyEvents: true,
      };
      const record = await polishService.create({ novelId, chapterId: chapter.id, sourceDraftId: currentDraft.id, mode, instruction: customInstruction.trim() || undefined });
      const polishedText = await polishAiService.runPolish({
        novelId, chapterId: chapter.id, sourceDraftId: currentDraft.id,
        draftContent: currentDraft.content, chapterTitle: chapter.title,
        chapterOutline: chapter.outline, options,
      });
      const resultDraft = await draftVersionService.create({
        novelId, chapterId: chapter.id,
        content: polishedText, source: 'ai_polished',
        note: `${PolishModeLabels[mode]}润色`,
      });
      await polishService.update(record.id, { status: 'succeeded', resultDraftId: resultDraft.id });
      setStatusMsg(`润色完成！已保存为草稿 v${resultDraft.versionNo}`);
      onGenerated?.(resultDraft);
    } catch (e: any) { setError(e.message || '润色失败'); }
    finally { setLoading(false); }
  };

  if (!chapter) return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择章节</div>;

  return (
    <div>
      <div className="panel-section">
        <div className="panel-section-title">✨ 润色模式</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>第{chapter.chapterNumber}章 {chapter.title}</div>
        {currentDraft && <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>草稿 v{currentDraft.versionNo}（{currentDraft.wordCount} 字）</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {POLISH_MODES.map((m) => (
            <button key={m} className={`btn btn-sm ${mode === m ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setMode(m)}>
              {PolishModeLabels[m]}
            </button>
          ))}
        </div>
        {mode === 'custom' && (
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>自定义要求</label>
            <textarea className="input" value={customInstruction} onChange={(e) => setCustomInstruction(e.target.value)} rows={2} placeholder="输入润色具体要求..." style={{ width: '100%', resize: 'vertical', fontSize: 12 }} />
          </div>
        )}
      </div>

      <div className="panel-section">
        <button className="btn btn-primary btn-sm" onClick={handleRunPolish} disabled={loading} style={{ width: '100%' }}>
          {loading ? '⏳ 润色中...' : '✨ 开始润色'}
        </button>
        {error && <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 6 }}>{error}</div>}
        {statusMsg && <div style={{ fontSize: 12, color: 'var(--color-success)', marginTop: 6 }}>{statusMsg}</div>}
      </div>

      <div className="panel-section" style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.6 }}>
        <div>润色结果将保存为新的草稿版本，不会覆盖当前正文。</div>
        <div style={{ marginTop: 4 }}>✔ 保持剧情不变</div>
        <div>✔ 保持人物关系</div>
        <div>✔ 保持关键事件</div>
      </div>
    </div>
  );
}

export default PolishPanel;
