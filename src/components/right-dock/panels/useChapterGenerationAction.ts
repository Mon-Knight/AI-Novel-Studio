import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type {
  AiSettings,
  ChapterDraft,
  ChapterGenerationContext,
  OutlineKeyPoint,
} from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type { StyleProfile } from '../../../types/style';
import type { OutputProfile } from '../../../types/output';
import type { DraftResultMetadata } from '../../../types/workspaceSafety';
import { appLogger } from '../../../services/observability/appLogger';
import { createAiClient } from '../../../services/ai/aiClient';
import { buildFreshChapterGenerationContext } from '../../../services/prompt/contextBuilder';
import { buildGenerateRequest } from '../../../services/prompt/promptOrchestrator';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { notifyNative } from '../../../utils/nativeNotification';
import { aiTaskService } from '../../../services/ai/aiTaskService';
import { cancelLoadingOperation, runWithLoading } from '../../../lib/runWithLoading';
import { hashTextContent } from '../../../utils/contentHash';
import { describeUnknownError } from '../../../utils/errorMessage';
import {
  isAiRequestCancelled,
  throwIfAiRequestCancelled,
} from '../../../services/ai/aiCancellation';
import { settleAiTaskError } from '../../../services/ai/aiTaskCancellation';
import { confirmInfo } from '../../../utils/nativeDialog';
import type { GenerationValidationState } from './aiGenerateValidation';
import {
  buildValidationSnapshot,
  buildValidationWarningText,
  getChapterCharacterNames,
  namesText,
} from './aiGenerateValidation';
import type { StreamPreviewStatus } from './useGenerationStreamPreview';

interface UseChapterGenerationActionOptions {
  novelId?: string;
  chapter?: Chapter;
  currentDraftId?: string;
  currentDraftVersion?: number;
  currentEditorContent?: string;
  currentContentHash?: string;
  genMode: 'new' | 'rewrite';
  userInstruction: string;
  selectedStyleId: string;
  selectedOutputId: string;
  wordCountDraft: number;
  availableStyles: StyleProfile[];
  availableOutputs: OutputProfile[];
  settings: AiSettings;
  generating: boolean;
  revising: boolean;
  liveNovelIdRef: MutableRefObject<string>;
  liveChapterIdRef: MutableRefObject<string>;
  streamBufferRef: MutableRefObject<string>;
  beginStreamPreview: () => void;
  flushStreamPreview: () => void;
  handleStreamEvent: (
    event: import('../../../types/ai').AiStreamEvent,
    target: { novelId: string; chapterId: string },
  ) => void;
  setStreamPreviewStatus: Dispatch<SetStateAction<StreamPreviewStatus>>;
  setGenerating: Dispatch<SetStateAction<boolean>>;
  setStatusMsg: Dispatch<SetStateAction<string>>;
  setErrorMsg: Dispatch<SetStateAction<string>>;
  setValidationState: Dispatch<SetStateAction<GenerationValidationState | null>>;
  setContextSummary: Dispatch<SetStateAction<ChapterGenerationContext | null>>;
  setPromptDebug: Dispatch<
    SetStateAction<import('../../../types/ai').ChapterPromptDebugInfo | null>
  >;
  setLatestGeneratedDraft: Dispatch<SetStateAction<ChapterDraft | null>>;
  setLatestGeneratedTarget: Dispatch<SetStateAction<DraftResultMetadata | null>>;
  onGenerated?: (draft: ChapterDraft, metadata?: DraftResultMetadata) => void;
}

