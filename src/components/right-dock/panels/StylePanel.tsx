import { useState, useEffect, useCallback, useRef } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { StyleProfile } from '../../../types/style';
import type { OutputProfile } from '../../../types/output';
import type { StyleAnalyzeResult } from '../../../types/style';
import { styleProfileService } from '../../../services/styles/styleProfileService';
import { outputProfileService } from '../../../services/styles/outputProfileService';
import { analyzeStyle } from '../../../services/styles/styleAnalyzeService';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { aiSettingsService } from '../../../services/ai/aiClient';
import { formatNumber } from '../../../utils/format';
import { describeUnknownError } from '../../../utils/errorMessage';
import { isAiRequestCancelled } from '../../../services/ai/aiCancellation';
import { showInfo } from '../../../utils/nativeDialog';

interface StylePanelProps {
  novelId?: string;
  chapter?: Chapter;
  onStyleChange?: (style: StyleProfile) => void;
  onOutputChange?: (output: OutputProfile) => void;
}

function StylePanel({ novelId, chapter, onStyleChange, onOutputChange }: StylePanelProps) {
  const [styles, setStyles] = useState<StyleProfile[]>([]);
  const [outputs, setOutputs] = useState<OutputProfile[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState('');
  const [selectedOutputId, setSelectedOutputId] = useState('');

  // 风格分析相关状态
  const [analyzeText, setAnalyzeText] = useState('');
  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState('');
  const [analyzeStatus, setAnalyzeStatus] = useState('');
  const [analyzeResult, setAnalyzeResult] = useState<StyleAnalyzeResult | null>(null);
  const [useChapterContent, setUseChapterContent] = useState(false);
  const analyzeAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      analyzeAbortRef.current?.abort();
      analyzeAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    styleProfileService.getAll(novelId).then((list) => {
      setStyles(list);
      if (list.length > 0 && !selectedStyleId) {
        setSelectedStyleId(list[0].id);
        onStyleChange?.(list[0]);
      }
    });
    outputProfileService.getAll(novelId).then((list) => {
      setOutputs(list);
      const def = list.find((o) => o.isDefault) || list[0];
      if (def && !selectedOutputId) {
        setSelectedOutputId(def.id);
        onOutputChange?.(def);
      }
    });
  }, [novelId, onStyleChange, onOutputChange, selectedStyleId, selectedOutputId]);

  const selectedStyle = styles.find((s) => s.id === selectedStyleId);
  const selectedOutput = outputs.find((o) => o.id === selectedOutputId);

  const handleStyleSelect = (id: string) => {
    setSelectedStyleId(id);
    const s = styles.find((x) => x.id === id);
    if (s) onStyleChange?.(s);
  };

  const handleOutputSelect = (id: string) => {
    setSelectedOutputId(id);
    const o = outputs.find((x) => x.id === id);
    if (o) onOutputChange?.(o);
  };

  // 加载当前章节草稿内容用于分析
  const loadChapterContent = useCallback(async () => {
    if (!chapter?.id) return;
    try {
      const draft = await draftVersionService.getLatestByChapterId(chapter.id);
      if (draft?.content) {
        setAnalyzeText(draft.content.slice(0, 10000));
        setUseChapterContent(true);
      }
    } catch {
      /* ignore */
    }
  }, [chapter?.id]);

  const stopAnalyzeStyle = () => {
    const controller = analyzeAbortRef.current;
    if (!controller) return;
    analyzeAbortRef.current = null;
    controller.abort();
    setAnalyzeLoading(false);
    setAnalyzeError('');
    setAnalyzeStatus('风格分析已停止');
  };

  // 风格分析
  const handleAnalyzeStyle = async () => {
    const text = analyzeText.trim();
    if (!text) {
      setAnalyzeError('请先输入参考文本，或选择一个包含正文的章节');
      return;
    }
    analyzeAbortRef.current?.abort();
    const controller = new AbortController();
    analyzeAbortRef.current = controller;
    setAnalyzeLoading(true);
    setAnalyzeError('');
    setAnalyzeStatus('');
    setAnalyzeResult(null);
    try {
      const result = await analyzeStyle(text, {
        signal: controller.signal,
        cancel: () => controller.abort(),
      });
      if (
        controller.signal.aborted ||
        analyzeAbortRef.current !== controller ||
        !mountedRef.current
      )
        return;
      setAnalyzeResult(result);
    } catch (e: unknown) {
      if (analyzeAbortRef.current !== controller || !mountedRef.current) return;
      if (controller.signal.aborted || isAiRequestCancelled(e)) {
        setAnalyzeError('');
        setAnalyzeStatus('风格分析已停止');
      } else {
        setAnalyzeError(describeUnknownError(e, '风格分析失败'));
      }
    } finally {
      if (analyzeAbortRef.current === controller) {
        analyzeAbortRef.current = null;
        if (mountedRef.current) setAnalyzeLoading(false);
      }
    }
  };

  // 保存分析结果为风格方案
  const handleSaveAsStyle = async () => {
    if (!analyzeResult || !novelId) return;
    try {
      const name = analyzeResult.name || `风格分析 ${new Date().toLocaleDateString()}`;
      const profile = await styleProfileService.create({
        novelId,
        name,
        sourceType: 'ai_analyzed',
        narrativePerspective: analyzeResult.narrativePerspective || '',
        tone: analyzeResult.tone || '',
        pace: analyzeResult.pace || 'medium',
        sentenceStyle: analyzeResult.sentenceStyle || '',
        dialogueRatio: analyzeResult.dialogueRatio ?? 0.35,
        descriptionRatio: analyzeResult.descriptionRatio ?? 0.4,
        styleSummary: analyzeResult.styleSummary || '',
      });
      setStyles((prev) => [...prev, profile]);
      setSelectedStyleId(profile.id);
      onStyleChange?.(profile);
      await showInfo({ title: '保存完成', message: '风格分析已保存为风格方案。' });
    } catch (e: unknown) {
      setAnalyzeError(describeUnknownError(e, '保存风格方案失败'));
    }
  };

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
              <div style={{ color: 'var(--color-error)', marginTop: 4 }}>
                ⚠️ 未配置 API Key，请先到设置中心配置
              </div>
            )}
          </>
        )}
      </div>

      {/* AI 风格分析 */}
      <div className="panel-section">
        <div className="panel-section-title">🤖 风格分析</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
          粘贴参考文本或使用当前章节正文进行风格分析
        </div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
          <button
            className={`btn btn-sm ${useChapterContent ? 'btn-primary' : 'btn-secondary'}`}
            onClick={loadChapterContent}
            disabled={!chapter}
          >
            📄 使用当前章节正文
          </button>
        </div>
        <textarea
          className="form-textarea"
          value={analyzeText}
          onChange={(e) => {
            setAnalyzeText(e.target.value);
            setUseChapterContent(false);
          }}
          placeholder="在此粘贴需要分析的参考文本（建议 500-20000 字）..."
          rows={4}
          style={{ width: '100%', resize: 'vertical', fontSize: 12, marginBottom: 8 }}
        />
        <button
          className="btn btn-primary btn-sm"
          onClick={handleAnalyzeStyle}
          disabled={analyzeLoading || !analyzeText.trim()}
          style={{ width: '100%', marginBottom: 6 }}
        >
          {analyzeLoading ? '⏳ 分析中...' : '🔍 开始风格分析'}
        </button>
        {analyzeLoading && (
          <button
            className="btn btn-secondary btn-sm"
            onClick={stopAnalyzeStyle}
            style={{ width: '100%', marginBottom: 6 }}
          >
            停止分析
          </button>
        )}
        {analyzeError && (
          <div style={{ fontSize: 12, color: 'var(--color-error)', marginBottom: 8 }}>
            {analyzeError}
          </div>
        )}
        {analyzeStatus && (
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
            {analyzeStatus}
          </div>
        )}

        {/* 分析结果 */}
        {analyzeResult && (
          <div
            style={{
              border: '1px solid var(--color-primary-light)',
              borderRadius: 6,
              padding: 10,
              marginTop: 8,
            }}
          >
            <div className="panel-field-label" style={{ fontWeight: 600, marginBottom: 6 }}>
              📊 分析结果
            </div>
            {analyzeResult.narrativePerspective && (
              <div style={{ fontSize: 12, marginBottom: 3 }}>
                👁️ 视角：{analyzeResult.narrativePerspective}
              </div>
            )}
            {analyzeResult.tone && (
              <div style={{ fontSize: 12, marginBottom: 3 }}>🎭 基调：{analyzeResult.tone}</div>
            )}
            {analyzeResult.pace && (
              <div style={{ fontSize: 12, marginBottom: 3 }}>⚡ 节奏：{analyzeResult.pace}</div>
            )}
            {analyzeResult.sentenceStyle && (
              <div style={{ fontSize: 12, marginBottom: 3 }}>
                ✍️ 句式：{analyzeResult.sentenceStyle}
              </div>
            )}
            <div style={{ fontSize: 12, marginBottom: 3 }}>
              💬 对话比：{Math.round((analyzeResult.dialogueRatio ?? 0) * 100)}% · 🖊️ 描写比：
              {Math.round((analyzeResult.descriptionRatio ?? 0) * 100)}%
            </div>
            {analyzeResult.styleSummary && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--color-text-secondary)',
                  lineHeight: 1.6,
                  marginTop: 6,
                  padding: 6,
                  background: 'var(--color-bg-primary)',
                  borderRadius: 4,
                }}
              >
                {analyzeResult.styleSummary}
              </div>
            )}
            <button
              className="btn btn-primary btn-sm"
              onClick={handleSaveAsStyle}
              style={{ marginTop: 8, width: '100%' }}
            >
              💾 保存为风格方案
            </button>
          </div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">风格方案</div>
        <select
          className="panel-select"
          value={selectedStyleId}
          onChange={(e) => handleStyleSelect(e.target.value)}
        >
          {styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {selectedStyle && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              marginTop: 8,
              lineHeight: 1.6,
            }}
          >
            {selectedStyle.narrativePerspective && (
              <div>👁️ {selectedStyle.narrativePerspective}</div>
            )}
            {selectedStyle.tone && <div>🎭 {selectedStyle.tone}</div>}
            {selectedStyle.pace && <div>⚡ {selectedStyle.pace}</div>}
            <div>
              💬 {Math.round(selectedStyle.dialogueRatio * 100)}% · 🖊️{' '}
              {Math.round(selectedStyle.descriptionRatio * 100)}%
            </div>
          </div>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">输出控制方案</div>
        <select
          className="panel-select"
          value={selectedOutputId}
          onChange={(e) => handleOutputSelect(e.target.value)}
        >
          {outputs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {selectedOutput && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              marginTop: 8,
              lineHeight: 1.6,
            }}
          >
            <div>
              📊{' '}
              {formatNumber(
                selectedOutput.targetWordCount ?? selectedOutput.chapterWordRange.default,
              )}{' '}
              字
            </div>
            <div>
              ⚡{' '}
              {selectedOutput.paceLevel === 'fast'
                ? '快节奏'
                : selectedOutput.paceLevel === 'slow'
                  ? '慢节奏'
                  : '中等节奏'}
            </div>
            {chapter && (
              <div style={{ marginTop: 4 }}>
                章节目标：{formatNumber(chapter.targetWordCount ?? 4000)} 字
              </div>
            )}
          </div>
        )}
      </div>

      <div
        style={{
          fontSize: 11,
          color: 'var(--color-text-muted)',
          textAlign: 'center',
          marginTop: 12,
        }}
      >
        前往{' '}
        <a href="#/styles" style={{ color: 'var(--color-primary)' }}>
          风格方案管理
        </a>{' '}
        查看更多
      </div>
    </div>
  );
}

export default StylePanel;
