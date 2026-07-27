import { useState, useEffect, useCallback, useRef } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterDraft, ChapterGenerationContext, ChapterPromptDebugInfo, OutlineComplianceResult, OutlineKeyPoint } from '../../../types/ai';
import type { StyleProfile } from '../../../types/style';
import type { OutputProfile } from '../../../types/output';
import { ChapterStatusLabels } from '../../../types/chapter';
import { createAiClient, aiSettingsService } from '../../../services/ai/aiClient';
import { buildFreshChapterGenerationContext } from '../../../services/prompt/contextBuilder';
import { buildGenerateRequest } from '../../../services/prompt/promptOrchestrator';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { notifyNative } from '../../../utils/nativeNotification';
import { showToast } from '../../../utils/toast';
import { confirmInfo, confirmDanger } from '../../../utils/nativeDialog';
import { chapterRepository } from '../../../services/database/chapterRepository';
import { aiTaskService } from '../../../services/ai/aiTaskService';
import { contextRecordService } from '../../../services/context/contextRecordService';
import { styleProfileService } from '../../../services/styles/styleProfileService';
import { outputProfileService } from '../../../services/styles/outputProfileService';
import { runWithLoading } from '../../../lib/runWithLoading';
import { checkOutlineCompliance } from '../../../services/ai/outlineComplianceChecker';
import { reviseChapterByOutline } from '../../../services/ai/chapterRevisionService';
import { hashTextContent } from '../../../utils/contentHash';
import { describeUnknownError } from '../../../utils/errorMessage';
import type { AiTextApplyPayload, DraftResultMetadata } from '../../../types/workspaceSafety';
import { ChapterReadinessPlanCard } from '../../../features/agent-planner/ChapterReadinessPlanCard';
import { ChapterContinuityMemoryCard } from '../../../features/memory/ChapterContinuityMemoryCard';

function namesText(names: string[]): string {
  return names.length > 0 ? names.join('、') : '无';
}

function getChapterCharacterNames(ctx: ChapterGenerationContext | null | undefined): string[] {
  return ctx?.chapterCharacterList?.map((item) => item.name).filter(Boolean) ?? [];
}

function getRequiredCharacterNames(ctx: ChapterGenerationContext | null | undefined): string[] {
  return ctx?.requiredCharacters?.map((item) => item.name).filter(Boolean) ?? [];
}

type ValidationStatus = '通过' | '警告' | '未通过';

interface GenerationValidationState {
  draftId: string;
  outlineCompliance: OutlineComplianceResult;
  requiredNames: string[];
  missingRequiredNames: string[];
  note: string;
}

function getOutlineValidationStatus(score: number): ValidationStatus {
  if (score < 60) return '未通过';
  if (score < 80) return '警告';
  return '通过';
}

function buildValidationNote(input: {
  outlineCompliance: OutlineComplianceResult;
  requiredNames: string[];
  missingRequiredNames: string[];
}): string {
  const outlineStatus = getOutlineValidationStatus(input.outlineCompliance.score);
  const roleStatus = input.missingRequiredNames.length > 0 ? '缺失' : '通过';
  const missingPoints = input.outlineCompliance.missingPoints.map((point) => point.text).join('；') || '无';
  return [
    `大纲遵循检查：${outlineStatus}`,
    `大纲遵循度：${input.outlineCompliance.score}分`,
    `已覆盖：${input.outlineCompliance.coveredPoints.length}项`,
    `缺失：${input.outlineCompliance.missingPoints.length}项`,
    `缺失大纲关键点：${missingPoints}`,
    `角色出场检查：${roleStatus}`,
    `缺失必须出场角色：${input.missingRequiredNames.join('、') || '无'}`,
  ].join('\n');
}

function buildValidationSnapshot(ctx: ChapterGenerationContext, generatedText: string) {
  const outlineCompliance = checkOutlineCompliance(generatedText, ctx.outlineKeyPoints || []);
  const requiredNames = [...new Set(getRequiredCharacterNames(ctx))];
  const missingRequiredNames = requiredNames.filter((name) => !generatedText.includes(name));
  const note = buildValidationNote({ outlineCompliance, requiredNames, missingRequiredNames });
  return {
    outlineCompliance,
    requiredNames,
    missingRequiredNames,
    note,
  };
}

function buildValidationWarningText(validation: Omit<GenerationValidationState, 'draftId'>): string | undefined {
  const messages: string[] = [];
  const outlineStatus = getOutlineValidationStatus(validation.outlineCompliance.score);
  if (outlineStatus === '未通过') {
    messages.push(`⚠️ 生成正文未充分遵循章节大纲（${validation.outlineCompliance.score} 分）。建议重新生成或按大纲修正后再确认采用。`);
  } else if (outlineStatus === '警告') {
    messages.push(`⚠️ 生成正文只部分遵循章节大纲（${validation.outlineCompliance.score} 分）。建议检查缺失关键点。`);
  }
  if (validation.missingRequiredNames.length > 0) {
    messages.push(`⚠️ 生成正文缺少必须出场角色：${validation.missingRequiredNames.join('、')}。`);
  }
  return messages.join('\n') || undefined;
}

