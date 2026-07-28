import { appLogger } from '../../../services/observability/appLogger';
/**
 * AI Novel Studio - 章节总结查看面板 (v1.7.13 升级为章节上下文)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterSummary, ChapterSummarizeResult, ChapterSummaryValidation } from '../../../types/chapterSummary';
import { chapterSummaryService } from '../../../services/context/chapterSummaryService';
import { chapterContextPersistenceService } from '../../../services/context/chapterContextPersistenceService';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { chapterSummarizeService } from '../../../services/ai/chapterSummarizeService';
import { validateSummary, hashContent } from '../../../services/ai/summaryValidator';
import { aiSettingsService } from '../../../services/ai/aiClient';
import { formatDateTime } from '../../../utils/date';
import { cancelLoadingOperation, runWithLoading } from '../../../lib/runWithLoading';
import type { ChapterDraft } from '../../../types/ai';
import { describeUnknownError } from '../../../utils/errorMessage';

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
  const [adoptedDraft, setAdoptedDraft] = useState<ChapterDraft | null>(null);
  const loadRequestIdRef = useRef(0);

  const load = useCallback(async () => {
    if (!chapter?.id) return;
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setGenError('');
    try {
      const s = await chapterSummaryService.getByChapterId(chapter.id);
      if (requestId !== loadRequestIdRef.current) return;
      if (s) {
        // 检查是否过期：对比当前草稿版本
        const draft = await draftVersionService.getAdoptedByChapterId(chapter.id);
        if (requestId !== loadRequestIdRef.current) return;
        const adoptedDraftChanged = !draft || s.adoptedDraftId !== draft.id;
        const adoptedVersionChanged = Boolean(
          draft && s.draftVersion && draft.versionNo !== s.draftVersion,
        );
        if (adoptedDraftChanged || adoptedVersionChanged) {
          // 版本不匹配，标记过期
          if (!s.isExpired) {
            await chapterSummaryService.markExpired(chapter.id);
            if (requestId !== loadRequestIdRef.current) return;
            s.isExpired = true;
          }
        }
        setSummary(s);
      } else {
        setSummary(null);
      }
    } catch (error: unknown) {
      if (requestId !== loadRequestIdRef.current) return;
      appLogger.error(error);
      setSummary(null);
      setGenError(describeUnknownError(error, '章节上下文读取或过期同步失败'));
    }
    finally {
      if (requestId === loadRequestIdRef.current) setLoading(false);
    }
  }, [chapter?.id]);

  const chapterRevision = chapter
    ? `${chapter.id}:${chapter.adoptedDraftId ?? ''}:${chapter.updatedAt}`
    : null;

  useEffect(() => {
    setSummary(null);
    setAdoptedDraft(null);
    setGenResult(null);
    setValidation(null);
    setSaveSuccess(false);
    setGenError('');
    if (chapterRevision) void load();
    else setLoading(false);
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [chapterRevision, load]);

  // AI 生成章节总结 → 自动校验
  const handleGenerateSummary = async () => {
    if (!novelId || !chapter) return;

    let draft: ChapterDraft | null;
    try {
      draft = await draftVersionService.getAdoptedByChapterId(chapter.id);
    } catch (error: unknown) {
      appLogger.error(error);
      setAdoptedDraft(null);
      setGenError(describeUnknownError(error, '读取当前采用正文失败，请重试。'));
      return;
    }
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
          cancelable: true,
        },
        async ({ setStage, setMessage, signal, operationId }) => {
          setStage('正在分析章节内容……');
          const result = await chapterSummarizeService.summarize(
            {
              novelId,
              chapterId: chapter.id,
              adoptedDraftId: draft.id,
              chapterTitle: chapter.title,
              chapterOutline: chapter.outline,
              adoptedContent: draft.content,
            },
            { signal, cancel: () => cancelLoadingOperation(operationId) },
          );
          setGenResult(result);

          // 自动一致性校验
          setMessage('正在进行一致性校验……');
          setStage('校验总结与正文是否一致……');
          const v = validateSummary(draft.content, result);
          setValidation(v);
        },
      );
    } catch (e: unknown) {
      setGenError(describeUnknownError(e, '总结生成失败'));
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

          setStage('原子保存章节上下文……');
          setMessage('正在一次提交总结、上下文记录、角色状态和章节状态……');
          const saved = await chapterContextPersistenceService.save({
            novelId,
            chapterId: chapter.id,
            adoptedDraftId: adoptedDraft?.id || '',
            summary: {
              novelId, chapterId: chapter.id,
              volumeId: chapter.volumeId,
              adoptedDraftId: adoptedDraft?.id || '',
              summary: genResult.summary,
              keyEvents: genResult.keyEvents,
              characterChanges: genResult.characterChanges,
              relationshipChanges: genResult.relationshipChanges,
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
            },
            contextRecords: genResult.contextRecords.map((record) => ({
              ...record,
              novelId,
              chapterId: chapter.id,
              volumeId: chapter.volumeId,
              isActive: validation?.safeToContext !== false,
              contentHash,
              draftVersion: adoptedDraft?.versionNo,
            })),
            characterStates: genResult.characterChanges.flatMap((change) => (
              change.characterId ? [{
                novelId,
                characterId: change.characterId,
                chapterId: chapter.id,
                stateSummary: change.stateSummary,
                relationshipChanges: change.relationshipChanges,
                goalChanges: change.goalChanges,
                location: change.location,
                healthState: change.healthState,
                knowledgeState: change.knowledgeState,
              }] : []
            )),
          });

          setSummary(saved.summary);
          setSaveSuccess(true);
          setGenResult(null); setValidation(null);
          setTimeout(() => setSaveSuccess(false), 3000);
        },
      );
    } catch (e: unknown) {
      setGenError(describeUnknownError(e, '保存总结失败'));
    } finally {
      setGenLoading(false);
    }
  };

  const aiSettings = aiSettingsService.getSettings();

  if (!chapter) return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择章节</div>;
  if (loading) return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>加载中...</div>;

  return (
    <div
      data-testid="chapter-summary-panel"
      data-chapter-id={chapter.id}
      data-summary-id={summary?.id || ''}
      data-summary-expired={summary?.isExpired ? 'true' : 'false'}
    >
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

      {genError && (
        <div
          className="panel-section"
          data-testid="chapter-summary-error"
          style={{ fontSize: 12, color: 'var(--color-error)' }}
        >
          {genError}
        </div>
      )}

      {/* 过期提示 */}
      {summary?.isExpired && (
        <div className="panel-section" style={{ border: '1px solid color-mix(in srgb, var(--color-warning) 25%, transparent)', background: 'color-mix(in srgb, var(--color-warning) 6%, transparent)', borderRadius: 6, padding: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--color-warning-text)', fontWeight: 500 }}>⚠️ 章节正文已修改</div>
          <div style={{ fontSize: 11, color: 'var(--color-warning-text)', marginTop: 2 }}>
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
            data-testid="chapter-summary-generate"
            onClick={handleGenerateSummary}
            disabled={genLoading}
            style={{ width: '100%', marginBottom: 6 }}
          >
            {genLoading ? '⏳ AI 正在分析正文...' : '📝 生成章节上下文'}
          </button>
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
              background: validation.passed ? 'color-mix(in srgb, var(--color-success) 6%, transparent)' : validation.safeToContext ? 'color-mix(in srgb, var(--color-warning) 6%, transparent)' : 'color-mix(in srgb, var(--color-error) 6%, transparent)',
              border: `1px solid ${validation.passed ? 'color-mix(in srgb, var(--color-success) 25%, transparent)' : validation.safeToContext ? 'color-mix(in srgb, var(--color-warning) 25%, transparent)' : 'color-mix(in srgb, var(--color-error) 25%, transparent)'}`,
            }}>
              <div style={{ fontWeight: 600, color: validation.passed ? 'var(--color-success)' : validation.safeToContext ? 'var(--color-warning-text)' : 'var(--color-error)' }}>
                {validation.passed ? '✅ 校验通过' : validation.safeToContext ? '⚠️ 校验有警告' : '❌ 校验失败'}
                （{validation.score} 分）
              </div>
              {validation.problems.map((p, i) => (
                <div key={i} style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>• {p.message}</div>
              ))}
              {!validation.safeToContext && (
                <div style={{ color: 'var(--color-error)', marginTop: 4, fontWeight: 500 }}>
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
            <button
              className="btn btn-primary btn-sm"
              data-testid="chapter-summary-save"
              onClick={handleSaveSummary}
              disabled={genLoading}
              style={{ flex: 1 }}
            >
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
          <span data-testid="chapter-summary-save-success">✅ 章节上下文已保存成功！</span>
        </div>
      )}

      {/* 已有总结显示 */}
      {summary && (
        <>
          {/* 状态标签 */}
          <div className="panel-section" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {summary.validationStatus === 'passed' && (
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--color-success) 13%, transparent)', color: 'var(--color-success)' }}>✅ 校验通过</span>
            )}
            {summary.validationStatus === 'failed' && (
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--color-error) 13%, transparent)', color: 'var(--color-error)' }}>❌ 校验未通过</span>
            )}
            {summary.enabled && (
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--color-primary) 13%, transparent)', color: 'var(--color-primary)' }}>📌 已启用</span>
            )}
            {!summary.enabled && (
              <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: 'color-mix(in srgb, var(--color-text-muted) 13%, transparent)', color: 'var(--color-text-muted)' }}>⏸ 已停用</span>
            )}
            {summary.volumeId && (
              <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>📂 已归卷</span>
            )}
          </div>

          <div
            className="panel-section"
            data-testid="chapter-summary-record"
            data-summary-id={summary.id}
            data-summary-expired={summary.isExpired ? 'true' : 'false'}
          >
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
                setGenError('');
                try {
                  await chapterSummaryService.setEnabled(summary.id, !summary.enabled);
                  setSummary({ ...summary, enabled: !summary.enabled });
                } catch (error: unknown) {
                  appLogger.error(error);
                  setGenError(describeUnknownError(error, '章节上下文启用状态保存失败'));
                }
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
