import { useState, useEffect, useCallback } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterDraft } from '../../../types/ai';
import type { PolishMode, PolishRequestOptions } from '../../../types/polish';
import { PolishModeLabels } from '../../../types/polish';
import { polishService } from '../../../services/quality/polishService';
import { polishAiService } from '../../../services/ai/polishAiService';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { aiSettingsService } from '../../../services/ai/aiClient';
import { runWithLoading } from '../../../lib/runWithLoading';

interface PolishPanelProps {
  novelId?: string; chapter?: Chapter;
  onGenerated?: (draft: ChapterDraft) => void; onAdopted?: () => void;
  currentEditorContent?: string;
  currentEditorDirty?: boolean;
  currentEditorWordCount?: number;
}

const POLISH_MODES: PolishMode[] = ['keep_plot', 'enhance_description', 'reduce_redundancy', 'strengthen_conflict', 'adjust_pacing', 'unify_style', 'fix_language', 'custom'];

function PolishPanel({ novelId, chapter, onGenerated, currentEditorContent, currentEditorDirty, currentEditorWordCount }: PolishPanelProps) {
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
    const sourceContent = (currentEditorContent ?? currentDraft.content).trim();
    const sourceWordCount = currentEditorWordCount ?? currentDraft.wordCount;
    if (sourceContent.length < 10 || sourceWordCount < 10) { setError('正文过短，无法润色'); return; }
    setLoading(true); setError(''); setStatusMsg('');

    try {
      await runWithLoading(
        {
          title: 'AI 正在润色正文',
          initialMessage: '正在准备润色参数……',
          successMessage: `润色完成！`,
          errorMessage: '润色失败',
        },
        async ({ setMessage, setStage, setPercent }) => {
          setStage('创建润色任务……');
          setPercent(5);
          const options: PolishRequestOptions = {
            mode, customInstruction: customInstruction.trim() || undefined,
            preservePlot: true, preserveCharacters: true, preserveKeyEvents: true,
          };
          let sourceDraft = currentDraft;
          if (currentEditorDirty || currentDraft.content !== sourceContent) {
            setMessage('正在保存当前正文快照……');
            sourceDraft = await draftVersionService.create({
              novelId,
              chapterId: chapter.id,
              title: `${chapter.title} - 润色快照`,
              content: sourceContent,
              source: 'user_edited',
              note: '润色正文快照',
            });
            setCurrentDraft(sourceDraft);
            onGenerated?.(sourceDraft);
          }
          const record = await polishService.create({ novelId, chapterId: chapter.id, sourceDraftId: sourceDraft.id, mode, instruction: customInstruction.trim() || undefined });

          setMessage('正在分析原文……');
          setStage('AI 正在润色正文……');
          setPercent(30);
          const polishedText = await polishAiService.runPolish({
            novelId, chapterId: chapter.id, sourceDraftId: sourceDraft.id,
            draftContent: sourceContent, chapterTitle: chapter.title,
            chapterOutline: chapter.outline, options,
          });

          setMessage('正在保存润色结果……');
          setPercent(80);
          const resultDraft = await draftVersionService.create({
            novelId, chapterId: chapter.id,
            content: polishedText, source: 'ai_polished',
            note: `${PolishModeLabels[mode]}润色`,
          });

          await polishService.update(record.id, { status: 'succeeded', resultDraftId: resultDraft.id });
          setPercent(100);

          onGenerated?.(resultDraft);
        },
      );
    } catch (e: any) {
      setError(e.message || '润色失败');
    } finally {
      setLoading(false);
    }
  };

  if (!chapter) return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择章节</div>;

  const aiSettings = aiSettingsService.getSettings();

  return (
    <div>
      {/* AI 模式状态 */}
      <div className="panel-section" style={{ fontSize: 12, lineHeight: 1.8 }}>
        <div className="panel-section-title">🤖 AI 状态</div>
        <div>模式：{aiSettings.runtimeMode === 'mock' ? '🔶 Mock 模式' : '🔷 真实 API'}</div>
        {aiSettings.runtimeMode === 'api' && (
          <>
            <div>模型：{aiSettings.modelName || '未配置'}</div>
            {!aiSettings.apiKey && (
              <div style={{ color: 'var(--color-error)', marginTop: 4 }}>⚠️ 未配置 API Key，请先到设置中心配置</div>
            )}
          </>
        )}
      </div>
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
