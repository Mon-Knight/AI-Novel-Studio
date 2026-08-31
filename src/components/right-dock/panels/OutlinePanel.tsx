import { useState, useEffect, useCallback } from 'react';
import { volumeRepository } from '../../../services/database/volumeRepository';
import { chapterRepository } from '../../../services/database/chapterRepository';
import {
  outlineGenerateService,
  type VolumeOutlineCandidate,
  type ChapterOutlineCandidate,
} from '../../../services/ai/outlineGenerateService';
import { aiSettingsService } from '../../../services/ai/aiClient';
import {
  clearCachedChapterOutlineDraft,
  setCachedChapterOutlineDraft,
} from '../../../services/prompt/chapterOutlineDraftCache';
import type { Chapter } from '../../../types/chapter';
import type { Volume } from '../../../types/volume';
import { cancelLoadingOperation, runWithLoading } from '../../../lib/runWithLoading';
import { describeUnknownError } from '../../../utils/errorMessage';
import { showInfo } from '../../../utils/nativeDialog';
import { OutlinePanelView, type OutlineGenMode } from './OutlinePanelView';

interface OutlinePanelProps {
  novelId?: string;
  chapter?: Chapter;
  onChapterOutlineApplied?: (chapterId: string) => void;
  onChapterGoalDirtyChange?: (dirty: boolean) => void;
}

