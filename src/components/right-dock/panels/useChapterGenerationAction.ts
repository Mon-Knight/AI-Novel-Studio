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
import { executeChapterGeneration } from '../../../services/ai/chapterGenerationExecutionService';
import { buildFreshChapterGenerationContext } from '../../../services/prompt/contextBuilder';
import { buildGenerateRequest } from '../../../services/prompt/promptOrchestrator';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { notifyNative } from '../../../utils/nativeNotification';
import { runWithLoading } from '../../../lib/runWithLoading';
import { hashTextContent } from '../../../utils/contentHash';
import { describeUnknownError } from '../../../utils/errorMessage';
import {
  isAiRequestCancelled,
  throwIfAiRequestCancelled,
} from '../../../services/ai/aiCancellation';
import { confirmInfo } from '../../../utils/nativeDialog';
import { chapterEngineeringService } from '../../../services/engineering/chapterEngineeringService';
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

function buildLocalChapterSceneTaskInput(
  context: ChapterGenerationContext,
  requestSourceVersion: string,
  mode: 'new' | 'rewrite',
  sourceDraftId: string | undefined,
  sourceRevision: number | undefined,
  scenePlan?: unknown,
): Record<string, unknown> {
  const beats = [
    ...(context.outlineKeyPoints ?? []).map((point) => point.text.trim()).filter(Boolean),
    context.chapterEvents?.trim() ? `本章事件：${context.chapterEvents.trim()}` : '',
  ].filter(Boolean);
  const constraints = [
    context.protagonistNames ? `主角/视角角色：${context.protagonistNames}` : '',
    context.chapterCharacters ? `本章角色：${context.chapterCharacters}` : '',
    context.styleProfile ? `文风要求：${context.styleProfile}` : '',
    context.outputProfile ? `输出要求：${context.outputProfile}` : '',
    context.forbiddenBehaviors ? `禁止行为：${context.forbiddenBehaviors}` : '',
    '只生成当前场景候选正文，不提前替后续章节揭示未授权信息。',
  ].filter(Boolean);
  const sceneContext = [
    `章节：${context.chapterTitle}`,
    context.volumeTitle ? `分卷：${context.volumeTitle}` : '',
    context.previousContext ? `前文上下文：\n${context.previousContext}` : '',
    context.chapterOutline ? `章节大纲：\n${context.chapterOutline}` : '',
    context.chapterGoal ? `本章目标：${context.chapterGoal}` : '',
    context.chapterSettings ? `章节设定：\n${context.chapterSettings}` : '',
    context.chapterCharacters ? `角色状态：\n${context.chapterCharacters}` : '',
    context.styleProfile ? `风格方案：\n${context.styleProfile}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    chapterTitle: context.chapterTitle,
    targetWordCount: context.targetWordCount,
    contextHash: requestSourceVersion,
    sceneGoal:
      context.chapterGoal?.trim() || context.chapterOutline?.trim() || '推进当前章节的核心目标。',
    sceneBeats: beats.length ? beats.slice(0, 12) : ['完成当前章节的核心事件推进。'],
    sceneConstraints: constraints,
    scenePlan,
    sceneContext:
      sceneContext || `章节：${context.chapterTitle}\n请依据当前章节目标推进一个连续场景。`,
    mode,
    sourceDraftId,
    sourceRevision,
  };
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
          // 点击生成前已经强制构建 fresh context；这里沿用同一份上下文进入最终 prompt。
          const ctx: ChapterGenerationContext = preflightContext;

          // 通过统一执行管线编译并发送章节请求
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
          const requestSourceVersion = hashTextContent(
            request.messages.map((message) => `${message.role}\n${message.content}`).join('\n\n'),
          );
          const engineeringScenePlan =
            settings.localChapterModel?.enabled && genMode !== 'rewrite'
              ? (await chapterEngineeringService.getBundle(chapter.id)).activeState?.scenePlan
              : undefined;
          const response = await executeChapterGeneration({
            novelId,
            chapterId: chapter.id,
            operationId,
            settings,
            request,
            sourceId: `${chapter.id}:${operationId}`,
            sourceVersion: requestSourceVersion,
            taskInput: {
              chapterTitle: ctx.chapterTitle,
              targetWordCount: ctx.targetWordCount || wordCountDraft,
              contextHash: requestSourceVersion,
              promptTemplateSource: request.promptTemplateSource,
              mode: genMode,
              sourceDraftId: currentDraftId,
              sourceRevision: currentDraftVersion,
              ...buildLocalChapterSceneTaskInput(
                ctx,
                requestSourceVersion,
                genMode,
                currentDraftId,
                currentDraftVersion,
                engineeringScenePlan,
              ),
            },
            targetHintJson: requestTarget,
            signal,
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
            aiTaskId: response.taskId,
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
    }
  };

  return handleGenerate;
}
