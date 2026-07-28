import { useCallback, useEffect, useState } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterGenerationContext, ChapterPromptDebugInfo } from '../../../types/ai';
import type { StyleProfile } from '../../../types/style';
import type { OutputProfile } from '../../../types/output';
import { chapterRepository } from '../../../services/database/chapterRepository';
import { contextRecordService } from '../../../services/context/contextRecordService';
import { styleProfileService } from '../../../services/styles/styleProfileService';
import { outputProfileService } from '../../../services/styles/outputProfileService';
import { buildFreshChapterGenerationContext } from '../../../services/prompt/contextBuilder';
import { buildGenerateRequest } from '../../../services/prompt/promptOrchestrator';
import { describeUnknownError } from '../../../utils/errorMessage';

interface UseAiGenerateResourcesOptions {
  novelId?: string;
  chapter?: Chapter;
  contextVersion: number;
  onError: (message: string) => void;
}

export function useAiGenerateResources({
  novelId,
  chapter,
  contextVersion,
  onError,
}: UseAiGenerateResourcesOptions) {
  const [availableStyles, setAvailableStyles] = useState<StyleProfile[]>([]);
  const [availableOutputs, setAvailableOutputs] = useState<OutputProfile[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState('');
  const [selectedOutputId, setSelectedOutputId] = useState('');
  const [wordCountDraft, setWordCountDraft] = useState(0);
  const [wordCountSaving, setWordCountSaving] = useState(false);
  const [wordCountSaved, setWordCountSaved] = useState(false);
  const [contextSummary, setContextSummary] = useState<ChapterGenerationContext | null>(null);
  const [promptDebug, setPromptDebug] = useState<ChapterPromptDebugInfo | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [contextCount, setContextCount] = useState<number | null>(null);
  const [contextLoadError, setContextLoadError] = useState('');

  useEffect(() => {
    const resolved = (() => {
      if (chapter?.targetWordCount && chapter.targetWordCount > 0) return chapter.targetWordCount;
      if (selectedOutputId) {
        const output = availableOutputs.find((item) => item.id === selectedOutputId);
        const target = output?.targetWordCount || output?.chapterWordRange?.default;
        if (target && target > 0) return target;
      }
      return 4000;
    })();
    setWordCountDraft(resolved);
    setWordCountSaved(false);
  }, [chapter?.id, chapter?.targetWordCount, selectedOutputId, availableOutputs]);

  const handleSaveWordCount = useCallback(async () => {
    if (!novelId || !chapter?.id || wordCountDraft <= 0) return;
    setWordCountSaving(true);
    try {
      await chapterRepository.update(chapter.id, { targetWordCount: wordCountDraft });
      setWordCountSaved(true);
      setTimeout(() => setWordCountSaved(false), 2000);
    } catch (error) {
      onError(`保存目标字数失败：${describeUnknownError(error, '未知错误')}`);
    } finally {
      setWordCountSaving(false);
    }
  }, [chapter?.id, novelId, onError, wordCountDraft]);

  useEffect(() => {
    if (!novelId) return;
    setContextLoadError('');
    contextRecordService
      .getForGeneration({ novelId, maxCount: 15 })
      .then((records) => {
        setContextCount(records.length);
        setContextLoadError('');
      })
      .catch((error) => {
        setContextCount(null);
        setContextLoadError(describeUnknownError(error, '无法读取持久化上下文'));
      });
  }, [novelId]);

  useEffect(() => {
    if (!novelId) return;
    styleProfileService
      .getAll(novelId)
      .then((list) => {
        setAvailableStyles(list);
        if (list.length > 0 && !selectedStyleId) setSelectedStyleId(list[0].id);
      })
      .catch(() => {});
    outputProfileService
      .getAll(novelId)
      .then((list) => {
        setAvailableOutputs(list);
        const defaultOutput = list.find((item) => item.isDefault) || list[0];
        if (defaultOutput && !selectedOutputId) setSelectedOutputId(defaultOutput.id);
      })
      .catch(() => {});
  }, [novelId, selectedStyleId, selectedOutputId]);

  useEffect(() => {
    if (!novelId || !chapter?.id) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const context = await buildFreshChapterGenerationContext({
          novelId,
          volumeId: chapter.volumeId,
          chapterId: chapter.id,
          styleId: selectedStyleId || undefined,
          outputId: selectedOutputId || undefined,
          targetWordCount: wordCountDraft || undefined,
        });
        if (!cancelled) {
          setContextSummary(context);
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
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [
    novelId,
    chapter?.id,
    chapter?.volumeId,
    chapter?.targetWordCount,
    selectedStyleId,
    selectedOutputId,
    wordCountDraft,
    contextVersion,
  ]);

  const handlePreviewContext = useCallback(async () => {
    if (!novelId || !chapter) return;
    try {
      const context = await buildFreshChapterGenerationContext({
        novelId,
        volumeId: chapter.volumeId,
        chapterId: chapter.id,
        styleId: selectedStyleId || undefined,
        outputId: selectedOutputId || undefined,
        targetWordCount: wordCountDraft || undefined,
      });
      const request = await buildGenerateRequest(context);
      setContextSummary(context);
      setPromptDebug(request.promptDebug ?? null);
      setShowContext(true);
      setContextLoadError('');
    } catch (error) {
      setContextLoadError(describeUnknownError(error, '无法预览章节生成上下文'));
    }
  }, [novelId, chapter, selectedStyleId, selectedOutputId, wordCountDraft]);

  return {
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
    setShowContext,
    contextCount,
    contextLoadError,
    handlePreviewContext,
  };
}
