import { appLogger } from '../../../services/observability/appLogger';
import { useState, useEffect, useCallback, useRef } from 'react';
import { Bot, CheckCircle2, FileText, LoaderCircle, Sparkles, TriangleAlert } from 'lucide-react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterDraft } from '../../../types/ai';
import type { PolishMode, PolishRequestOptions } from '../../../types/polish';
import { PolishModeLabels } from '../../../types/polish';
import { polishService } from '../../../services/quality/polishService';
import { polishAiService } from '../../../services/ai/polishAiService';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { chapterRepository } from '../../../services/database/chapterRepository';
import { aiSettingsService } from '../../../services/ai/aiClient';
import { cancelLoadingOperation, runWithLoading } from '../../../lib/runWithLoading';
import { hashTextContent } from '../../../utils/contentHash';
import { isAiRequestCancelled } from '../../../services/ai/aiCancellation';
import type { AiTextApplyPayload, DraftResultMetadata } from '../../../types/workspaceSafety';
import { describeUnknownError } from '../../../utils/errorMessage';

interface PolishPanelProps {
  novelId?: string;
  chapter?: Chapter;
  onGenerated?: (draft: ChapterDraft, metadata?: DraftResultMetadata) => void;
  onAdopted?: () => void;
  currentEditorContent?: string;
  currentEditorDirty?: boolean;
  currentEditorWordCount?: number;
  currentContentHash?: string;
  currentDraftId?: string;
  currentDraftVersion?: number;
  onApplyAiText?: (payload: AiTextApplyPayload) => Promise<boolean>;
}

const POLISH_MODES: PolishMode[] = [
  'keep_plot',
  'enhance_description',
  'reduce_redundancy',
  'strengthen_conflict',
  'adjust_pacing',
  'unify_style',
  'fix_language',
  'custom',
];

