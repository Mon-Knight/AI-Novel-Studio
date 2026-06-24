/**
 * AI Novel Studio - 章节总结查看面板 (v1.7.13 升级为章节上下文)
 */
import { useState, useEffect, useCallback } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterSummary, ChapterSummarizeResult, ChapterSummaryValidation } from '../../../types/chapterSummary';
import { chapterSummaryService } from '../../../services/context/chapterSummaryService';
import { contextRecordService } from '../../../services/context/contextRecordService';
import { characterStateService } from '../../../services/context/characterStateService';
import { chapterRepository } from '../../../services/database/chapterRepository';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { chapterSummarizeService } from '../../../services/ai/chapterSummarizeService';
import { validateSummary, hashContent } from '../../../services/ai/summaryValidator';
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
  const [validation, setValidation] = useState<ChapterSummaryValidation | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [adoptedDraft, setAdoptedDraft] = useState<any>(null);

  const load = useCallback(async () => {
    if (!chapter?.id) return;
    setLoading(true);
    try {
      const s = await chapterSummaryService.getByChapterId(chapter.id);
      if (s) {
        setSummary(s);
        // 检查是否过期：对比当前草稿版本
        const draft = await draftVersionService.getLatestByChapterId(chapter.id).catch(() => null);
        if (draft && s.draftVersion && draft.versionNo !== s.draftVersion) {
          // 版本不匹配，标记过期
          if (!s.isExpired) {
            await chapterSummaryService.markExpired(chapter.id);
            s.isExpired = true;
          }
        }
        setSummary(s);
      } else {
        setSummary(null);
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [chapter?.id]);

  useEffect(() => { load(); }, [load]);

  // AI 生成章节总结 → 自动校验
  const handleGenerateSummary = async () => {
    if (!novelId || !chapter) return;

    let draft;
    try { draft = await draftVersionService.getLatestByChapterId(chapter.id); } catch { /* ignore */ }
    setAdoptedDraft(draft);

    if (!draft?.content || draft.content.trim().length < 10) {
      setGenError('当前章节没有足够的正文内容。请先生成或编辑正文，并在草稿历史中确认采用后再生成总结。');
      return;
    }

    // 检查是否属于某个卷
    if (!chapter.volumeId) {
      setGenError('当前章节未归属任何卷，请先将章节加入卷后再生成章节上下文。');
      return;
    }

    setGenLoading(true); setGenError(''); setGenResult(null); setValidation(null); setSaveSuccess(false);
    try {
      await runWithLoading(
        {
          title: 'AI 正在生成章节总结',
          initialMessage: '正在准备上下文数据……',
          successMessage: '章节总结生成完成，正在进行一致性校验……',
          errorMessage: '总结生成失败',
        },
        async ({ setStage, setMessage }) => {
          setStage('正在分析章节内容……');
          const result = await chapterSummarizeService.summarize({
            novelId, chapterId: chapter.id, adoptedDraftId: draft.id,
            chapterTitle: chapter.title, chapterOutline: chapter.outline,
            adoptedContent: draft.content.slice(0, 5000),
          });
          setGenResult(result);

          // 自动一致性校验
          setMessage('正在进行一致性校验……');
          setStage('校验总结与正文是否一致……');
          const v = validateSummary(draft.content, result);
          setValidation(v);
        },
      );
    } catch (e: any) {
      setGenError(e.message || '总结生成失败');
    } finally {
      setGenLoading(false);
    }
  };

  // 保存总结（含校验状态）
  const handleSaveSummary = async () => {
    if (!novelId || !chapter || !genResult) return;
    setGenLoading(true); setGenError('');
    try {
      await runWithLoading(
        {
          title: '正在保存章节上下文',
          initialMessage: '正在保存总结和上下文……',
          successMessage: '章节上下文保存完成',
          errorMessage: '保存失败',
          successAutoCloseMs: 800,
        },
        async ({ setMessage, setStage }) => {
          const contentHash = adoptedDraft ? hashContent(adoptedDraft.content) : undefined;

          setStage('保存章节总结……');
          const newSummary = await chapterSummaryService.create({
            novelId, chapterId: chapter.id,
            volumeId: chapter.volumeId,
            adoptedDraftId: adoptedDraft?.id || '',
            summary: genResult.summary,
            keyEvents: genResult.keyEvents,
            characterChanges: genResult.characterChanges as any,
            relationshipChanges: genResult.relationshipChanges as any,
            newForeshadows: genResult.newForeshadows,
            resolvedForeshadows: genResult.resolvedForeshadows,
            nextChapterHints: genResult.nextChapterHints,
            coreEvents: genResult.coreEvents,
            protagonistStateChange: genResult.protagonistStateChange,
            importantCharacterChanges: genResult.importantCharacterChanges,
            settingChanges: genResult.settingChanges,
            newLocations: genResult.newLocations,
            newItemsOrAbilities: genResult.newItemsOrAbilities,
            foreshadowing: genResult.foreshadowing,
            unresolvedQuestions: genResult.unresolvedQuestions,
            factsMustRemember: genResult.factsMustRemember,
            nextChapterHook: genResult.nextChapterHook,
            validationStatus: validation?.passed ? 'passed' : validation ? 'failed' : 'pending',
            validationResult: validation || undefined,
            enabled: validation?.safeToContext !== false,
            contentHash,
            draftVersion: adoptedDraft?.versionNo,
          });

          // 保存上下文记录
          setMessage('正在保存上下文记录……');
          const contextInputs = genResult.contextRecords.map((cr) => ({
            ...cr, novelId, chapterId: chapter.id, volumeId: chapter.volumeId,
            contentHash, draftVersion: adoptedDraft?.versionNo,
          }));
          await contextRecordService.createBatch(contextInputs).catch(() => {});

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
          await chapterRepository.update(chapter.id, { status: 'summarized' }).catch(() => {});

          setSummary(newSummary);
          setSaveSuccess(true);
          setGenResult(null); setValidation(null);
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

      {/* 过期提示 */}
      {summary?.isExpired && (
        <div className="panel-section" style={{ border: '1px solid #f59e0b40', background: '#f59e0b10', borderRadius: 6, padding: 8 }}>
          <div style={{ fontSize: 12, color: '#d97706', fontWeight: 500 }}>⚠️ 章节正文已修改</div>
          <div style={{ fontSize: 11, color: '#92400e', marginTop: 2 }}>
            当前章节上下文可能不再准确，建议重新生成。
          </div>
        </div>
      )}

      {/* AI 生成章节总结 */}
      {!summary && !genResult && (
        <div className="panel-section">
          <div className="panel-section-title">🤖 生成章节上下文</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            对当前章节正文进行 AI 分析，生成结构化上下文。总结将自动校验一致性后写入上下文记录，供后续 AI 生成调用。
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleGenerateSummary}
            disabled={genLoading}
            style={{ width: '100%', marginBottom: 6 }}
          >
            {genLoading ? '⏳ AI 正在分析正文...' : '📝 生成章节上下文'}
          </button>
          {genError && <div style={{ fontSize: 12, color: 'var(--color-error)' }}>{genError}</div>}
        </div>
      )}

      {/* 生成结果预览 + 校验结果 */}
      {genResult && (
        <div className="panel-section" style={{ border: '1px solid var(--color-primary-light)', padding: 10, borderRadius: 6 }}>
          <div className="panel-section-title">📋 生成结果预览</div>

          {/* 校验状态 */}
          {validation && (
            <div style={{
              fontSize: 11, padding: '6px 8px', borderRadius: 4, marginBottom: 8,
              background: validation.passed ? '#22c55e10' : validation.safeToContext ? '#f59e0b10' : '#ef444410',
              border: `1px solid ${validation.passed ? '#22c55e40' : validation.safeToContext ? '#f59e0b40' : '#ef444440'}`,
            }}>
              <div style={{ fontWeight: 600, color: validation.passed ? '#16a34a' : validation.safeToContext ? '#d97706' : '#dc2626' }}>
                {validation.passed ? '✅ 校验通过' : validation.safeToContext ? '⚠️ 校验有警告' : '❌ 校验失败'}
                （{validation.score} 分）
              </div>
              {validation.problems.map((p, i) => (
                <div key={i} style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>• {p.message}</div>
              ))}
              {!validation.safeToContext && (
                <div style={{ color: '#dc2626', marginTop: 4, fontWeight: 500 }}>
                  校验未通过，保存后不会自动启用为可用上下文。你可以手动启用或重新生成。
                </div>
              )}
            </div>
          )}

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
            <button className="btn btn-secondary btn-sm" onClick={() => { setGenResult(null); setValidation(null); }} style={{ flex: 1 }}>
              放弃
            </button>
          </div>
        </div>
      )}

      {/* 保存成功提示 */}
      {saveSuccess && (
        <div style={{ fontSize: 12, color: 'var(--color-success)', textAlign: 'center', padding: 8 }}>
          ✅ 章节上下文已保存成功！
        </div>
      )}

      {/* 已有总结显示 */}
      {summary && (
        <>
          {/* 状态标签 */}
          <div className="panel-section" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {summary.validationStatus === 'passed' && (
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#22c55e20', color: '#16a34a' }}>✅ 校验通过</span>
            )}
            {summary.validationStatus === 'failed' && (
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#ef444420', color: '#dc2626' }}>❌ 校验未通过</span>
            )}
            {summary.enabled && (
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#3b82f620', color: '#2563eb' }}>📌 已启用</span>
            )}
            {!summary.enabled && (
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: '#6b728020', color: '#6b7280' }}>⏸ 已停用</span>
            )}
            {summary.volumeId && (
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>📂 已归卷</span>
            )}
          </div>

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

          {/* 操作按钮 */}
          <div className="panel-section" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleGenerateSummary}
              disabled={genLoading}
            >
              {genLoading ? '⏳ 生成中...' : '🔄 重新生成'}
            </button>
            <button
              className={`btn btn-sm ${summary.enabled ? 'btn-secondary' : 'btn-primary'}`}
              onClick={async () => {
                await chapterSummaryService.setEnabled(summary.id, !summary.enabled);
                setSummary({ ...summary, enabled: !summary.enabled });
              }}
            >
              {summary.enabled ? '⏸ 停用' : '📌 启用'}
            </button>
          </div>
        </>
      )}

      {!summary && !genResult && !saveSuccess && (
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center', padding: 24 }}>
            本章尚未生成章节上下文
          </div>
        </div>
      )}
    </div>
  );
}

export default ChapterSummaryPanel;