export function useChapterGenerationAction({
  novelId,
  chapter,
  currentDraftId,
  currentDraftVersion,
  currentEditorContent,
  currentContentHash,
  genMode,
  userInstruction,
  selectedStyleId,
  selectedOutputId,
  wordCountDraft,
  availableStyles,
  availableOutputs,
  settings,
  generating,
  revising,
  liveNovelIdRef,
  liveChapterIdRef,
  streamBufferRef,
  beginStreamPreview,
  flushStreamPreview,
  handleStreamEvent,
  setStreamPreviewStatus,
  setGenerating,
  setStatusMsg,
  setErrorMsg,
  setValidationState,
  setContextSummary,
  setPromptDebug,
  setLatestGeneratedDraft,
  setLatestGeneratedTarget,
  onGenerated,
}: UseChapterGenerationActionOptions) {
  const handleGenerate = async (options?: { retryMissingPoints?: OutlineKeyPoint[] }) => {
    if (!novelId || !chapter) return;
    const requestTarget = {
      novelId,
      chapterId: chapter.id,
      sourceDraftId: currentDraftId,
      sourceRevision: currentDraftVersion,
      baseContentHash: currentContentHash || hashTextContent(currentEditorContent || ''),
    };

    let preflightContext: ChapterGenerationContext;
    try {
      const retryInstruction = options?.retryMissingPoints?.length
        ? [
            '上一次生成未遵循章节大纲，本次必须严格覆盖以下缺失点：',
            ...options.retryMissingPoints.map((point, index) => `${index + 1}. ${point.text}`),
          ].join('\n')
        : '';
      const mergedInstruction =
        [userInstruction.trim(), retryInstruction].filter(Boolean).join('\n\n') || undefined;
      preflightContext = await buildFreshChapterGenerationContext({
        novelId,
        volumeId: chapter.volumeId,
        chapterId: chapter.id,
        userInstruction: mergedInstruction,
        styleId: selectedStyleId || undefined,
        outputId: selectedOutputId || undefined,
        targetWordCount: wordCountDraft || undefined,
        draftContent: genMode === 'rewrite' ? currentEditorContent?.trim() || undefined : undefined,
      });
      setContextSummary(preflightContext);
      setPromptDebug(null);
    } catch (e: unknown) {
      setErrorMsg(describeUnknownError(e, '生成前读取最新上下文失败'));
      return;
    }

    const chapterCharacterCount = preflightContext.chapterCharacterList?.length || 0;
    const requiredCharacterCount = preflightContext.requiredCharacters?.length || 0;
    if (chapterCharacterCount > 0 && requiredCharacterCount === 0) {
      setStatusMsg('已将本章出场角色默认视为必须出场角色。');
    }

    const preflightWarnings: string[] = [];
    if ((preflightContext.chapterOutline?.trim().length || 0) < 30) {
      preflightWarnings.push('当前章节大纲过短或为空，生成正文可能不遵循规划。');
    }
    if ((preflightContext.outlineKeyPoints?.length || 0) === 0) {
      preflightWarnings.push('未能从章节大纲中提取关键剧情点，建议补充大纲。');
    }
    if (preflightWarnings.length > 0) {
      const ok = await confirmInfo({
        title: '生成前提示',
        message: `⚠️ ${preflightWarnings.join('\n')}\n\n本次生成将尽量使用分卷大纲、总纲和本章目标，但生成内容仍可能偏离规划。\n\n建议先在大纲面板中补充或保存章节大纲。\n\n是否仍然继续生成？`,
        testId: 'generation-preflight',
      });
      if (!ok) return;
    }

    if (generating || revising) return;
    setGenerating(true);
    setErrorMsg('');
    setValidationState(null);
    beginStreamPreview();
    let activeTaskId: string | undefined;
    let activeSignal: AbortSignal | undefined;
    let releaseTaskCancellation: () => void = () => {};

    try {
      await runWithLoading(
        {
          title: genMode === 'rewrite' ? 'AI 正在重新生成正文' : 'AI 正在生成正文',
          initialMessage: '正在构建上下文……',
          successMessage: '正文已生成，校验结果已显示',
          errorMessage: 'AI 生成失败',
          cancelable: true,
        },
        async ({ setMessage, setStage, setPercent, setCancelable, signal, operationId }) => {
          activeSignal = signal;
          // 点击生成前已经强制构建 fresh context；这里沿用同一份上下文进入最终 prompt。
          const ctx: ChapterGenerationContext = preflightContext;

          const hasOutline = ctx?.chapterOutline ? '有' : '无';
          const hasChapterGoal = ctx?.chapterGoal ? '有' : '无';
          const charCount = ctx?.chapterCharacterList?.length || 0;
          const eventCount = ctx?.chapterEvents ? ctx.chapterEvents.match(/\n- /g)?.length || 1 : 0;
          const hasPrevContext = ctx?.previousContext ? '有' : '无';
          const styleName = availableStyles.find((s) => s.id === selectedStyleId)?.name || '默认';
          const outputName =
            availableOutputs.find((o) => o.id === selectedOutputId)?.name || '默认';

          const inputSummary = [
            `生成：${novelId.slice(0, 8)}/${ctx.chapterTitle}`,
            `大纲：${hasOutline}`,
            `目标：${hasChapterGoal}`,
            `角色：${charCount}个`,
            `必须出场：${ctx.requiredCharacters?.length || 0}个`,
            `事件：${eventCount}个`,
            `前文：${hasPrevContext}`,
            `风格：${styleName}`,
            `输出：${outputName}`,
            `字数：${ctx.targetWordCount || wordCountDraft}`,
          ].join('，');

          // 创建 AI 任务记录
          const task = await aiTaskService
            .create('chapter_generate', {
              novelId,
              chapterId: chapter.id,
              runtimeMode: settings.runtimeMode,
              provider: settings.provider,
              modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
              inputSummary,
            })
            .catch(() => null);
          activeTaskId = task?.id;
          releaseTaskCancellation = task
            ? aiTaskService.registerActiveExecution(task.id, () =>
                cancelLoadingOperation(operationId),
              )
            : () => {};

          setStage('正在组装提示词……');
          setPercent(15);

          // 2. 组装提示词
          setStage('正在分析角色、事件和风格方案……');
          setPercent(25);
          const request = await buildGenerateRequest(ctx);
          setPromptDebug(request.promptDebug ?? null);

          // 3. 调用 AI
          setStage('正在请求 AI 生成正文……');
          setMessage('AI 正在输出章节内容，请稍候……');
          setPercent(40);
          const client = createAiClient(settings);
          const response = await client.generate(request, {
            signal,
            cancel: () => cancelLoadingOperation(operationId),
            stream: true,
            onStreamEvent: (event) => {
              handleStreamEvent(event, requestTarget);
              if (event.type === 'delta' && event.sequence % 12 === 0) {
                setMessage(`AI 正在输出章节内容……已接收 ${streamBufferRef.current.length} 字符`);
              }
            },
          });
          throwIfAiRequestCancelled(signal);
          streamBufferRef.current = response.text;
          flushStreamPreview();
          setStreamPreviewStatus('completed');

          setPercent(80);
          setStage('正在校验生成结果……');
          const validation = buildValidationSnapshot(ctx, response.text);
          const validationWarning = buildValidationWarningText(validation);
          setMessage('正在保存生成结果……');
          setCancelable(false);
          throwIfAiRequestCancelled(signal);

          // 4. 保存为草稿
          const draft = await draftVersionService.create({
            novelId,
            chapterId: chapter.id,
            content: response.text,
            source: genMode === 'rewrite' ? 'ai_regenerated' : 'ai_generated',
            aiTaskId: task?.id,
            note: validation.note,
          });
          const validationWithDraft: GenerationValidationState = {
            draftId: draft.id,
            ...validation,
          };
          const resultMetadata: DraftResultMetadata = {
            ...requestTarget,
            resultId: draft.id,
            source: 'ai_generate',
          };
          if (
            liveNovelIdRef.current === requestTarget.novelId &&
            liveChapterIdRef.current === requestTarget.chapterId
          ) {
            setValidationState(validationWithDraft);
          }

          setPercent(95);

          // 5. 更新 AI 任务记录
          if (task) {
            await aiTaskService.markSucceeded(task.id, {
              resultText: `字数：${draft.wordCount}，首段：${response.text.slice(0, 200)}${validationWarning ? ' ' + validationWarning : ''}`,
              promptSnapshot: `template=${request.promptTemplateSource || 'unknown'} length=${request.promptDebug?.promptLength || request.messages[0]?.content?.length || 0} chapterOutline=${request.promptDebug?.includesChapterOutlineText ? 'yes' : 'no'} outlineChecklist=${request.promptDebug?.includesOutlineChecklistText ? 'yes' : 'no'} outlineScore=${validation.outlineCompliance.score} volumeOutline=${request.promptDebug?.includesVolumeOutlineText ? 'yes' : 'no'} masterOutline=${request.promptDebug?.includesMasterOutlineText ? 'yes' : 'no'} requiredCharacters=${request.promptDebug?.requiredCharactersCount || 0}:${request.promptDebug?.requiredCharacterNames.join('、') || ''}`,
              tokenInput: response.tokenInput,
              tokenOutput: response.tokenOutput,
              tokenTotal: response.tokenTotal,
            });
          }

          setPercent(100);
          setStage('生成完成');

          // v1.0.43: 增强调试日志（确认大纲和角色已进入 prompt）
          appLogger.info('[AiGenerate] 生成完成:', {
            chapterId: chapter.id,
            novelId,
            styleProfileId: selectedStyleId || '(未选择)',
            outputControlId: selectedOutputId || '(未选择)',
            hasOutline: !!ctx.chapterOutline,
            outlineLength: ctx.chapterOutline?.length || 0,
            hasVolumeOutline: !!ctx.volumeOutline,
            hasMasterOutline: !!(ctx.masterOutline || ctx.novelOutline),
            chapterGoal: ctx.chapterGoal ? '有' : '无',
            targetWordCount: ctx.targetWordCount,
            chapterCharacters: namesText(getChapterCharacterNames(ctx)),
            requiredCharacters: namesText(validation.requiredNames),
            protagonistNames: ctx.protagonistNames,
            wordCount: draft.wordCount,
            outlineKeyPoints: ctx.outlineKeyPoints?.length || 0,
            outlineComplianceScore: validation.outlineCompliance.score,
            missingOutlinePoints: validation.outlineCompliance.missingPoints.map(
              (point) => point.text,
            ),
            missingRequiredCharacters: validation.missingRequiredNames,
            model: settings.modelName,
            provider: settings.provider,
            promptTemplateSource: request.promptTemplateSource,
            promptLength:
              request.promptDebug?.promptLength || request.messages[0]?.content?.length || 0,
          });

          if (
            liveNovelIdRef.current !== requestTarget.novelId ||
            liveChapterIdRef.current !== requestTarget.chapterId
          ) {
            notifyNative({
              kind: 'success',
              body: `原章节正文已生成并保存（${draft.wordCount} 字）`,
            });
            return;
          }
          onGenerated?.(draft, resultMetadata);
          setLatestGeneratedDraft(draft);
          setLatestGeneratedTarget(resultMetadata);

          // 校验警告提示
          if (validationWarning) {
            setErrorMsg(validationWarning);
            setStatusMsg('正文已生成，但存在校验警告。建议重新生成或按大纲修正后再确认采用。');
          } else {
            setErrorMsg('');
            setStatusMsg('生成完成，大纲遵循检查和角色出场检查通过。');
          }

          // Native Feel P2.2: 生成完成通知
          notifyNative({ kind: 'success', body: `正文生成完成（${draft.wordCount} 字）` });
        },
      );

      setGenerating(false);
    } catch (err: unknown) {
      await settleAiTaskError({
        taskId: activeTaskId,
        error: err,
        signal: activeSignal,
        fallbackMessage: '正文生成失败',
      });
      const msg = err instanceof Error ? err.message : '生成失败';
      flushStreamPreview();
      setStreamPreviewStatus(streamBufferRef.current ? 'interrupted' : 'idle');
      setErrorMsg(isAiRequestCancelled(err) ? '' : msg);
      setStatusMsg('');
      setGenerating(false);

      // Native Feel P2.2: 生成失败通知
      if (!isAiRequestCancelled(err)) {
        notifyNative({ kind: 'error', body: `正文生成失败：${msg}` });
      }

      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        // 错误已由 runWithLoading 显示弹窗，这里只做本地状态清理
      }
    } finally {
      releaseTaskCancellation();
    }
  };

  return handleGenerate;
}
