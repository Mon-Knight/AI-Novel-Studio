/**
 * AI Novel Studio - 大纲与章节管理 AI 生成流程
 * 生成作品总纲、分卷大纲、章节候选；只产生可审阅候选，不保存或采用。
 */
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { cancelLoadingOperation, runWithLoading } from '../../lib/runWithLoading';
import {
  outlineGenerateService,
  type ChapterOutlineCandidate,
  type VolumeOutlineCandidate,
} from '../../services/ai/outlineGenerateService';
import type { Volume } from '../../types/volume';
import type { OutlineGenerationEvidence } from '../../types/outlineGeneration';
import { describeUnknownError } from '../../utils/errorMessage';

const CHAPTER_OUTLINE_BATCH_SIZE = 3;

interface OutlineManagerGenerationOptions {
  novelId: string;
  volumes: Volume[];
  targetVolumeId?: string;
  activeNovel: MutableRefObject<string>;
  flash: (message: string) => void;
  setAiLoading: Dispatch<SetStateAction<string>>;
  setNovelOutline: Dispatch<SetStateAction<string>>;
  setMasterSource: Dispatch<SetStateAction<OutlineGenerationEvidence | null>>;
  setVolumeSource: Dispatch<SetStateAction<OutlineGenerationEvidence | null>>;
  setChapterSource: Dispatch<SetStateAction<OutlineGenerationEvidence | null>>;
  setVolumeCandidate: Dispatch<SetStateAction<VolumeOutlineCandidate | null>>;
  setChapterCandidates: Dispatch<SetStateAction<ChapterOutlineCandidate[]>>;
}

export function useOutlineManagerGeneration({
  novelId,
  volumes,
  targetVolumeId,
  activeNovel,
  flash,
  setAiLoading,
  setNovelOutline,
  setMasterSource,
  setVolumeSource,
  setChapterSource,
  setVolumeCandidate,
  setChapterCandidates,
}: OutlineManagerGenerationOptions) {
  const handleGenerateNovelOutline = async () => {
    setAiLoading('novel');
    setMasterSource(null);
    setNovelOutline('');
    setVolumeCandidate(null);
    setChapterCandidates([]);
    try {
      await runWithLoading(
        {
          title: 'AI 正在生成作品总大纲',
          initialMessage: '正在读取作品设定……',
          successMessage: '作品总大纲已生成，请确认后保存',
          errorMessage: '作品总大纲生成失败',
          cancelable: true,
        },
        async ({ setStage, signal, operationId }) => {
          setStage('正在分析世界观和角色……');
          const outline = await outlineGenerateService.generateNovelOutline(novelId, {
            signal,
            cancel: () => cancelLoadingOperation(operationId),
            onCandidate: (source) => {
              if (activeNovel.current === novelId) setMasterSource(source);
            },
          });
          if (activeNovel.current === novelId) setNovelOutline(outline);
        },
      );
    } catch (e: unknown) {
      flash('AI 作品总大纲生成失败：' + describeUnknownError(e, '未知错误'));
    } finally {
      setAiLoading('');
    }
  };

  const handleGenerateVolumeOutline = async () => {
    const target = volumes.find((volume) => volume.id === targetVolumeId);
    setAiLoading('volume');
    setVolumeSource(null);
    setVolumeCandidate(null);
    setChapterCandidates([]);
    try {
      await runWithLoading(
        {
          title: 'AI 正在生成分卷大纲',
          initialMessage: '正在读取当前采用总纲……',
          successMessage: '分卷大纲已生成，请确认后保存',
          errorMessage: '分卷大纲生成失败',
          cancelable: true,
        },
        async ({ setStage, signal, operationId }) => {
          setStage('正在基于总纲分析分卷结构……');
          const candidate = await outlineGenerateService.generateVolumeOutline(
            {
              novelId,
              volumeId: targetVolumeId || undefined,
              volumeTitle: target?.title,
            },
            {
              signal,
              cancel: () => cancelLoadingOperation(operationId),
              onCandidate: (source) => {
                if (activeNovel.current === novelId) setVolumeSource(source);
              },
            },
          );
          if (activeNovel.current === novelId) setVolumeCandidate(candidate);
        },
      );
    } catch (e: unknown) {
      flash('AI 分卷大纲生成失败：' + describeUnknownError(e, '未知错误'));
    } finally {
      setAiLoading('');
    }
  };

  const handleGenerateChapterOutlines = async () => {
    const volumeId = targetVolumeId || volumes[0]?.id;
    setAiLoading('chapters');
    setChapterSource(null);
    setChapterCandidates([]);
    try {
      await runWithLoading(
        {
          title: 'AI 正在生成章节大纲',
          initialMessage: '正在读取当前采用分卷大纲和总纲……',
          successMessage: '章节大纲已生成，请逐条确认保存',
          errorMessage: '章节大纲生成失败',
          cancelable: true,
        },
        async ({ setStage, signal, operationId }) => {
          setStage('AI 正在基于上级大纲规划章节结构……');
          const candidates = await outlineGenerateService.generateChapterOutlines(
            {
              novelId,
              volumeId,
              chapterCount: CHAPTER_OUTLINE_BATCH_SIZE,
            },
            {
              signal,
              cancel: () => cancelLoadingOperation(operationId),
              onCandidate: (source) => {
                if (activeNovel.current === novelId) setChapterSource(source);
              },
            },
          );
          if (activeNovel.current === novelId) setChapterCandidates(candidates);
        },
      );
    } catch (e: unknown) {
      flash('AI 章节大纲生成失败：' + describeUnknownError(e, '未知错误'));
    } finally {
      setAiLoading('');
    }
  };

  return {
    handleGenerateNovelOutline,
    handleGenerateVolumeOutline,
    handleGenerateChapterOutlines,
  };
}
