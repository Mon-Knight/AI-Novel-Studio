import { useState, useEffect, useRef } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterDraft } from '../../../types/ai';
import { createAiClient, aiSettingsService } from '../../../services/ai/aiClient';
import { buildFreshChapterGenerationContext } from '../../../services/prompt/contextBuilder';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { showToast } from '../../../utils/toast';
import { confirmInfo, confirmDanger } from '../../../utils/nativeDialog';
import { aiTaskService } from '../../../services/ai/aiTaskService';
import { cancelLoadingOperation, runWithLoading } from '../../../lib/runWithLoading';
import { reviseChapterByOutline } from '../../../services/ai/chapterRevisionService';
import { checkOutlineCompliance } from '../../../services/ai/outlineComplianceChecker';
import { hashTextContent } from '../../../utils/contentHash';
import type { AiTextApplyPayload, DraftResultMetadata } from '../../../types/workspaceSafety';
import {
  isAiRequestCancelled,
  throwIfAiRequestCancelled,
} from '../../../services/ai/aiCancellation';
import { settleAiTaskError } from '../../../services/ai/aiTaskCancellation';
import {
  buildValidationSnapshot,
  buildValidationWarningText,
  draftHasAdoptionRisk,
} from './aiGenerateValidation';
import type { GenerationValidationState } from './aiGenerateValidation';
import { useGenerationStreamPreview } from './useGenerationStreamPreview';
import { useAiGenerateResources } from './useAiGenerateResources';
import { useChapterGenerationAction } from './useChapterGenerationAction';
import { AiGeneratePanelView } from './AiGeneratePanelView';

interface AiGeneratePanelProps {
  novelId?: string;
  chapter?: Chapter;
  onGenerated?: (draft: ChapterDraft, metadata?: DraftResultMetadata) => void;
  onAdopted?: () => void;
  contextVersion?: number;
  currentDraftId?: string;
  currentDraftVersion?: number;
  currentEditorContent?: string;
  currentContentHash?: string;
  onApplyAiText?: (payload: AiTextApplyPayload) => Promise<boolean>;
  onBeforeDocumentChange?: () => Promise<boolean>;
}