function PolishPanel({
  novelId,
  chapter,
  onGenerated,
  currentEditorContent,
  currentEditorDirty,
  currentEditorWordCount,
  currentContentHash,
  currentDraftId,
  currentDraftVersion,
  onApplyAiText,
}: PolishPanelProps) {
  const liveChapterIdRef = useRef(chapter?.id || '');
  liveChapterIdRef.current = chapter?.id || '';
  const liveNovelIdRef = useRef(novelId || '');
  liveNovelIdRef.current = novelId || '';
  const loadEpochRef = useRef(0);
  const [mode, setMode] = useState<PolishMode>('keep_plot');
  const [customInstruction, setCustomInstruction] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [currentDraft, setCurrentDraft] = useState<ChapterDraft | null>(null);
  const [lastPolishResult, setLastPolishResult] = useState<ChapterDraft | null>(null);
  const [lastPolishTarget, setLastPolishTarget] = useState<DraftResultMetadata | null>(null);

  const loadDraft = useCallback(async () => {
    if (!novelId || !chapter?.id) {
      setCurrentDraft(null);
      return;
    }
    const requestEpoch = ++loadEpochRef.current;
    const requestNovelId = novelId;
    const requestChapterId = chapter.id;
    setCurrentDraft(null);
    const draft = await draftVersionService.getLatestByChapterId(requestChapterId);
    if (
      loadEpochRef.current !== requestEpoch ||
      liveNovelIdRef.current !== requestNovelId ||
      liveChapterIdRef.current !== requestChapterId
    )
      return;
    if (draft && (draft.novelId !== requestNovelId || draft.chapterId !== requestChapterId)) {
      setError('草稿与润色目标不一致');
      return;
    }
    setCurrentDraft(draft);
  }, [novelId, chapter?.id]);

  useEffect(() => {
    loadDraft();
  }, [loadDraft]);

  // 切换章节时清除上次润色结果
  useEffect(() => {
    setLastPolishResult(null);
    setLastPolishTarget(null);
    setError('');
    setStatusMsg('');
  }, [chapter?.id]);

  const handleRunPolish = async () => {
    if (!novelId || !chapter || !currentDraft) return;
    if (currentDraft.novelId !== novelId || currentDraft.chapterId !== chapter.id) {
      setError('当前草稿与润色目标不一致，请重新选择章节');
      return;
    }
    const requestNovelId = novelId;
    const requestChapterId = chapter.id;
    const requestBaseHash =
      currentContentHash || hashTextContent(currentEditorContent ?? currentDraft.content);
    const requestSourceDraftId = currentDraftId || currentDraft.id;
    const requestSourceRevision = currentDraftVersion || currentDraft.versionNo;
    const sourceContent = currentEditorContent ?? currentDraft.content;
    const sourceWordCount = currentEditorWordCount ?? currentDraft.wordCount;
    if (sourceContent.trim().length < 10 || sourceWordCount < 10) {
      setError('正文过短，无法润色');
      return;
    }
    setLoading(true);
    setError('');
    setStatusMsg('');
    let polishRecordId: string | undefined;
    let activeSignal: AbortSignal | undefined;

    try {
      await runWithLoading(
        {
          title: 'AI 正在润色正文',
          initialMessage: '正在准备润色参数……',
          successMessage: `润色完成！`,
          errorMessage: '润色失败',
          cancelable: true,
        },
        async ({ setMessage, setStage, setPercent, setCancelable, signal, operationId }) => {
          activeSignal = signal;
          setStage('创建润色任务……');
          setPercent(5);
          const options: PolishRequestOptions = {
            mode,
            customInstruction: customInstruction.trim() || undefined,
            preservePlot: true,
            preserveCharacters: true,
            preserveKeyEvents: true,
          };
          let sourceDraft = currentDraft;
          if (currentEditorDirty || currentDraft.content !== sourceContent) {
            setMessage('正在保存当前正文快照……');
            sourceDraft = await draftVersionService.create({
              novelId: requestNovelId,
              chapterId: requestChapterId,
              title: `${chapter.title} - 润色快照`,
              content: sourceContent,
              source: 'user_edited',
              note: '润色正文快照',
            });
            if (
              liveNovelIdRef.current === requestNovelId &&
              liveChapterIdRef.current === requestChapterId
            ) {
              setCurrentDraft(sourceDraft);
              onGenerated?.(sourceDraft, {
                resultId: sourceDraft.id,
                novelId: requestNovelId,
                chapterId: requestChapterId,
                sourceDraftId: requestSourceDraftId,
                sourceRevision: requestSourceRevision,
                baseContentHash: requestBaseHash,
                source: 'polish',
              });
            }
          }
          const record = await polishService.create({
            novelId: requestNovelId,
            chapterId: requestChapterId,
            sourceDraftId: sourceDraft.id,
            mode,
            instruction: customInstruction.trim() || undefined,
          });
          polishRecordId = record.id;
          await polishService.update(record.id, { status: 'running' });

          setMessage('正在分析原文……');
          setStage('AI 正在润色正文……');
          setPercent(30);
          const polishedText = await polishAiService.runPolish(
            {
              novelId: requestNovelId,
              chapterId: requestChapterId,
              sourceDraftId: sourceDraft.id,
              draftContent: sourceContent,
              chapterTitle: chapter.title,
              chapterOutline: chapter.outline,
              options,
            },
            { signal, cancel: () => cancelLoadingOperation(operationId) },
          );

          setMessage('正在保存润色结果……');
          setPercent(80);
          setCancelable(false);
          const resultDraft = await draftVersionService.create({
            novelId: requestNovelId,
            chapterId: requestChapterId,
            content: polishedText,
            source: 'ai_polished',
            note: `${PolishModeLabels[mode]}润色`,
          });

          if (!chapter.adoptedDraftId) {
            await chapterRepository
              .update(requestChapterId, { status: 'polished' })
              .catch((statusError) => {
                appLogger.warn(
                  '[PolishPanel] polished draft saved but chapter status refresh failed',
                  {
                    chapterId: requestChapterId,
                    error: statusError,
                  },
                );
              });
          }

          await polishService.update(record.id, {
            status: 'succeeded',
            resultDraftId: resultDraft.id,
          });
          setPercent(100);

          if (
            liveNovelIdRef.current !== requestNovelId ||
            liveChapterIdRef.current !== requestChapterId
          )
            return;
          const resultMetadata: DraftResultMetadata = {
            resultId: resultDraft.id,
            novelId: requestNovelId,
            chapterId: requestChapterId,
            sourceDraftId: sourceDraft.id,
            sourceRevision: sourceDraft.versionNo,
            baseContentHash: requestBaseHash,
            source: 'polish',
          };
          onGenerated?.(resultDraft, resultMetadata);
          setLastPolishResult(resultDraft);
          setLastPolishTarget(resultMetadata);
          setStatusMsg(`润色完成！已保存为草稿 v${resultDraft.versionNo}。`);
        },
      );
    } catch (e: unknown) {
      const cancelled = activeSignal?.aborted || isAiRequestCancelled(e);
      if (polishRecordId) {
        await polishService.update(polishRecordId, {
          status: cancelled ? 'cancelled' : 'failed',
          errorMessage: cancelled ? undefined : describeUnknownError(e, '润色失败'),
        });
      }
      setError(cancelled ? '' : describeUnknownError(e, '润色失败'));
    } finally {
      setLoading(false);
    }
  };

  if (!chapter)
    return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择章节</div>;

  const aiSettings = aiSettingsService.getSettings();

  return (
    <div>
      {/* AI 模式状态 */}
      <div className="panel-section" style={{ fontSize: 12, lineHeight: 1.8 }}>
        <div
          className="panel-section-title"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Bot size={14} strokeWidth={1.8} aria-hidden="true" />
          AI 状态
        </div>
        <div>模式：{aiSettings.runtimeMode === 'mock' ? 'Mock 模式' : '真实 API'}</div>
        {aiSettings.runtimeMode === 'api' && (
          <>
            <div>模型：{aiSettings.modelName || '未配置'}</div>
            {!aiSettings.apiKey && (
              <div
                style={{
                  color: 'var(--color-error)',
                  marginTop: 4,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <TriangleAlert size={14} strokeWidth={1.8} aria-hidden="true" />
                未配置 API Key，请先到设置中心配置
              </div>
            )}
          </>
        )}
      </div>
      <div className="panel-section">
        <div
          className="panel-section-title"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Sparkles size={14} strokeWidth={1.8} aria-hidden="true" />
          润色模式
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
          第{chapter.chapterNumber}章 {chapter.title}
        </div>
        {currentDraft && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
            草稿 v{currentDraft.versionNo}（{currentDraft.wordCount} 字）
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {POLISH_MODES.map((m) => (
            <button
              key={m}
              className={`btn btn-sm ${mode === m ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setMode(m)}
            >
              {PolishModeLabels[m]}
            </button>
          ))}
        </div>
        {mode === 'custom' && (
          <div style={{ marginTop: 8 }}>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>自定义要求</label>
            <textarea
              className="input"
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              rows={2}
              placeholder="输入润色具体要求..."
              style={{ width: '100%', resize: 'vertical', fontSize: 12 }}
            />
          </div>
        )}
      </div>

      <div className="panel-section">
        <button
          className="btn btn-primary btn-sm"
          onClick={handleRunPolish}
          disabled={loading}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          {loading ? (
            <>
              <LoaderCircle size={14} strokeWidth={1.8} aria-hidden="true" />
              润色中...
            </>
          ) : (
            <>
              <Sparkles size={14} strokeWidth={1.8} aria-hidden="true" />
              开始润色
            </>
          )}
        </button>
        {error && (
          <div style={{ fontSize: 12, color: 'var(--color-error)', marginTop: 6 }}>{error}</div>
        )}
        {statusMsg && (
          <div style={{ fontSize: 12, color: 'var(--color-success)', marginTop: 6 }}>
            {statusMsg}
          </div>
        )}
      </div>

      {lastPolishResult && (
        <div className="panel-section">
          <div
            className="panel-section-title"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <FileText size={14} strokeWidth={1.8} aria-hidden="true" />
            应用润色结果
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>
            润色结果已保存为草稿 v{lastPolishResult.versionNo}（{lastPolishResult.wordCount} 字）
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() =>
                onApplyAiText?.({
                  ...(lastPolishTarget as DraftResultMetadata),
                  mode: 'append',
                  text: lastPolishResult.content,
                  source: 'polish',
                })
              }
              disabled={
                !onApplyAiText || !lastPolishTarget || lastPolishResult.id === currentDraftId
              }
              style={{ flex: 1 }}
              title="追加到当前正文末尾"
            >
              追加到正文
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() =>
                onApplyAiText?.({
                  ...(lastPolishTarget as DraftResultMetadata),
                  mode: 'replace_all',
                  text: lastPolishResult.content,
                  source: 'polish',
                })
              }
              disabled={
                !onApplyAiText || !lastPolishTarget || lastPolishResult.id === currentDraftId
              }
              style={{ flex: 1 }}
            >
              替换全文
            </button>
          </div>
        </div>
      )}

      <div
        className="panel-section"
        style={{ fontSize: 12, color: 'var(--color-text-muted)', lineHeight: 1.6 }}
      >
        <div>润色结果将保存为新的草稿版本，不会覆盖当前正文。</div>
        {['保持剧情不变', '保持人物关系', '保持关键事件'].map((item, index) => (
          <div
            key={item}
            style={{
              marginTop: index === 0 ? 4 : undefined,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <CheckCircle2 size={13} strokeWidth={1.8} aria-hidden="true" />
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

export default PolishPanel;
