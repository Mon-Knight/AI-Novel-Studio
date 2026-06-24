/**
 * AI Novel Studio - 章节总结查看面板 (v1.0.24 增加 AI 生成总结)
 */
import { useState, useEffect, useCallback } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterSummary } from '../../../types/chapterSummary';
import type { ChapterSummarizeResult } from '../../../types/chapterSummary';
import { chapterSummaryService } from '../../../services/context/chapterSummaryService';
import { contextRecordService } from '../../../services/context/contextRecordService';
import { characterStateService } from '../../../services/context/characterStateService';
import { chapterRepository } from '../../../services/database/chapterRepository';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { chapterSummarizeService } from '../../../services/ai/chapterSummarizeService';
import { aiSettingsService } from '../../../services/ai/aiClient';
import { formatDateTime } from '../../../utils/date';
import { runWithLoading } from '../../../lib/runWithLoading';

interface ChapterSummaryPanelProps {
  novelId?: string;
  chapter?: Chapter;
}

function ChapterSummaryPanel({ novelId, chapter }: ChapterSummaryPanelProps) {
  const [summary, setSummary] = useState<ChapterSummary | null>(null);
  const [loading, setLoading] = useState(false);

  // AI 生成状态
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState('');
  const [genResult, setGenResult] = useState<ChapterSummarizeResult | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const load = useCallback(async () => {
    if (!chapter?.id) return;
    setLoading(true);
    try { setSummary(await chapterSummaryService.getByChapterId(chapter.id)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [chapter?.id]);

  useEffect(() => { load(); }, [load]);

  // AI 生成章节总结
  const handleGenerateSummary = async () => {
    if (!novelId || !chapter) return;
    
    // 获取已采用的草稿
    let adoptedDraft;
    try {
      adoptedDraft = await draftVersionService.getLatestByChapterId(chapter.id);
    } catch { /* ignore */ }
    
    if (!adoptedDraft?.content || adoptedDraft.content.trim().length < 10) {
      setGenError('当前章节没有足够的正文内容。请先生成或编辑正文，并在草稿历史中确认采用后再生成总结。');
      return;
    }
    
    setGenLoading(true); setGenError(''); setGenResult(null); setSaveSuccess(false);
    try {
      await runWithLoading(
        {
          title: 'AI 正在生成章节总结',
          initialMessage: '正在准备上下文数据……',
          successMessage: '章节总结生成完成',
          errorMessage: '总结生成失败',
        },
        async ({ setStage }) => {
          setStage('正在分析章节内容……');
          const result = await chapterSummarizeService.summarize({
            novelId,
            chapterId: chapter.id,
            adoptedDraftId: adoptedDraft.id,
            chapterTitle: chapter.title,
            chapterOutline: chapter.outline,
            adoptedContent: adoptedDraft.content.slice(0, 5000),
          });
          setGenResult(result);
        },
      );
    } catch (e: any) {
      setGenError(e.message || '总结生成失败');
    } finally {
      setGenLoading(false);
    }
  };

  // 保存生成的总结
  const handleSaveSummary = async () => {
    if (!novelId || !chapter || !genResult) return;
    setGenLoading(true); setGenError('');
    try {
      await runWithLoading(
        {
          title: '正在保存章节总结',
          initialMessage: '正在保存总结和上下文……',
          successMessage: '总结保存完成',
          errorMessage: '保存总结失败',
          successAutoCloseMs: 800,
        },
        async ({ setMessage, setStage }) => {
          setStage('保存章节总结……');
          const newSummary = await chapterSummaryService.create({
            novelId, chapterId: chapter.id,
            adoptedDraftId: '',
            summary: genResult.summary,
            keyEvents: genResult.keyEvents,
            characterChanges: genResult.characterChanges as any,
            relationshipChanges: genResult.relationshipChanges as any,
            newForeshadows: genResult.newForeshadows,
            resolvedForeshadows: genResult.resolvedForeshadows,
            nextChapterHints: genResult.nextChapterHints,
          });
          // 保存上下文记录
          setMessage('正在保存上下文记录……');
          for (const cr of genResult.contextRecords) {
            await contextRecordService.create({ ...cr, novelId, chapterId: chapter.id }).catch(() => {});
          }
          // 保存角色状态
          setStage('保存角色状态……');
          for (const cc of genResult.characterChanges) {
            if (cc.characterId) {
              await characterStateService.create({
                novelId, characterId: cc.characterId, chapterId: chapter.id,
                stateSummary: cc.stateSummary, relationshipChanges: cc.relationshipChanges,
                goalChanges: cc.goalChanges, location: cc.location,
                healthState: cc.healthState, knowledgeState: cc.knowledgeState,
              }).catch(() => {});
            }
          }
          // 更新章节状态
          await chapterRepository.update(chapter.id, { status: 'summarized' }).catch(() => {});

          setSummary(newSummary);
          setSaveSuccess(true);
          setGenResult(null);
          setTimeout(() => setSaveSuccess(false), 3000);
        },
      );
    } catch (e: any) {
      setGenError(e.message || '保存总结失败');
    } finally {
      setGenLoading(false);
    }
  };

  const aiSettings = aiSettingsService.getSettings();

  if (!chapter) return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择章节</div>;
  if (loading) return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>加载中...</div>;

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

      {/* AI 生成章节总结 */}
      {!summary && !genResult && (
        <div className="panel-section">
          <div className="panel-section-title">🤖 生成章节总结</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            对当前章节正文进行 AI 分析，提取关键事件、角色变化、伏笔和下一章衔接建议。
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleGenerateSummary}
            disabled={genLoading}
            style={{ width: '100%', marginBottom: 6 }}
          >
            {genLoading ? '⏳ AI 正在分析正文...' : '📝 生成章节总结'}
          </button>
          {genError && <div style={{ fontSize: 12, color: 'var(--color-error)' }}>{genError}</div>}
        </div>
      )}

      {/* 生成结果预览 */}
      {genResult && (
        <div className="panel-section" style={{ border: '1px solid var(--color-primary-light)', padding: 10, borderRadius: 6 }}>
          <div className="panel-section-title">📋 生成结果预览</div>
          <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 8, whiteSpace: 'pre-wrap' }}>
            {genResult.summary}
          </div>
          {genResult.keyEvents && genResult.keyEvents.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>⚡ 关键事件：</div>
              {genResult.keyEvents.map((e, i) => (
                <div key={i} style={{ fontSize: 11, paddingLeft: 8 }}>• {e}</div>
              ))}
            </div>
          )}
          {genResult.nextChapterHints && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)' }}>🔗 下章建议：</div>
              <div style={{ fontSize: 11, paddingLeft: 8 }}>{genResult.nextChapterHints}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-primary btn-sm" onClick={handleSaveSummary} disabled={genLoading} style={{ flex: 1 }}>
              {genLoading ? '⏳ 保存中...' : '💾 确认保存'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setGenResult(null)} style={{ flex: 1 }}>
              放弃
            </button>
          </div>
        </div>
      )}

      {/* 保存成功提示 */}
      {saveSuccess && (
        <div style={{ fontSize: 12, color: 'var(--color-success)', textAlign: 'center', padding: 8 }}>
          ✅ 章节总结已保存成功！
        </div>
      )}

      {/* 已有总结显示 */}
      {!summary && !genResult && !saveSuccess && (
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', padding: 24 }}>
            本章尚未生成总结
          </div>
        </div>
      )}

      {summary && (
        <>
          <div className="panel-section">
            <div className="panel-section-title">📋 章节摘要</div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>{summary.summary}</div>
          </div>

          {summary.keyEvents && summary.keyEvents.length > 0 && (
            <div className="panel-section">
              <div className="panel-section-title">⚡ 关键事件</div>
              {summary.keyEvents.map((e, i) => (
                <div key={i} style={{ padding: '4px 0', fontSize: 12 }}>• {e}</div>
              ))}
            </div>
          )}

          {summary.newForeshadows && summary.newForeshadows.length > 0 && (
            <div className="panel-section">
              <div className="panel-section-title">🔮 新增伏笔</div>
              {summary.newForeshadows.map((f, i) => (
                <div key={i} style={{ padding: '4px 0', fontSize: 12, color: 'var(--color-primary)' }}>• {f}</div>
              ))}
            </div>
          )}

          {summary.resolvedForeshadows && summary.resolvedForeshadows.length > 0 && (
            <div className="panel-section">
              <div className="panel-section-title">✅ 已回收伏笔</div>
              {summary.resolvedForeshadows.map((f, i) => (
                <div key={i} style={{ padding: '4px 0', fontSize: 12, color: 'var(--color-success)' }}>• {f}</div>
              ))}
            </div>
          )}

          {summary.nextChapterHints && (
            <div className="panel-section">
              <div className="panel-section-title">🔗 下一章衔接建议</div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>{summary.nextChapterHints}</div>
            </div>
          )}

          <div className="panel-section">
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              创建于：{formatDateTime(summary.createdAt)}
            </div>
          </div>

          {/* 已有总结时也可重新生成 */}
          <div className="panel-section">
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleGenerateSummary}
              disabled={genLoading}
              style={{ width: '100%' }}
            >
              {genLoading ? '⏳ 生成中...' : '🔄 重新生成总结'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default ChapterSummaryPanel;
