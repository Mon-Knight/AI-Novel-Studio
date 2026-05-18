import { useState, useEffect, useCallback } from 'react';
import { volumeRepository } from '../../../services/database/volumeRepository';
import { chapterRepository } from '../../../services/database/chapterRepository';
import { outlineGenerateService, type VolumeOutlineCandidate, type ChapterOutlineCandidate } from '../../../services/ai/outlineGenerateService';
import { aiSettingsService } from '../../../services/ai/aiClient';
import type { Chapter } from '../../../types/chapter';
import type { Volume } from '../../../types/volume';
import { ChapterStatusLabels } from '../../../types/chapter';
import { formatNumber } from '../../../utils/format';
import { runWithLoading } from '../../../lib/runWithLoading';
import { chapterOutlineService } from '../../../services/outlines/outlineService';

interface OutlinePanelProps {
  novelId?: string;
  chapter?: Chapter;
}

type OutlineGenMode = 'novel' | 'volume' | 'chapter' | null;

function OutlinePanel({ novelId, chapter }: OutlinePanelProps) {
  const [volume, setVolume] = useState<Volume | null>(null);
  const [loading, setLoading] = useState(false);
  const [genMode, setGenMode] = useState<OutlineGenMode>(null);
  const [error, setError] = useState('');

  // 作品总大纲结果
  const [novelOutline, setNovelOutline] = useState('');
  // 分卷大纲结果
  const [volumeOutline, setVolumeOutline] = useState<VolumeOutlineCandidate | null>(null);
  // 章节大纲结果
  const [chapterOutlines, setChapterOutlines] = useState<ChapterOutlineCandidate[]>([]);

  useEffect(() => {
    if (chapter?.volumeId) {
      volumeRepository.getById(chapter.volumeId).then(setVolume).catch(() => {});
    } else {
      setVolume(null);
    }
  }, [chapter?.volumeId]);

  const aiSettings = aiSettingsService.getSettings();

  // 生成作品总大纲
  const handleGenerateNovelOutline = useCallback(async () => {
    if (!novelId) return;
    setLoading(true); setGenMode('novel'); setError('');
    try {
      await runWithLoading({
        title: 'AI 正在生成作品总大纲',
        initialMessage: '正在读取作品设定和世界观……',
        successMessage: '作品总大纲生成完成',
        errorMessage: '作品总大纲生成失败',
      }, async ({ setMessage, setStage }) => {
        setStage('正在分析主角和世界背景……');
        const result = await outlineGenerateService.generateNovelOutline(novelId);
        setNovelOutline(result);
        setStage('生成完成');
      });
    } catch (e: any) {
      setError(e.message || '作品总大纲生成失败');
    } finally {
      setLoading(false); setGenMode(null);
    }
  }, [novelId]);

  // 生成本卷大纲
  const handleGenerateVolumeOutline = useCallback(async () => {
    if (!novelId || !volume) {
      setError('请先在左侧目录树中选择一个分卷下的章节');
      return;
    }
    setLoading(true); setGenMode('volume'); setError('');
    try {
      await runWithLoading({
        title: 'AI 正在生成分卷大纲',
        initialMessage: '正在读取分卷和作品设定……',
        successMessage: '分卷大纲生成完成',
        errorMessage: '分卷大纲生成失败',
      }, async ({ setStage }) => {
        setStage('正在分析分卷结构……');
        const result = await outlineGenerateService.generateVolumeOutline({
          novelId, volumeTitle: volume.title,
        });
        setVolumeOutline(result);
        setStage('生成完成');
      });
    } catch (e: any) {
      setError(e.message || '分卷大纲生成失败');
    } finally {
      setLoading(false); setGenMode(null);
    }
  }, [novelId, volume]);

  // 生成章节大纲
  const handleGenerateChapterOutlines = useCallback(async () => {
    if (!novelId || !chapter) {
      setError('请先在左侧目录树中选择一个章节');
      return;
    }
    setLoading(true); setGenMode('chapter'); setError('');
    try {
      await runWithLoading({
        title: 'AI 正在生成章节大纲',
        initialMessage: '正在读取当前分卷、总纲和风格方案……',
        successMessage: '章节大纲生成完成',
        errorMessage: '章节大纲生成失败',
      }, async ({ setMessage, setStage }) => {
        setStage('正在推演本章剧情结构……');
        const result = await outlineGenerateService.generateChapterOutlines({
          novelId, volumeId: chapter.volumeId, chapterCount: 3,
        });
        setChapterOutlines(result);
        setMessage(`已生成 ${result.length} 个章节大纲候选`);
        setStage('生成完成');
      });
    } catch (e: any) {
      setError(e.message || '章节大纲生成失败');
    } finally {
      setLoading(false); setGenMode(null);
    }
  }, [novelId, chapter]);

  // 采用章节大纲候选（保存到当前章节）
  const handleAdoptChapterOutline = useCallback(async (candidate: ChapterOutlineCandidate) => {
    if (!chapter) return;
    try {
      await chapterRepository.update(chapter.id, {
        title: candidate.title || chapter.title,
        outline: candidate.outline,
        goal: candidate.goal || undefined,
        targetWordCount: candidate.targetWordCount,
      });
      alert(`已保存章节大纲：${candidate.title}`);
    } catch (e: any) {
      setError(e.message || '保存章节大纲失败');
    }
  }, [chapter]);

  // 采用作品总大纲（显示确认）
  const handleAdoptNovelOutline = useCallback(() => {
    if (!novelOutline) return;
    // 复制到剪贴板，用户可手动保存
    navigator.clipboard.writeText(novelOutline).then(() => {
      alert('作品总大纲已复制到剪贴板！可在作品详情页手动保存。');
    }).catch(() => {
      alert('作品总大纲：\n\n' + novelOutline.slice(0, 500));
    });
  }, [novelOutline]);

  if (!novelId) {
    return (
      <div className="text-sm text-muted" style={{ padding: 16, textAlign: 'center' }}>
        请先选择作品
      </div>
    );
  }

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

      {/* AI 大纲生成按钮区 */}
      <div className="panel-section">
        <div className="panel-section-title">🤖 AI 大纲生成</div>

        {/* 作品总大纲 */}
        <button
          className="btn btn-primary btn-sm"
          onClick={handleGenerateNovelOutline}
          disabled={loading || !novelId}
          style={{ width: '100%', marginBottom: 6 }}
        >
          {loading && genMode === 'novel' ? '⏳ 生成中...' : '📖 生成作品总大纲'}
        </button>

        {/* 分卷大纲 */}
        <button
          className="btn btn-primary btn-sm"
          onClick={handleGenerateVolumeOutline}
          disabled={loading || !volume}
          style={{ width: '100%', marginBottom: 6 }}
        >
          {loading && genMode === 'volume' ? '⏳ 生成中...' : '📋 生成本卷大纲'}
        </button>
        {!volume && chapter && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>
            当前章节未归属分卷，无法生成卷大纲
          </div>
        )}

        {/* 章节大纲 */}
        <button
          className="btn btn-primary btn-sm"
          onClick={handleGenerateChapterOutlines}
          disabled={loading || !chapter}
          style={{ width: '100%', marginBottom: 6 }}
        >
          {loading && genMode === 'chapter' ? '⏳ 生成中...' : '📝 生成章节大纲'}
        </button>
        {!chapter && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>
            请先在左侧目录树中选择一个章节
          </div>
        )}

        {error && <div style={{ fontSize: 12, color: 'var(--color-error)', marginBottom: 8 }}>{error}</div>}
      </div>

      {/* 作品总大纲结果 */}
      {novelOutline && (
        <div className="panel-section" style={{ border: '1px solid var(--color-primary-light)', borderRadius: 6, padding: 10 }}>
          <div className="panel-section-title">📖 作品总大纲（可编辑）</div>
          <textarea
            className="input"
            value={novelOutline}
            onChange={(e) => setNovelOutline(e.target.value)}
            style={{ width: '100%', height: 160, resize: 'vertical', fontSize: 12, lineHeight: 1.7, fontFamily: 'var(--font-family-editor)' }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={handleAdoptNovelOutline}>
              📋 复制大纲
            </button>
          </div>
        </div>
      )}

      {/* 分卷大纲结果 */}
      {volumeOutline && (
        <div className="panel-section" style={{ border: '1px solid var(--color-primary-light)', borderRadius: 6, padding: 10 }}>
          <div className="panel-section-title">📋 分卷大纲</div>
          <div className="panel-field">
            <div className="panel-field-label">标题</div>
            <div className="panel-field-value">{volumeOutline.title}</div>
          </div>
          <div className="panel-field" style={{ marginTop: 6 }}>
            <div className="panel-field-label">摘要</div>
            <div className="panel-field-value" style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{volumeOutline.summary}</div>
          </div>
          {volumeOutline.goal && (
            <div className="panel-field" style={{ marginTop: 6 }}>
              <div className="panel-field-label">目标</div>
              <div className="panel-field-value" style={{ fontSize: 12 }}>{volumeOutline.goal}</div>
            </div>
          )}
          {volumeOutline.mainConflict && (
            <div className="panel-field" style={{ marginTop: 6 }}>
              <div className="panel-field-label">主要冲突</div>
              <div className="panel-field-value" style={{ fontSize: 12, color: 'var(--color-warning)' }}>{volumeOutline.mainConflict}</div>
            </div>
          )}
          {volumeOutline.rawText && (
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8, whiteSpace: 'pre-wrap', maxHeight: 150, overflowY: 'auto' }}>
              原始返回：{volumeOutline.rawText.slice(0, 500)}
            </div>
          )}
        </div>
      )}

      {/* 章节大纲候选 */}
      {chapterOutlines.length > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">📝 AI 章节大纲候选（{chapterOutlines.length}）</div>
          {chapterOutlines.map((cand, i) => (
            <div key={i} className="panel-field" style={{ marginBottom: 8, border: '1px solid var(--color-primary-light)', padding: 8, borderRadius: 6 }}>
              <div className="panel-field-label">{cand.title}</div>
              <textarea
                className="input"
                value={cand.rawText || cand.outline}
                onChange={(e) => {
                  const updated = [...chapterOutlines];
                  if (cand.rawText) {
                    updated[i] = { ...cand, rawText: e.target.value };
                  } else {
                    updated[i] = { ...cand, outline: e.target.value };
                  }
                  setChapterOutlines(updated);
                }}
                style={{ width: '100%', height: 100, resize: 'vertical', fontSize: 12, lineHeight: 1.6, fontFamily: 'var(--font-family-editor)' }}
              />
              {cand.goal && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>目标：{cand.goal}</div>}
              {cand.targetWordCount && <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>建议字数：{formatNumber(cand.targetWordCount)} 字</div>}
              {chapter && (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button className="btn btn-primary btn-sm" onClick={() => handleAdoptChapterOutline(cand)}>
                    ✅ 应用到当前章节
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 当前分卷信息 */}
      {volume && (
        <div className="panel-section">
          <div className="panel-section-title">当前分卷</div>
          <div className="panel-field">
            <div className="panel-field-label">分卷名称</div>
            <div className="panel-field-value">{volume.title}</div>
          </div>
          {volume.goal && (
            <div className="panel-field" style={{ marginTop: 8 }}>
              <div className="panel-field-label">分卷目标</div>
              <div className="panel-field-value" style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)' }}>
                {volume.goal}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 当前章节信息 */}
      {chapter && (
        <>
          <div className="panel-section">
            <div className="panel-section-title">当前章节</div>
            <div className="panel-field">
              <div className="panel-field-label">标题</div>
              <div className="panel-field-value">第{chapter.chapterNumber}章：{chapter.title}</div>
            </div>
            <div className="panel-field" style={{ marginTop: 8 }}>
              <div className="panel-field-label">状态</div>
              <div className="panel-field-value">{ChapterStatusLabels[chapter.status]}</div>
            </div>
            {chapter.targetWordCount && (
              <div className="panel-field" style={{ marginTop: 8 }}>
                <div className="panel-field-label">目标字数</div>
                <div className="panel-field-value">{formatNumber(chapter.targetWordCount)} 字</div>
              </div>
            )}
          </div>

          <div className="panel-section">
            <div className="panel-section-title">章节大纲</div>
            {chapter.outline ? (
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                {chapter.outline}
              </div>
            ) : (
              <div className="text-sm text-muted">本章尚未编写大纲</div>
            )}
          </div>

          {chapter.goal && (
            <div className="panel-section">
              <div className="panel-section-title">本章目标</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
                {chapter.goal}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default OutlinePanel;