function AiGeneratePanel({
  novelId,
  chapter,
  onGenerated,
  onAdopted,
  contextVersion = 0,
  currentDraftId,
  currentDraftVersion,
  currentEditorContent,
  currentContentHash,
  onApplyAiText,
  onBeforeDocumentChange,
}: AiGeneratePanelProps) {
  const liveChapterIdRef = useRef(chapter?.id || '');
  liveChapterIdRef.current = chapter?.id || '';
  const liveNovelIdRef = useRef(novelId || '');
  liveNovelIdRef.current = novelId || '';
  const [userInstruction, setUserInstruction] = useState('');
  const [generating, setGenerating] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [genMode, setGenMode] = useState<'new' | 'rewrite'>('new');
  const [validationState, setValidationState] = useState<GenerationValidationState | null>(null);
  const [revising, setRevising] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const adoptingRef = useRef(false);
  const [latestGeneratedDraft, setLatestGeneratedDraft] = useState<ChapterDraft | null>(null);
  const [latestGeneratedTarget, setLatestGeneratedTarget] = useState<DraftResultMetadata | null>(
    null,
  );
  const {
    streamPreview,
    streamPreviewStatus,
    streamBufferRef,
    setStreamPreviewStatus,
    flushStreamPreview,
    beginStreamPreview,
    resetStreamPreview,
    handleStreamEvent,
  } = useGenerationStreamPreview(liveNovelIdRef, liveChapterIdRef);

  const {
    availableStyles,
    availableOutputs,
    selectedStyleId,
    setSelectedStyleId,
    selectedOutputId,
    setSelectedOutputId,
    wordCountDraft,
    setWordCountDraft,
    wordCountSaving,
    wordCountSaved,
    setWordCountSaved,
    handleSaveWordCount,
    contextSummary,
    setContextSummary,
    promptDebug,
    setPromptDebug,
    showContext,
    contextCount,
    contextLoadError,
    handlePreviewContext,
  } = useAiGenerateResources({ novelId, chapter, contextVersion, onError: setErrorMsg });

  useEffect(() => {
    setValidationState(null);
    setLatestGeneratedDraft(null);
    setLatestGeneratedTarget(null);
    resetStreamPreview();
  }, [chapter?.id, resetStreamPreview]);

  const settings = aiSettingsService.getSettings();

  const handleGenerate = useChapterGenerationAction({
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
  });

  const handleReviseByOutline = async () => {
    if (!novelId || !chapter) return;
    if (generating || revising) return;
    const requestChapterId = chapter.id;
    setRevising(true);
    setGenerating(true);
    setErrorMsg('');
    let activeTaskId: string | undefined;
    let activeSignal: AbortSignal | undefined;
    let releaseTaskCancellation: () => void = () => {};

    try {
      const latest = await draftVersionService.getLatestByChapterId(chapter.id);
      if (!latest) {
        setErrorMsg('没有可修正的草稿');
        return;
      }
      const requestTarget = {
        novelId,
        chapterId: requestChapterId,
        sourceDraftId: latest.id,
        sourceRevision: latest.versionNo,
        baseContentHash: hashTextContent(latest.content),
      };

      const ctx = await buildFreshChapterGenerationContext({
        novelId,
        volumeId: chapter.volumeId,
        chapterId: chapter.id,
        styleId: selectedStyleId || undefined,
        outputId: selectedOutputId || undefined,
        targetWordCount: wordCountDraft || undefined,
      });
      setContextSummary(ctx);

      const baseCompliance =
        validationState?.draftId === latest.id
          ? validationState.outlineCompliance
          : checkOutlineCompliance(latest.content, ctx.outlineKeyPoints || []);
      const missingPoints =
        baseCompliance.missingPoints.length > 0
          ? baseCompliance.missingPoints
          : ctx.outlineKeyPoints || [];

      if ((ctx.outlineKeyPoints?.length || 0) === 0) {
        setErrorMsg('未能从章节大纲中提取关键剧情点，暂时无法按大纲修正。请先补充章节大纲。');
        return;
      }

      beginStreamPreview();
      await runWithLoading(
        {
          title: 'AI 正在按大纲修正正文',
          initialMessage: '正在读取最新章节大纲和草稿……',
          successMessage: '修正版正文已生成，校验结果已显示',
          errorMessage: '按大纲修正失败',
          cancelable: true,
        },
        async ({ setMessage, setStage, setPercent, setCancelable, signal, operationId }) => {
          activeSignal = signal;
          const task = await aiTaskService
            .create('chapter_rewrite', {
              novelId,
              chapterId: chapter.id,
              runtimeMode: settings.runtimeMode,
              provider: settings.provider,
              modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
              inputSummary: `按大纲修正：${ctx.chapterTitle}，缺失${missingPoints.length}项，原草稿v${latest.versionNo}`,
            })
            .catch(() => null);
          activeTaskId = task?.id;
          releaseTaskCancellation = task
            ? aiTaskService.registerActiveExecution(task.id, () =>
                cancelLoadingOperation(operationId),
              )
            : () => {};

          setStage('正在组装修正提示词……');
          setPercent(25);
          const client = createAiClient(settings);
          const response = await reviseChapterByOutline(
            {
              originalDraft: latest.content,
              chapterTitle: ctx.chapterTitle,
              chapterOutline: ctx.chapterOutline,
              outlineChecklistText: ctx.outlineChecklistText,
              missingPoints,
              requiredCharacters: ctx.requiredCharacters,
              targetWordCount: ctx.targetWordCount || wordCountDraft,
            },
            client,
            {
              signal,
              cancel: () => cancelLoadingOperation(operationId),
              stream: true,
              onStreamEvent: (event) => {
                handleStreamEvent(event, requestTarget);
                if (event.type === 'delta' && event.sequence % 12 === 0) {
                  setMessage(`AI 正在修正章节内容……已接收 ${streamBufferRef.current.length} 字符`);
                }
              },
            },
          );
          throwIfAiRequestCancelled(signal);
          streamBufferRef.current = response.text;
          flushStreamPreview();
          setStreamPreviewStatus('completed');

          setPercent(75);
          setStage('正在校验修正版正文……');
          const validation = buildValidationSnapshot(ctx, response.text);
          const validationWarning = buildValidationWarningText(validation);

          setMessage('正在保存修正版草稿……');
          setCancelable(false);
          throwIfAiRequestCancelled(signal);
          const draft = await draftVersionService.create({
            novelId,
            chapterId: chapter.id,
            content: response.text,
            source: 'ai_regenerated',
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
          if (liveNovelIdRef.current === novelId && liveChapterIdRef.current === requestChapterId) {
            setValidationState(validationWithDraft);
          }

          if (task) {
            await aiTaskService.markSucceeded(task.id, {
              resultText: `按大纲修正完成。字数：${draft.wordCount}，大纲遵循度：${validation.outlineCompliance.score}分，缺失：${validation.outlineCompliance.missingPoints.length}项`,
              promptSnapshot: `chapterOutline=${ctx.chapterOutline ? 'yes' : 'no'} outlineChecklist=${ctx.outlineChecklistText ? 'yes' : 'no'} missingPoints=${missingPoints.length} requiredCharacters=${validation.requiredNames.join('、') || 'none'}`,
              tokenInput: response.tokenInput,
              tokenOutput: response.tokenOutput,
              tokenTotal: response.tokenTotal,
            });
          }

          setPercent(100);
          setStage('修正完成');
          if (liveNovelIdRef.current !== novelId || liveChapterIdRef.current !== requestChapterId)
            return;
          onGenerated?.(draft, resultMetadata);
          setLatestGeneratedDraft(draft);
          setLatestGeneratedTarget(resultMetadata);

          if (validationWarning) {
            setErrorMsg(validationWarning);
            setStatusMsg('修正版正文已生成，但仍存在校验警告。建议再次修正或重新生成。');
          } else {
            setErrorMsg('');
            setStatusMsg('修正版正文已生成，大纲遵循检查和角色出场检查通过。');
          }
        },
      );
    } catch (err: unknown) {
      await settleAiTaskError({
        taskId: activeTaskId,
        error: err,
        signal: activeSignal,
        fallbackMessage: '按大纲修正失败',
      });
      const msg = err instanceof Error ? err.message : '按大纲修正失败';
      flushStreamPreview();
      setStreamPreviewStatus(streamBufferRef.current ? 'interrupted' : 'idle');
      setErrorMsg(isAiRequestCancelled(err) ? '' : msg);
      setStatusMsg('');
    } finally {
      releaseTaskCancellation();
      setRevising(false);
      setGenerating(false);
    }
  };

  const handleAdopt = async () => {
    if (!chapter || !novelId) return;
    if (adoptingRef.current) return;
    adoptingRef.current = true;
    setAdopting(true);
    try {
      if (onBeforeDocumentChange && !(await onBeforeDocumentChange())) return;
      const requestNovelId = novelId;
      const requestChapterId = chapter.id;
      const latest = await draftVersionService.getLatestByChapterId(requestChapterId);
      if (!latest) {
        setErrorMsg('没有可采用的草稿');
        return;
      }
      if (latest.novelId !== requestNovelId || latest.chapterId !== requestChapterId) {
        setErrorMsg('草稿与当前作品章节不一致，已阻止采用');
        return;
      }
      if (draftHasAdoptionRisk(latest, validationState)) {
        const riskText =
          validationState?.draftId === latest.id
            ? validationState.note
            : latest.note || '该正文可能偏离章节大纲。';
        if (
          !(await confirmDanger({
            title: '采用确认',
            message: `该正文可能偏离章节大纲，仍要采用吗？\n\n${riskText}`,
            testId: 'apply-confirm',
          }))
        )
          return;
      } else if (
        !(await confirmInfo({
          title: '采用草稿',
          message: `确认采用草稿 v${latest.versionNo} 作为正式正文？\n\n采用后该版本将成为当前章节的正式正文。`,
          testId: 'apply-confirm',
        }))
      ) {
        return;
      }

      await draftVersionService.adopt(latest.id, requestChapterId);
      if (
        liveNovelIdRef.current !== requestNovelId ||
        liveChapterIdRef.current !== requestChapterId
      )
        return;
      setStatusMsg('已采用为正式正文！');
      showToast({
        kind: 'success',
        title: '正文已采用',
        message: `草稿 v${latest.versionNo} 已设为当前章节正式正文。`,
      });
      setTimeout(() => setStatusMsg(''), 3000);
      onAdopted?.();
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : '采用失败');
    } finally {
      adoptingRef.current = false;
      setAdopting(false);
    }
  };

  const latestGeneratedAlreadyDisplayed =
    !!latestGeneratedDraft &&
    latestGeneratedDraft.id === currentDraftId &&
    hashTextContent(currentEditorContent || '') === hashTextContent(latestGeneratedDraft.content);

  const handleAppendCandidate = () => {
    if (!latestGeneratedDraft || !latestGeneratedTarget) return;
    void onApplyAiText?.({
      ...latestGeneratedTarget,
      mode: 'append',
      text: latestGeneratedDraft.content,
      source: 'ai_generate',
    });
  };

  const handleReplaceCandidate = () => {
    if (!latestGeneratedDraft || !latestGeneratedTarget) return;
    void onApplyAiText?.({
      ...latestGeneratedTarget,
      mode: 'replace_all',
      text: latestGeneratedDraft.content,
      source: 'ai_generate',
    });
  };

  if (!chapter) {
    return (
      <div className="text-sm text-muted" style={{ padding: 16, textAlign: 'center' }}>
        请先在左侧目录树中选择一个章节
      </div>
    );
  }

  return (
    <AiGeneratePanelView
      novelId={novelId}
      chapter={chapter}
      settings={settings}
      contextCount={contextCount}
      contextLoadError={contextLoadError}
      wordCountDraft={wordCountDraft}
      wordCountSaving={wordCountSaving}
      wordCountSaved={wordCountSaved}
      genMode={genMode}
      availableStyles={availableStyles}
      selectedStyleId={selectedStyleId}
      availableOutputs={availableOutputs}
      selectedOutputId={selectedOutputId}
      userInstruction={userInstruction}
      contextSummary={contextSummary}
      promptDebug={promptDebug}
      showContext={showContext}
      generating={generating}
      revising={revising}
      streamPreview={streamPreview}
      streamPreviewStatus={streamPreviewStatus}
      statusMsg={statusMsg}
      errorMsg={errorMsg}
      validationState={validationState}
      latestGeneratedDraft={latestGeneratedDraft}
      latestGeneratedTarget={latestGeneratedTarget}
      latestGeneratedAlreadyDisplayed={latestGeneratedAlreadyDisplayed}
      candidateApplyAvailable={Boolean(onApplyAiText)}
      adopting={adopting}
      onWordCountChange={(value) => {
        setWordCountDraft(value);
        setWordCountSaved(false);
      }}
      onWordCountSave={handleSaveWordCount}
      onModeChange={setGenMode}
      onStyleChange={setSelectedStyleId}
      onOutputChange={setSelectedOutputId}
      onInstructionChange={setUserInstruction}
      onPreviewContext={handlePreviewContext}
      onGenerate={handleGenerate}
      onReviseByOutline={handleReviseByOutline}
      onKeepDraft={() => setStatusMsg('已保留当前草稿，但不建议在修正前确认采用。')}
      onAppendCandidate={handleAppendCandidate}
      onReplaceCandidate={handleReplaceCandidate}
      onAdopt={handleAdopt}
    />
  );
}

export default AiGeneratePanel;