function OutlinePanel({
  novelId,
  chapter,
  onChapterOutlineApplied,
  onChapterGoalDirtyChange,
}: OutlinePanelProps) {
  const [volume, setVolume] = useState<Volume | null>(null);
  const [loading, setLoading] = useState(false);
  const [genMode, setGenMode] = useState<OutlineGenMode>(null);
  const [error, setError] = useState('');
  const [applyMsg, setApplyMsg] = useState('');
  const [applyError, setApplyError] = useState('');

  // v1.0.35 当前章节大纲行内编辑
  const [isEditingChapterOutline, setIsEditingChapterOutline] = useState(false);
  const [chapterOutlineDraft, setChapterOutlineDraft] = useState('');
  const [chapterOutlineSaveMsg, setChapterOutlineSaveMsg] = useState('');
  const [chapterGoalDraft, setChapterGoalDraft] = useState('');
  const [chapterGoalDirty, setChapterGoalDirty] = useState(false);
  const [chapterGoalSaveMsg, setChapterGoalSaveMsg] = useState('');

  // 作品总大纲结果
  const [novelOutline, setNovelOutline] = useState('');
  // 分卷大纲结果
  const [volumeOutline, setVolumeOutline] = useState<VolumeOutlineCandidate | null>(null);
  // 章节大纲结果
  const [chapterOutlines, setChapterOutlines] = useState<ChapterOutlineCandidate[]>([]);

  useEffect(() => {
    if (chapter?.volumeId) {
      volumeRepository
        .getById(chapter.volumeId)
        .then(setVolume)
        .catch(() => {});
    } else {
      setVolume(null);
    }
  }, [chapter?.volumeId]);

  const updateChapterGoalDirty = useCallback(
    (dirty: boolean) => {
      setChapterGoalDirty(dirty);
      onChapterGoalDirtyChange?.(dirty);
    },
    [onChapterGoalDirtyChange],
  );

  useEffect(() => {
    setChapterGoalDraft(chapter?.goal || '');
    updateChapterGoalDirty(false);
    setChapterGoalSaveMsg('');
  }, [chapter?.id, chapter?.goal, updateChapterGoalDirty]);

  useEffect(
    () => () => {
      onChapterGoalDirtyChange?.(false);
    },
    [onChapterGoalDirtyChange],
  );

  const aiSettings = aiSettingsService.getSettings();

  // 生成作品总大纲
  const handleGenerateNovelOutline = useCallback(async () => {
    if (!novelId) return;
    setLoading(true);
    setGenMode('novel');
    setError('');
    try {
      await runWithLoading(
        {
          title: 'AI 正在生成作品总大纲',
          initialMessage: '正在读取作品设定和世界观……',
          successMessage: '作品总大纲生成完成',
          errorMessage: '作品总大纲生成失败',
          cancelable: true,
        },
        async ({ setStage, signal, operationId }) => {
          setStage('正在分析主角和世界背景……');
          const result = await outlineGenerateService.generateNovelOutline(novelId, {
            signal,
            cancel: () => cancelLoadingOperation(operationId),
          });
          setNovelOutline(result);
          setStage('生成完成');
        },
      );
    } catch (e: unknown) {
      setError(describeUnknownError(e, '作品总大纲生成失败'));
    } finally {
      setLoading(false);
      setGenMode(null);
    }
  }, [novelId]);

  // 生成本卷大纲
  const handleGenerateVolumeOutline = useCallback(async () => {
    if (!novelId || !volume) {
      setError('请先在左侧目录树中选择一个分卷下的章节');
      return;
    }
    setLoading(true);
    setGenMode('volume');
    setError('');
    try {
      await runWithLoading(
        {
          title: 'AI 正在生成分卷大纲',
          initialMessage: '正在读取当前采用总纲……',
          successMessage: '分卷大纲生成完成',
          errorMessage: '分卷大纲生成失败',
          cancelable: true,
        },
        async ({ setStage, setMessage, signal, operationId }) => {
          setStage('正在分析分卷结构……');
          const result = await outlineGenerateService.generateVolumeOutline(
            {
              novelId,
              volumeTitle: volume.title,
            },
            { signal, cancel: () => cancelLoadingOperation(operationId) },
          );
          setVolumeOutline(result);
          setMessage('正在基于总纲整理分卷逻辑……');
          setStage('生成完成');
        },
      );
    } catch (e: unknown) {
      setError(describeUnknownError(e, '分卷大纲生成失败'));
    } finally {
      setLoading(false);
      setGenMode(null);
    }
  }, [novelId, volume]);

  // 生成章节大纲
  const handleGenerateChapterOutlines = useCallback(async () => {
    if (!novelId || !chapter) {
      setError('请先在左侧目录树中选择一个章节');
      return;
    }
    setLoading(true);
    setGenMode('chapter');
    setError('');
    try {
      await runWithLoading(
        {
          title: 'AI 正在生成章节大纲',
          initialMessage: '正在读取当前采用分卷大纲和总纲……',
          successMessage: '章节大纲生成完成',
          errorMessage: '章节大纲生成失败',
          cancelable: true,
        },
        async ({ setMessage, setStage, signal, operationId }) => {
          setStage('正在推演本章剧情结构……');
          const result = await outlineGenerateService.generateChapterOutlines(
            {
              novelId,
              volumeId: chapter.volumeId,
              chapterId: chapter.id,
              chapterTitle: chapter.title,
              chapterGoal: chapterGoalDraft.trim() || chapter.goal || undefined,
              chapterCount: 3,
            },
            { signal, cancel: () => cancelLoadingOperation(operationId) },
          );
          setChapterOutlines(result);
          setMessage(`已生成 ${result.length} 个章节大纲候选（基于上级大纲）`);
          setStage('生成完成');
        },
      );
    } catch (e: unknown) {
      setError(describeUnknownError(e, '章节大纲生成失败'));
    } finally {
      setLoading(false);
      setGenMode(null);
    }
  }, [novelId, chapter, chapterGoalDraft]);

  // 采用章节大纲候选（保存到当前章节）
  const handleAdoptChapterOutline = useCallback(
    async (candidate: ChapterOutlineCandidate) => {
      if (!chapter) {
        setApplyError('请先在左侧目录树中选择一个章节');
        return;
      }
      // 使用编辑后的内容（用户可能在 textarea 中修改过）
      const editedOutline = candidate.rawText || candidate.outline;
      if (!editedOutline?.trim()) {
        setApplyError('章节大纲内容为空，无法应用');
        return;
      }
      setApplyError('');
      setApplyMsg('正在保存...');
      try {
        await chapterRepository.update(chapter.id, {
          title: candidate.title || chapter.title,
          outline: editedOutline,
          goal: candidate.goal || undefined,
          targetWordCount: candidate.targetWordCount,
        });
        // 通知父组件刷新章节状态
        onChapterOutlineApplied?.(chapter.id);
        setApplyMsg(`已应用到当前章节：${candidate.title}`);
        setTimeout(() => setApplyMsg(''), 4000);
      } catch (e: unknown) {
        setApplyError(describeUnknownError(e, '保存章节大纲失败'));
        setApplyMsg('');
      }
    },
    [chapter, onChapterOutlineApplied],
  );

  // v1.0.35 当前章节大纲行内编辑
  const handleStartEditChapterOutline = useCallback(() => {
    const draft = chapter?.outline || '';
    setChapterOutlineDraft(draft);
    if (chapter?.id) setCachedChapterOutlineDraft(chapter.id, draft);
    setIsEditingChapterOutline(true);
    setChapterOutlineSaveMsg('');
  }, [chapter?.id, chapter?.outline]);

  const handleCancelEditChapterOutline = useCallback(() => {
    if (chapter?.id) clearCachedChapterOutlineDraft(chapter.id);
    setIsEditingChapterOutline(false);
    setChapterOutlineDraft('');
    setChapterOutlineSaveMsg('');
  }, [chapter?.id]);

  const handleChapterOutlineDraftChange = useCallback(
    (value: string) => {
      setChapterOutlineDraft(value);
      if (chapter?.id) setCachedChapterOutlineDraft(chapter.id, value);
    },
    [chapter?.id],
  );

  const handleSaveChapterOutline = useCallback(async () => {
    if (!chapter) return;
    setChapterOutlineSaveMsg('正在保存...');
    try {
      await chapterRepository.update(chapter.id, {
        outline: chapterOutlineDraft,
      });
      clearCachedChapterOutlineDraft(chapter.id);
      onChapterOutlineApplied?.(chapter.id);
      setIsEditingChapterOutline(false);
      setChapterOutlineSaveMsg('已保存');
      setTimeout(() => setChapterOutlineSaveMsg(''), 3000);
    } catch (e: unknown) {
      setChapterOutlineSaveMsg('保存失败');
      setTimeout(() => setChapterOutlineSaveMsg(''), 3000);
    }
  }, [chapter, chapterOutlineDraft, onChapterOutlineApplied]);

  const handleChapterGoalChange = useCallback(
    (value: string) => {
      setChapterGoalDraft(value);
      updateChapterGoalDirty(value !== (chapter?.goal || ''));
      setChapterGoalSaveMsg('');
    },
    [chapter?.goal, updateChapterGoalDirty],
  );

  const handleSaveChapterGoal = useCallback(async () => {
    if (!chapter) return;
    setChapterGoalSaveMsg('正在保存...');
    try {
      await runWithLoading(
        {
          title: '正在保存本章目标',
          initialMessage: '正在写入当前章节目标……',
          successMessage: '本章目标已保存',
          errorMessage: '本章目标保存失败',
        },
        async ({ setStage }) => {
          setStage('正在更新章节配置……');
          await chapterRepository.update(chapter.id, {
            goal: chapterGoalDraft,
          });
        },
      );
      updateChapterGoalDirty(false);
      onChapterOutlineApplied?.(chapter.id);
      setChapterGoalSaveMsg('已保存');
      setTimeout(() => setChapterGoalSaveMsg(''), 3000);
    } catch (e: unknown) {
      setChapterGoalSaveMsg(describeUnknownError(e, '保存失败，输入已保留'));
      setTimeout(() => setChapterGoalSaveMsg(''), 4000);
    }
  }, [chapter, chapterGoalDraft, onChapterOutlineApplied, updateChapterGoalDirty]);

  const handleApplyGeneratedGoal = useCallback(
    (goal?: string) => {
      if (!goal?.trim()) return;
      setChapterGoalDraft(goal);
      updateChapterGoalDirty(goal !== (chapter?.goal || ''));
      setChapterGoalSaveMsg('已应用生成目标，保存后生效');
    },
    [chapter?.goal, updateChapterGoalDirty],
  );

  // 采用作品总大纲（显示确认）
  const handleAdoptNovelOutline = useCallback(async () => {
    if (!novelOutline) return;
    // 复制到剪贴板，用户可手动保存
    try {
      await navigator.clipboard.writeText(novelOutline);
      await showInfo({
        title: '大纲已复制',
        message: '作品总大纲已复制到剪贴板，可在作品详情页保存。',
      });
    } catch {
      await showInfo({ title: '作品总大纲', message: novelOutline.slice(0, 500) });
    }
  }, [novelOutline]);

  if (!novelId) {
    return (
      <div className="text-sm text-muted" style={{ padding: 16, textAlign: 'center' }}>
        请先选择作品
      </div>
    );
  }

  return (
    <OutlinePanelView
      aiSettings={aiSettings}
      chapter={chapter}
      volume={volume}
      loading={loading}
      genMode={genMode}
      error={error}
      applyError={applyError}
      applyMsg={applyMsg}
      novelOutline={novelOutline}
      onNovelOutlineChange={setNovelOutline}
      volumeOutline={volumeOutline}
      chapterOutlines={chapterOutlines}
      onChapterOutlinesChange={setChapterOutlines}
      isEditingChapterOutline={isEditingChapterOutline}
      chapterOutlineDraft={chapterOutlineDraft}
      chapterOutlineSaveMsg={chapterOutlineSaveMsg}
      chapterGoalDraft={chapterGoalDraft}
      chapterGoalDirty={chapterGoalDirty}
      chapterGoalSaveMsg={chapterGoalSaveMsg}
      onGenerateNovelOutline={handleGenerateNovelOutline}
      onGenerateVolumeOutline={handleGenerateVolumeOutline}
      onGenerateChapterOutlines={handleGenerateChapterOutlines}
      onAdoptNovelOutline={handleAdoptNovelOutline}
      onAdoptChapterOutline={handleAdoptChapterOutline}
      onApplyGeneratedGoal={handleApplyGeneratedGoal}
      onStartEditChapterOutline={handleStartEditChapterOutline}
      onCancelEditChapterOutline={handleCancelEditChapterOutline}
      onChapterOutlineDraftChange={handleChapterOutlineDraftChange}
      onSaveChapterOutline={handleSaveChapterOutline}
      onChapterGoalChange={handleChapterGoalChange}
      onSaveChapterGoal={handleSaveChapterGoal}
    />
  );
}

export default OutlinePanel;
