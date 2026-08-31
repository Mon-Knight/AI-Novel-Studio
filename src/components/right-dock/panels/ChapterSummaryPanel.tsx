import { appLogger } from '../../../services/observability/appLogger';
/**
 * AI Novel Studio - 章节总结查看面板 (v1.7.13 升级为章节上下文)
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Chapter } from '../../../types/chapter';
import type {
  ChapterSummary,
  ChapterSummarizeResult,
  ChapterSummaryValidation,
} from '../../../types/chapterSummary';
import { chapterSummaryService } from '../../../services/context/chapterSummaryService';
import { chapterContextPersistenceService } from '../../../services/context/chapterContextPersistenceService';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { chapterSummarizeService } from '../../../services/ai/chapterSummarizeService';
import { validateSummary } from '../../../services/ai/summaryValidator';
import { aiSettingsService } from '../../../services/ai/aiClient';
import { cancelLoadingOperation, runWithLoading } from '../../../lib/runWithLoading';
import type { ChapterDraft } from '../../../types/ai';
import { describeUnknownError } from '../../../utils/errorMessage';
import { ChapterSummaryPanelView } from './ChapterSummaryPanelView';

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
    } finally {
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
      setGenError(
        '当前章节没有足够的正文内容。请先生成或编辑正文，并在右侧工具栏确认采用后再生成总结。',
      );
      return;
    }

    // 检查是否属于某个卷
    if (!chapter.volumeId) {
      setGenError('当前章节未归属任何卷，请先将章节加入卷后再生成章节上下文。');
      return;
    }

    setGenLoading(true);
    setGenError('');
    setGenResult(null);
    setValidation(null);
    setSaveSuccess(false);
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
    setGenLoading(true);
    setGenError('');
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
          setStage('原子保存章节上下文……');
          setMessage('正在一次提交总结、上下文记录、角色状态和章节状态……');
          const saved = await chapterContextPersistenceService.save({
            novelId,
            chapterId: chapter.id,
            adoptedDraftId: adoptedDraft?.id || '',
            summary: {
              novelId,
              chapterId: chapter.id,
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
              draftVersion: adoptedDraft?.versionNo,
            },
            contextRecords: genResult.contextRecords.map((record) => ({
              ...record,
              novelId,
              chapterId: chapter.id,
              volumeId: chapter.volumeId,
              isActive: validation?.safeToContext !== false,
              draftVersion: adoptedDraft?.versionNo,
            })),
            characterStates: genResult.characterChanges.flatMap((change) =>
              change.characterId
                ? [
                    {
                      novelId,
                      characterId: change.characterId,
                      chapterId: chapter.id,
                      stateSummary: change.stateSummary,
                      relationshipChanges: change.relationshipChanges,
                      goalChanges: change.goalChanges,
                      location: change.location,
                      healthState: change.healthState,
                      knowledgeState: change.knowledgeState,
                    },
                  ]
                : [],
            ),
          });

          setSummary(saved.summary);
          setSaveSuccess(true);
          setGenResult(null);
          setValidation(null);
          setTimeout(() => setSaveSuccess(false), 3000);
        },
      );
    } catch (e: unknown) {
      setGenError(describeUnknownError(e, '保存总结失败'));
    } finally {
      setGenLoading(false);
    }
  };

  const handleToggleSummary = async () => {
    if (!summary) return;
    setGenError('');
    try {
      await chapterSummaryService.setEnabled(summary.id, !summary.enabled);
      setSummary({ ...summary, enabled: !summary.enabled });
    } catch (error: unknown) {
      appLogger.error(error);
      setGenError(describeUnknownError(error, '章节上下文启用状态保存失败'));
    }
  };

  const aiSettings = aiSettingsService.getSettings();

  if (!chapter)
    return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择章节</div>;
  if (loading)
    return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>加载中...</div>;

  return (
    <ChapterSummaryPanelView
      aiSettings={aiSettings}
      chapter={chapter}
      summary={summary}
      genResult={genResult}
      validation={validation}
      genLoading={genLoading}
      genError={genError}
      saveSuccess={saveSuccess}
      onGenerateSummary={handleGenerateSummary}
      onSaveSummary={handleSaveSummary}
      onDiscardResult={() => {
        setGenResult(null);
        setValidation(null);
      }}
      onToggleSummary={handleToggleSummary}
    />
  );
}

export default ChapterSummaryPanel;