function draftHasAdoptionRisk(draft: ChapterDraft, validationState: GenerationValidationState | null): boolean {
  if (validationState?.draftId === draft.id) {
    return validationState.outlineCompliance.score < 80 || validationState.missingRequiredNames.length > 0;
  }
  const note = draft.note || '';
  return note.includes('大纲遵循检查：未通过')
    || note.includes('大纲遵循检查：警告')
    || note.includes('角色出场检查：缺失');
}

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

function AiGeneratePanel({ novelId, chapter, onGenerated, onAdopted, contextVersion = 0, currentDraftId, currentDraftVersion, currentEditorContent, currentContentHash, onApplyAiText, onBeforeDocumentChange }: AiGeneratePanelProps) {
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
  const [latestGeneratedTarget, setLatestGeneratedTarget] = useState<DraftResultMetadata | null>(null);

  // v1.0.26 风格方案与输出控制选择
  const [availableStyles, setAvailableStyles] = useState<StyleProfile[]>([]);
  const [availableOutputs, setAvailableOutputs] = useState<OutputProfile[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState('');
  const [selectedOutputId, setSelectedOutputId] = useState('');

  // v1.0.42 目标字数可编辑（必须在 availableOutputs/selectedOutputId 声明之后）
  const [wordCountDraft, setWordCountDraft] = useState<number>(0);
  const [wordCountSaving, setWordCountSaving] = useState(false);
  const [wordCountSaved, setWordCountSaved] = useState(false);

  useEffect(() => {
    setValidationState(null);
    setLatestGeneratedDraft(null);
    setLatestGeneratedTarget(null);
  }, [chapter?.id]);

  // 初始化/更新目标字数草稿
  useEffect(() => {
    const resolved = (() => {
      if (chapter?.targetWordCount && chapter.targetWordCount > 0) return chapter.targetWordCount;
      if (selectedOutputId) {
        const output = availableOutputs.find((o) => o.id === selectedOutputId);
        const ot = output?.targetWordCount || output?.chapterWordRange?.default;
        if (ot && ot > 0) return ot;
      }
      return 4000;
    })();
    setWordCountDraft(resolved);
    setWordCountSaved(false);
  }, [chapter?.id, chapter?.targetWordCount, selectedOutputId, availableOutputs]);

  // 保存目标字数
  const handleSaveWordCount = async () => {
    if (!novelId || !chapter?.id || wordCountDraft <= 0) return;
    setWordCountSaving(true);
    try {
      await chapterRepository.update(chapter.id, { targetWordCount: wordCountDraft });
      setWordCountSaved(true);
      setTimeout(() => setWordCountSaved(false), 2000);
    } catch (e: any) {
      setErrorMsg(`保存目标字数失败：${e.message || '未知错误'}`);
    } finally {
      setWordCountSaving(false);
    }
  };

  // v1.0.25 上下文摘要状态
  const [contextSummary, setContextSummary] = useState<ChapterGenerationContext | null>(null);
  const [promptDebug, setPromptDebug] = useState<ChapterPromptDebugInfo | null>(null);
  const [showContext, setShowContext] = useState(false);

  // v0.8.0 上下文加载状态
  const [contextCount, setContextCount] = useState<number | null>(null);
  const [contextLoadError, setContextLoadError] = useState('');

  useEffect(() => {
    if (novelId) {
      setContextLoadError('');
      contextRecordService.getForGeneration({ novelId, maxCount: 15 })
        .then((records) => {
          setContextCount(records.length);
          setContextLoadError('');
        })
        .catch((error) => {
          setContextCount(null);
          setContextLoadError(describeUnknownError(error, '无法读取持久化上下文'));
        });
    }
  }, [novelId]);

  // v1.0.26 加载可用风格方案和输出控制
  useEffect(() => {
    if (novelId) {
      styleProfileService.getAll(novelId).then((list) => {
        setAvailableStyles(list);
        if (list.length > 0 && !selectedStyleId) setSelectedStyleId(list[0].id);
      }).catch(() => {});
      outputProfileService.getAll(novelId).then((list) => {
        setAvailableOutputs(list);
        const def = list.find((o) => o.isDefault) || list[0];
        if (def && !selectedOutputId) setSelectedOutputId(def.id);
      }).catch(() => {});
    }
  }, [novelId, selectedStyleId, selectedOutputId]);

  // v1.0.42 上下文摘要自动刷新（角色变更/字数变更/章节切换时）
  useEffect(() => {
    if (!novelId || !chapter?.id) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const ctx = await buildFreshChapterGenerationContext({
          novelId,
          volumeId: chapter.volumeId,
          chapterId: chapter.id,
          styleId: selectedStyleId || undefined,
          outputId: selectedOutputId || undefined,
          targetWordCount: wordCountDraft || undefined,
        });
        if (!cancelled) {
          setContextSummary(ctx);
          setPromptDebug(null);
          setContextLoadError('');
        }
      } catch (error) {
        if (!cancelled) {
          setContextSummary(null);
          setContextLoadError(describeUnknownError(error, '无法构建章节生成上下文'));
        }
      }
    };
    refresh();
    return () => { cancelled = true; };
  }, [novelId, chapter?.id, chapter?.volumeId, chapter?.targetWordCount, selectedStyleId, selectedOutputId, wordCountDraft, contextVersion]);

  const settings = aiSettingsService.getSettings();

  // v1.0.25 手动查看上下文摘要
  const handlePreviewContext = useCallback(async () => {
    if (!novelId || !chapter) return;
    try {
      const ctx = await buildFreshChapterGenerationContext({
        novelId,
        volumeId: chapter.volumeId,
        chapterId: chapter.id,
        styleId: selectedStyleId || undefined,
        outputId: selectedOutputId || undefined,
        targetWordCount: wordCountDraft || undefined,
      });
      const request = await buildGenerateRequest(ctx);
      setContextSummary(ctx);
      setPromptDebug(request.promptDebug ?? null);
      setShowContext(true);
      setContextLoadError('');
    } catch (error) {
      setContextLoadError(describeUnknownError(error, '无法预览章节生成上下文'));
    }
  }, [novelId, chapter, selectedStyleId, selectedOutputId, wordCountDraft]);

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
      const mergedInstruction = [
        userInstruction.trim(),
        retryInstruction,
      ].filter(Boolean).join('\n\n') || undefined;
      preflightContext = await buildFreshChapterGenerationContext({
        novelId,
        volumeId: chapter.volumeId,
        chapterId: chapter.id,
        userInstruction: mergedInstruction,
        styleId: selectedStyleId || undefined,
        outputId: selectedOutputId || undefined,
        targetWordCount: wordCountDraft || undefined,
        draftContent: genMode === 'rewrite' ? (currentEditorContent?.trim() || undefined) : undefined,
      });
      setContextSummary(preflightContext);
      setPromptDebug(null);
    } catch (e: any) {
      setErrorMsg(e?.message || '生成前读取最新上下文失败');
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

    try {
      await runWithLoading(
        {
          title: genMode === 'rewrite' ? 'AI 正在重新生成正文' : 'AI 正在生成正文',
          initialMessage: '正在构建上下文……',
          successMessage: '正文已生成，校验结果已显示',
          errorMessage: 'AI 生成失败',
          cancelable: false,
        },
        async ({ setMessage, setStage, setPercent }) => {
          // 点击生成前已经强制构建 fresh context；这里沿用同一份上下文进入最终 prompt。
          const ctx: ChapterGenerationContext = preflightContext;

          const hasOutline = ctx?.chapterOutline ? '有' : '无';
          const hasChapterGoal = ctx?.chapterGoal ? '有' : '无';
          const charCount = ctx?.chapterCharacterList?.length || 0;
          const eventCount = ctx?.chapterEvents ? (ctx.chapterEvents.match(/\n- /g)?.length || 1) : 0;
          const hasPrevContext = ctx?.previousContext ? '有' : '无';
          const styleName = availableStyles.find((s) => s.id === selectedStyleId)?.name || '默认';
          const outputName = availableOutputs.find((o) => o.id === selectedOutputId)?.name || '默认';

          const inputSummary = [
            `生成：${novelId.slice(0,8)}/${ctx.chapterTitle}`,
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
          const task = await aiTaskService.create('chapter_generate', {
            novelId,
            chapterId: chapter.id,
            runtimeMode: settings.runtimeMode,
            provider: settings.provider,
            modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
            inputSummary,
          }).catch(() => null);

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
          const response = await client.generate(request);

          setPercent(80);
          setStage('正在校验生成结果……');
          const validation = buildValidationSnapshot(ctx, response.text);
          const validationWarning = buildValidationWarningText(validation);
          setMessage('正在保存生成结果……');

          // 4. 保存为草稿
          const draft = await draftVersionService.create({
            novelId,
            chapterId: chapter.id,
            content: response.text,
            source: genMode === 'rewrite' ? 'ai_regenerated' : 'ai_generated',
            aiTaskId: task?.id,
            note: validation.note,
          });
          const validationWithDraft: GenerationValidationState = { draftId: draft.id, ...validation };
          const resultMetadata: DraftResultMetadata = {
            ...requestTarget,
            resultId: draft.id,
            source: 'ai_generate',
          };
          if (liveNovelIdRef.current === requestTarget.novelId && liveChapterIdRef.current === requestTarget.chapterId) {
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
          console.info('[AiGenerate] 生成完成:', {
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
            missingOutlinePoints: validation.outlineCompliance.missingPoints.map((point) => point.text),
            missingRequiredCharacters: validation.missingRequiredNames,
            model: settings.modelName,
            provider: settings.provider,
            promptTemplateSource: request.promptTemplateSource,
            promptLength: request.promptDebug?.promptLength || request.messages[0]?.content?.length || 0,
          });

          if (liveNovelIdRef.current !== requestTarget.novelId || liveChapterIdRef.current !== requestTarget.chapterId) {
            notifyNative({ kind: 'success', body: `原章节正文已生成并保存（${draft.wordCount} 字）` });
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
      setErrorMsg(msg);
      setStatusMsg('');
      setGenerating(false);

      // Native Feel P2.2: 生成失败通知
      notifyNative({ kind: 'error', body: `正文生成失败：${msg}` });

      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        // 错误已由 runWithLoading 显示弹窗，这里只做本地状态清理
      }
    }
  };

  const handleReviseByOutline = async () => {
    if (!novelId || !chapter) return;
    if (generating || revising) return;
    const requestChapterId = chapter.id;
    setRevising(true);
    setGenerating(true);
    setErrorMsg('');

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

      const baseCompliance = validationState?.draftId === latest.id
        ? validationState.outlineCompliance
        : checkOutlineCompliance(latest.content, ctx.outlineKeyPoints || []);
      const missingPoints = baseCompliance.missingPoints.length > 0
        ? baseCompliance.missingPoints
        : (ctx.outlineKeyPoints || []);

      if ((ctx.outlineKeyPoints?.length || 0) === 0) {
        setErrorMsg('未能从章节大纲中提取关键剧情点，暂时无法按大纲修正。请先补充章节大纲。');
        return;
      }

      await runWithLoading(
        {
          title: 'AI 正在按大纲修正正文',
          initialMessage: '正在读取最新章节大纲和草稿……',
          successMessage: '修正版正文已生成，校验结果已显示',
          errorMessage: '按大纲修正失败',
          cancelable: false,
        },
        async ({ setMessage, setStage, setPercent }) => {
          const task = await aiTaskService.create('chapter_rewrite', {
            novelId,
            chapterId: chapter.id,
            runtimeMode: settings.runtimeMode,
            provider: settings.provider,
            modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
            inputSummary: `按大纲修正：${ctx.chapterTitle}，缺失${missingPoints.length}项，原草稿v${latest.versionNo}`,
          }).catch(() => null);

          setStage('正在组装修正提示词……');
          setPercent(25);
          const client = createAiClient(settings);
          const response = await reviseChapterByOutline({
            originalDraft: latest.content,
            chapterTitle: ctx.chapterTitle,
            chapterOutline: ctx.chapterOutline,
            outlineChecklistText: ctx.outlineChecklistText,
            missingPoints,
            requiredCharacters: ctx.requiredCharacters,
            targetWordCount: ctx.targetWordCount || wordCountDraft,
          }, client);

          setPercent(75);
          setStage('正在校验修正版正文……');
          const validation = buildValidationSnapshot(ctx, response.text);
          const validationWarning = buildValidationWarningText(validation);

          setMessage('正在保存修正版草稿……');
          const draft = await draftVersionService.create({
            novelId,
            chapterId: chapter.id,
            content: response.text,
            source: 'ai_regenerated',
            aiTaskId: task?.id,
            note: validation.note,
          });
          const validationWithDraft: GenerationValidationState = { draftId: draft.id, ...validation };
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
          if (liveNovelIdRef.current !== novelId || liveChapterIdRef.current !== requestChapterId) return;
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
      const msg = err instanceof Error ? err.message : '按大纲修正失败';
      setErrorMsg(msg);
      setStatusMsg('');
    } finally {
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
        const riskText = validationState?.draftId === latest.id
          ? validationState.note
          : latest.note || '该正文可能偏离章节大纲。';
        if (!(await confirmDanger({ title: '采用确认', message: `该正文可能偏离章节大纲，仍要采用吗？\n\n${riskText}`, testId: 'apply-confirm' }))) return;
      } else if (!(await confirmInfo({ title: '采用草稿', message: `确认采用草稿 v${latest.versionNo} 作为正式正文？\n\n采用后该版本将成为当前章节的正式正文。`, testId: 'apply-confirm' }))) {
        return;
      }

      await draftVersionService.adopt(latest.id, requestChapterId);
      if (liveNovelIdRef.current !== requestNovelId || liveChapterIdRef.current !== requestChapterId) return;
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

  const latestGeneratedAlreadyDisplayed = !!latestGeneratedDraft
    && latestGeneratedDraft.id === currentDraftId
    && hashTextContent(currentEditorContent || '') === hashTextContent(latestGeneratedDraft.content);

  if (!chapter) {
    return (
      <div className="text-sm text-muted" style={{ padding: 16, textAlign: 'center' }}>
        请先在左侧目录树中选择一个章节
      </div>
    );
  }

  return (
    <div>
      <ChapterReadinessPlanCard novelId={novelId} chapterId={chapter.id} />
      <ChapterContinuityMemoryCard novelId={novelId} chapterId={chapter.id} />

      {/* AI 设置状态 */}
      <div className="panel-section">
        <div className="panel-section-title">AI 状态</div>
        <div style={{ fontSize: 12, lineHeight: 1.8 }}>
          <div>模式：{settings.runtimeMode === 'mock' ? '🔶 Mock 模式' : '🔷 真实 API'}</div>
          {settings.runtimeMode === 'api' && (
            <div>模型：{settings.modelName || '未配置'}</div>
          )}
          {settings.runtimeMode === 'api' && !settings.apiKey && (
            <div style={{ color: 'var(--color-error)', marginTop: 4 }}>
              ⚠️ 未配置 API Key，请先到设置中心配置
            </div>
          )}
        </div>
      </div>

      {/* v0.8.0 上下文加载状态 */}
      <div className="panel-section">
        <div className="panel-section-title">📦 上下文加载状态</div>
        <div style={{ fontSize: 12, lineHeight: 1.8 }}>
          <div
            data-testid="generation-context-count"
            data-context-count={contextCount === null ? 'error' : String(contextCount)}
          >
            已加载上下文：<strong>{contextCount === null ? '读取失败' : contextCount}</strong>{contextCount === null ? '' : ' 条'}
          </div>
          {contextLoadError && (
            <div role="alert" data-testid="error-notice" style={{ color: 'var(--color-error)', marginTop: 2 }}>
              {contextLoadError}
            </div>
          )}
          {contextCount === 0 && (
            <div style={{ color: 'var(--color-text-muted)', marginTop: 2 }}>
              暂无前文上下文记录，可先在已采用章节中生成总结
            </div>
          )}
          {contextCount !== null && contextCount > 0 && (
            <div style={{ color: 'var(--color-success)', marginTop: 2 }}>
              ✅ 下一章生成时将自动加载以上下文摘要
            </div>
          )}
        </div>
      </div>

      {/* 当前章节 */}
      <div className="panel-section">
        <div className="panel-section-title">当前章节</div>
        <div className="panel-field">
          <div className="panel-field-label">章节</div>
          <div className="panel-field-value">第{chapter.chapterNumber}章：{chapter.title}</div>
        </div>
        <div className="panel-field" style={{ marginTop: 8 }}>
          <div className="panel-field-label">目标字数</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              value={wordCountDraft || ''}
              onChange={(e) => { setWordCountDraft(Number(e.target.value)); setWordCountSaved(false); }}
              onBlur={() => { if (wordCountDraft <= 0) setWordCountDraft(4000); }}
              min={500}
              max={50000}
              step={100}
              disabled={wordCountSaving}
              style={{
                width: 80,
                padding: '4px 8px',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                fontSize: 13,
                textAlign: 'center',
              }}
            />
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>字</span>
            <button
              className="btn btn-sm"
              onClick={handleSaveWordCount}
              disabled={wordCountSaving || wordCountDraft <= 0}
              style={{
                padding: '3px 10px',
                fontSize: 12,
                background: wordCountSaved ? 'var(--color-success)' : 'var(--color-primary)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                whiteSpace: 'nowrap',
              }}
            >
              {wordCountSaving ? '⏳' : wordCountSaved ? '✓ 已保存' : '保存'}
            </button>
          </div>
        </div>
        <div className="panel-field" style={{ marginTop: 8 }}>
          <div className="panel-field-label">状态</div>
          <div className="panel-field-value">{ChapterStatusLabels[chapter.status]}</div>
        </div>
      </div>

      {/* 生成模式 */}
      <div className="panel-section">
        <div className="panel-section-title">生成模式</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`panel-btn ${genMode === 'new' ? 'panel-btn-primary' : 'panel-btn-secondary'}`}
            onClick={() => setGenMode('new')}
            style={{ flex: 1 }}
          >
            生成新稿
          </button>
          <button
            className={`panel-btn ${genMode === 'rewrite' ? 'panel-btn-primary' : 'panel-btn-secondary'}`}
            onClick={() => setGenMode('rewrite')}
            style={{ flex: 1 }}
          >
            重新生成
          </button>
        </div>
      </div>

      {/* v1.0.26 风格方案与输出控制选择 */}
      <div className="panel-section">
        <div className="panel-section-title">🎨 风格与输出配置</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
          选择本章生成时的写作风格和输出控制方案
        </div>
        <div className="panel-field" style={{ marginBottom: 8 }}>
          <div className="panel-field-label">风格方案</div>
          <select
            className="panel-select"
            value={selectedStyleId}
            onChange={(e) => setSelectedStyleId(e.target.value)}
            style={{ fontSize: 12 }}
          >
            {availableStyles.length === 0 && (
              <option value="">无可用方案</option>
            )}
            {availableStyles.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="panel-field">
          <div className="panel-field-label">输出控制</div>
          <select
            className="panel-select"
            value={selectedOutputId}
            onChange={(e) => setSelectedOutputId(e.target.value)}
            style={{ fontSize: 12 }}
          >
            {availableOutputs.length === 0 && (
              <option value="">无可用方案</option>
            )}
            {availableOutputs.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        {selectedStyleId && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6, lineHeight: 1.5 }}>
            {(() => {
              const s = availableStyles.find((x) => x.id === selectedStyleId);
              if (!s) return null;
              return [
                s.narrativePerspective && `👁️ ${s.narrativePerspective}`,
                s.tone && `🎭 ${s.tone}`,
                s.pace && `⚡ ${s.pace}`,
                `💬${Math.round(s.dialogueRatio * 100)}% 🖊️${Math.round(s.descriptionRatio * 100)}%`
              ].filter(Boolean).join(' · ');
            })()}
          </div>
        )}
      </div>

      {/* 额外要求 */}
      <div className="panel-section">
        <div className="panel-section-title">本次生成额外要求</div>
        <textarea
          className="form-textarea"
          value={userInstruction}
          onChange={(e) => setUserInstruction(e.target.value)}
          placeholder="例如：本章开头要压抑一些，结尾留下悬念..."
          style={{ width: '100%', height: 70, resize: 'vertical', fontSize: 13 }}
        />
      </div>

      {/* v1.0.25 上下文摘要预览 */}
      <div className="panel-section">
        <div className="panel-section-title">📋 本次将使用的上下文</div>
        {/* v1.0.42 内联摘要：始终显示出场角色和字数 */}
        {contextSummary && (
          <div style={{ fontSize: 11, lineHeight: 1.6, color: 'var(--color-text-secondary)', marginBottom: 6, padding: '6px 8px', background: 'var(--color-bg-primary)', borderRadius: 4 }}>
            <span>📊 目标字数：{contextSummary.targetWordCount || wordCountDraft} 字</span>
            <span style={{ marginLeft: 12 }}>📝 章节大纲：{contextSummary.chapterOutline ? '有' : '无'}</span>
            <span style={{ marginLeft: 12 }}>✅ 大纲关键点：{contextSummary.outlineKeyPoints?.length || 0} 项</span>
            <span style={{ marginLeft: 12 }}>👥 出场角色：{(() => {
              const nameList = getChapterCharacterNames(contextSummary);
              return nameList.length > 0 ? `${nameList.length} 个（${nameList.join('、')}）` : '0 个';
            })()}</span>
            <span style={{ marginLeft: 12 }}>⚠️ 必须出场：{(() => {
              const nameList = getRequiredCharacterNames(contextSummary);
              return nameList.length > 0 ? `${nameList.length} 个（${nameList.join('、')}）` : '0 个';
            })()}</span>
          </div>
        )}
        <button
          className="btn btn-secondary btn-sm"
          onClick={handlePreviewContext}
          disabled={generating}
          style={{ width: '100%', marginBottom: 6 }}
        >
          🔍 查看上下文摘要
        </button>
        {contextSummary && !contextSummary.chapterOutline?.trim() && (
          <div style={{ fontSize: 11, color: 'var(--color-warning)', marginTop: 4 }}>
            ⚠️ 当前章节大纲为空，建议先生成或填写章节大纲
          </div>
        )}
        {contextSummary && contextSummary.chapterOutline?.trim() && contextSummary.chapterOutline.trim().length < 30 && (
          <div style={{ fontSize: 11, color: 'var(--color-warning)', marginTop: 4 }}>
            ⚠️ 当前章节大纲过短，生成正文可能不遵循规划
          </div>
        )}
        {contextSummary && (contextSummary.outlineKeyPoints?.length || 0) === 0 && (
          <div style={{ fontSize: 11, color: 'var(--color-warning)', marginTop: 4 }}>
            ⚠️ 未能从章节大纲中提取关键剧情点，建议补充更明确的大纲
          </div>
        )}
        {showContext && contextSummary && (
          <div style={{ fontSize: 11, lineHeight: 1.7, color: 'var(--color-text-secondary)', marginTop: 8, padding: 8, background: 'var(--color-bg-primary)', borderRadius: 4 }}>
            <div>📖 总大纲：{(contextSummary.masterOutline || contextSummary.novelOutline) ? `✅ 有（${(contextSummary.masterOutline || contextSummary.novelOutline)!.length} 字）` : '❌ 无'}</div>
            <div>📋 分卷大纲：{contextSummary.volumeOutline ? `✅ 有（${contextSummary.volumeOutline.length} 字）` : '❌ 无'}</div>
            <div>📝 章节大纲：{contextSummary.chapterOutline ? `✅ 有（${contextSummary.chapterOutline.length} 字）` : '❌ 无'}</div>
            <div>🧭 大纲来源：{contextSummary.chapterOutlineSource || 'empty'}</div>
            <div>✅ 大纲执行清单：{contextSummary.outlineKeyPoints?.length || 0} 项</div>
            <div>🎯 本章目标：{contextSummary.chapterGoal ? `✅ 有（${contextSummary.chapterGoal.length} 字）` : '❌ 无'}</div>
            <div>👥 出场角色：{(() => {
              const nameList = getChapterCharacterNames(contextSummary);
              return nameList.length > 0 ? `${nameList.length} 个（${nameList.join('、')}）` : '0 个';
            })()}</div>
            <div>⚠️ 必须出场角色：{(() => {
              const nameList = getRequiredCharacterNames(contextSummary);
              return nameList.length > 0 ? `${nameList.length} 个（${nameList.join('、')}）` : '0 个';
            })()}</div>
            <div>⚡ 本章事件：{contextSummary.chapterEvents ? (contextSummary.chapterEvents.match(/\n- /g)?.length || 1) : 0} 个</div>
            <div>🌍 世界设定：{contextSummary.worldBackground ? '✅ 有' : '❌ 无'}</div>
            <div>📦 前文总结：{contextSummary.previousContext ? '✅ 有' : '❌ 无'}</div>
            <div>🎨 风格方案：{contextSummary.styleProfile ? '✅ 有' : '❌ 无（使用默认）'} {availableStyles.find((s) => s.id === selectedStyleId)?.name ? `→ ${availableStyles.find((s) => s.id === selectedStyleId)!.name}` : ''}</div>
            <div>⚙️ 输出控制：{availableOutputs.find((o) => o.id === selectedOutputId)?.name || '默认'}</div>
            <div>📊 目标字数：{contextSummary.targetWordCount || wordCountDraft} 字</div>
            {promptDebug && (
              <>
                <div>🧪 最终 prompt 模板：{promptDebug.templateSource}</div>
                <div>🧪 包含角色块：{promptDebug.hasRequiredCharactersBlock ? '是' : '否'}（{promptDebug.requiredCharactersCount} 个）</div>
                <div>🧪 包含章节大纲：{promptDebug.includesChapterOutlineText ? '是' : '否'}</div>
                <div>🧪 包含大纲执行清单：{promptDebug.includesOutlineChecklistText ? '是' : '否'}（{promptDebug.outlineKeyPointCount} 项）</div>
                <div>🧪 包含分卷大纲：{promptDebug.includesVolumeOutlineText ? '是' : '否'}</div>
                <div>🧪 包含总纲：{promptDebug.includesMasterOutlineText ? '是' : '否'}</div>
                <div>🧪 prompt 长度：{promptDebug.promptLength} 字符</div>
              </>
            )}
          </div>
        )}
        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
          点击「查看上下文摘要」可预览 AI 将收到的全部配置信息
        </div>
      </div>

      {/* 状态消息 */}
      {statusMsg && (
        <div style={{
          fontSize: 13, padding: '8px 12px', borderRadius: 6, marginBottom: 12,
          background: statusMsg.includes('成功') ? '#e8f5e9' : 'var(--color-primary-light)',
          color: statusMsg.includes('成功') ? '#2e7d32' : 'var(--color-primary)',
        }} data-testid="success-notice">
          {statusMsg}
        </div>
      )}
      {errorMsg && (
        <div style={{
          fontSize: 13, padding: '8px 12px', borderRadius: 6, marginBottom: 12,
          background: '#ffebee', color: '#c62828',
        }} data-testid="error-notice">
          {errorMsg}
        </div>
      )}

      {validationState && (
        <div
          className="panel-section"
          data-testid="candidate-constraints"
          data-draft-id={validationState.draftId}
          data-outline-score={validationState.outlineCompliance.score}
          data-missing-outline-count={validationState.outlineCompliance.missingPoints.length}
          data-missing-required-count={validationState.missingRequiredNames.length}
          style={{
          border: `1px solid ${validationState.outlineCompliance.score < 60 || validationState.missingRequiredNames.length > 0 ? 'var(--color-error)' : validationState.outlineCompliance.score < 80 ? 'var(--color-warning)' : 'var(--color-border)'}`,
          borderRadius: 6,
          padding: 10,
          }}
        >
          <div className="panel-section-title">生成后校验</div>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            <div>
              大纲遵循检查：{getOutlineValidationStatus(validationState.outlineCompliance.score)}
              <strong style={{ marginLeft: 6 }}>{validationState.outlineCompliance.score} 分</strong>
            </div>
            <div>
              已覆盖：{validationState.outlineCompliance.coveredPoints.length} 项，
              缺失：{validationState.outlineCompliance.missingPoints.length} 项
            </div>
            <div>
              角色出场检查：{validationState.missingRequiredNames.length > 0 ? `缺失（${validationState.missingRequiredNames.join('、')}）` : '通过'}
            </div>
          </div>
          {validationState.outlineCompliance.missingPoints.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>缺失的大纲关键点</div>
              <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
                {validationState.outlineCompliance.missingPoints.map((point) => (
                  <li key={point.id}>{point.text}</li>
                ))}
              </ol>
            </div>
          )}
          {(validationState.outlineCompliance.score < 80 || validationState.missingRequiredNames.length > 0) && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--color-warning)', marginBottom: 8 }}>
                ⚠️ 正文已生成，但大纲遵循度较低。建议重新生成或按大纲修正后再确认采用。
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleGenerate({
                    retryMissingPoints: validationState.outlineCompliance.missingPoints.length > 0
                      ? validationState.outlineCompliance.missingPoints
                      : contextSummary?.outlineKeyPoints || [],
                  })}
                  disabled={generating || revising}
                >
                  重新生成
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleReviseByOutline}
                  disabled={generating || revising}
                >
                  按大纲修正
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setStatusMsg('已保留当前草稿，但不建议在修正前确认采用。')}
                  disabled={generating || revising}
                >
                  保留草稿
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {latestGeneratedDraft && (
        <div
          className="panel-section"
          data-testid="candidate-review"
          data-draft-id={latestGeneratedDraft.id}
          data-result-id={latestGeneratedTarget?.resultId ?? ''}
          data-novel-id={latestGeneratedTarget?.novelId ?? latestGeneratedDraft.novelId}
          data-chapter-id={latestGeneratedTarget?.chapterId ?? latestGeneratedDraft.chapterId}
          data-source-draft-id={latestGeneratedTarget?.sourceDraftId ?? ''}
          data-source-revision={latestGeneratedTarget?.sourceRevision ?? ''}
          data-base-content-hash={latestGeneratedTarget?.baseContentHash ?? ''}
          data-result-source={latestGeneratedTarget?.source ?? ''}
          data-ai-task-id={latestGeneratedDraft.aiTaskId ?? ''}
          data-version-no={latestGeneratedDraft.versionNo}
        >
          <div className="panel-section-title">应用最近生成结果</div>
          <pre data-testid="candidate-content" style={{ maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'var(--font-family-editor)', fontSize: 12, lineHeight: 1.6, background: 'var(--color-bg-primary)', border: '1px solid var(--color-border-light)', borderRadius: 4, padding: 8 }}>
            {latestGeneratedDraft.content}
          </pre>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => onApplyAiText?.({
                ...(latestGeneratedTarget as DraftResultMetadata),
                mode: 'append',
                text: latestGeneratedDraft.content,
                source: 'ai_generate',
              })}
              disabled={!onApplyAiText || !latestGeneratedTarget || latestGeneratedAlreadyDisplayed}
              style={{ flex: 1 }}
              title={latestGeneratedAlreadyDisplayed ? '当前编辑器已显示该草稿，避免重复追加' : '追加到当前正文末尾'}
            >
              追加到正文
            </button>
            <button
              className="btn btn-sm btn-primary"
              onClick={() => onApplyAiText?.({
                ...(latestGeneratedTarget as DraftResultMetadata),
                mode: 'replace_all',
                text: latestGeneratedDraft.content,
                source: 'ai_generate',
              })}
              disabled={!onApplyAiText || !latestGeneratedTarget || latestGeneratedAlreadyDisplayed}
              style={{ flex: 1 }}
              title={latestGeneratedAlreadyDisplayed ? '当前编辑器已显示该草稿' : '替换当前全文'}
              data-testid="candidate-replace"
            >
              替换全文
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 6 }}>
            当前生成结果已保存为草稿 v{latestGeneratedDraft.versionNo}。
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="panel-section">
        <button
          className="panel-btn panel-btn-primary"
          onClick={() => handleGenerate()}
          disabled={generating || revising}
          data-testid="ai-generate-submit"
        >
          {generating ? (revising ? '⏳ 正在修正...' : '⏳ 正在生成...') : `🤖 ${genMode === 'rewrite' ? '重新生成' : '生成本章'}`}
        </button>
        <button
          className="panel-btn panel-btn-secondary"
          onClick={handleAdopt}
          disabled={generating || revising || adopting}
          data-testid="candidate-apply"
          data-result-id={latestGeneratedTarget?.resultId ?? ''}
          data-novel-id={latestGeneratedTarget?.novelId ?? novelId ?? ''}
          data-chapter-id={latestGeneratedTarget?.chapterId ?? chapter.id}
          data-apply-mode="adopt"
        >
          {adopting ? '⏳ 采用中...' : '✅ 确认采用'}
        </button>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', textAlign: 'center', marginTop: 6 }}>
          AI 生成结果将保存为草稿版本，需手动确认采用
        </div>
      </div>
    </div>
  );
}

export default AiGeneratePanel;
