import { appLogger } from '../../services/observability/appLogger';
import { useState, useEffect, useCallback } from 'react';
import { confirmDanger } from '../../utils/nativeDialog';
import { volumeRepository } from '../../services/database/volumeRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import {
  createVolumeForNovel,
  createFirstVolumeAndChapter,
  createChapterInVolume,
} from '../../services/chapters/chapterCreationService';
import {
  outlineGenerateService,
  type ChapterOutlineCandidate,
  type VolumeOutlineCandidate,
} from '../../services/ai/outlineGenerateService';
import { OutlineManagerView } from './OutlineManagerView';
import type { Volume, CreateVolumeInput, UpdateVolumeInput } from '../../types/volume';
import type { Chapter, CreateChapterInput, UpdateChapterInput } from '../../types/chapter';
import { cancelLoadingOperation, runWithLoading } from '../../lib/runWithLoading';
import { masterOutlineService } from '../../services/outlines/outlineService';
import type { MasterOutline } from '../../types/outline';
import { describeUnknownError } from '../../utils/errorMessage';

const CHAPTER_OUTLINE_BATCH_SIZE = 3;

interface OutlineManagerProps {
  novelId: string;
}

function OutlineManager({ novelId }: OutlineManagerProps) {
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [showVolumeForm, setShowVolumeForm] = useState(false);
  const [editingVolume, setEditingVolume] = useState<Volume | null>(null);
  const [showChapterForm, setShowChapterForm] = useState(false);
  const [editingChapter, setEditingChapter] = useState<Chapter | null>(null);
  const [targetVolumeId, setTargetVolumeId] = useState<string | undefined>(undefined);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState('');
  const [novelOutline, setNovelOutline] = useState('');
  const [volumeCandidate, setVolumeCandidate] = useState<VolumeOutlineCandidate | null>(null);
  const [chapterCandidates, setChapterCandidates] = useState<ChapterOutlineCandidate[]>([]);
  // v1.0.35: 大纲库选择
  const [masterOutlines, setMasterOutlines] = useState<MasterOutline[]>([]);
  const [selectedMasterOutlineId, setSelectedMasterOutlineId] = useState('');

  const loadData = useCallback(async () => {
    try {
      const [v, c] = await Promise.all([
        volumeRepository.getByNovelId(novelId),
        chapterRepository.getByNovelId(novelId),
      ]);
      setVolumes(v);
      setChapters(c);
    } catch (e) {
      appLogger.error('Failed to load outline data:', e);
    } finally {
      setLoading(false);
    }
  }, [novelId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // v1.0.35: 加载已保存的总纲列表
  useEffect(() => {
    masterOutlineService
      .getVersions(novelId)
      .then(setMasterOutlines)
      .catch(() => {});
  }, [novelId]);

  const flash = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  // v1.0.20 创建分卷：写入 + 反查 + 重载
  const handleCreateVolume = async (input: CreateVolumeInput) => {
    try {
      await createVolumeForNovel(novelId, input.title, {
        summary: input.summary,
        goal: input.goal,
        mainConflict: input.mainConflict,
        orderIndex: input.orderIndex,
      });
      await loadData();
      setShowVolumeForm(false);
      flash('✅ 分卷创建成功');
    } catch (e: unknown) {
      flash('❌ 创建失败：' + describeUnknownError(e, '未知错误'));
      appLogger.error('[OutlineManager] createVolume error:', e);
    }
  };

  const handleUpdateVolume = async (id: string, input: UpdateVolumeInput) => {
    await volumeRepository.update(id, input);
    await loadData();
    setEditingVolume(null);
    flash('分卷保存成功');
  };

  const handleDeleteVolume = async (id: string) => {
    const volChapters = chapters.filter((ch) => ch.volumeId === id);
    if (volChapters.length > 0) {
      flash('该分卷下仍有章节，请先移动或删除章节');
      return;
    }
    if (!(await confirmDanger({ title: '删除分卷', message: '确定删除此分卷？' }))) return;
    await volumeRepository.remove(id);
    await loadData();
    flash('分卷已删除');
  };

  // v1.0.20 创建章节：统一服务（chapter + draft + 反查 + 重载）
  const handleCreateChapter = async (input: CreateChapterInput) => {
    try {
      const volumeId = input.volumeId || '';
      if (!volumeId) {
        // 无分卷时创建第一卷
        flash('⏳ 正在创建第一卷和第一章...');
        const result = await createFirstVolumeAndChapter(novelId, {
          chapterTitle: input.title,
          outline: input.outline,
          goal: input.goal,
          targetWordCount: input.targetWordCount,
        });
        await loadData();
        setShowChapterForm(false);
        setTargetVolumeId(undefined);
        flash('✅ 已创建第一卷和第1章（含空草稿）');
        appLogger.info(
          '[OutlineManager] createFirstVolumeAndChapter done, chapterId=',
          result.chapter.id,
        );
      } else {
        const result = await createChapterInVolume(novelId, volumeId, input.title, {
          outline: input.outline,
          goal: input.goal,
          targetWordCount: input.targetWordCount,
        });
        await loadData();
        setShowChapterForm(false);
        setTargetVolumeId(undefined);
        flash('✅ 章节创建成功（含空草稿）');
        appLogger.info(
          '[OutlineManager] createChapterInVolume done, chapterId=',
          result.chapter.id,
        );
      }
    } catch (e: unknown) {
      flash('❌ 创建失败：' + describeUnknownError(e, '未知错误'));
      appLogger.error('[OutlineManager] createChapter error:', e);
    }
  };

  const handleUpdateChapter = async (id: string, input: UpdateChapterInput) => {
    await chapterRepository.update(id, input);
    await loadData();
    setEditingChapter(null);
    flash('章节保存成功');
  };

  const handleDeleteChapter = async (id: string) => {
    if (!(await confirmDanger({ title: '删除章节', message: '确定删除此章节？' }))) return;
    await chapterRepository.remove(id);
    await loadData();
    flash('章节已删除');
  };

  const handleGenerateNovelOutline = async () => {
    setAiLoading('novel');
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
          });
          setNovelOutline(outline);
        },
      );
    } catch (e: unknown) {
      flash('AI 作品总大纲生成失败：' + describeUnknownError(e, '未知错误'));
    } finally {
      setAiLoading('');
    }
  };

  const handleSaveNovelOutline = async () => {
    if (!novelOutline.trim()) return;
    try {
      await runWithLoading(
        {
          title: '正在保存总纲',
          initialMessage: '正在写入数据库……',
          successMessage: '总纲已保存',
          errorMessage: '保存失败',
          successAutoCloseMs: 800,
        },
        async () => {
          await masterOutlineService.save({
            projectId: novelId,
            title: '作品总纲',
            content: novelOutline,
            sourceType: 'ai_generated',
            saveAsNewVersion: false,
          });
          // Reload existing outlines after save
          const versions = await masterOutlineService.getVersions(novelId);
          setMasterOutlines(versions);
          if (versions.length > 0) setSelectedMasterOutlineId(versions[0].id);
          flash('总纲已保存到大纲库');
        },
      );
    } catch (e: unknown) {
      flash('保存失败：' + describeUnknownError(e, '未知错误'));
    }
  };

  const handleSetActiveMasterOutline = async () => {
    if (!selectedMasterOutlineId) return;
    await masterOutlineService.setActive(selectedMasterOutlineId, novelId);
    const versions = await masterOutlineService.getVersions(novelId);
    setMasterOutlines(versions);
    flash('已设为当前采用总纲');
  };

  const handleGenerateVolumeOutline = async () => {
    const target = volumes.find((volume) => volume.id === targetVolumeId);
    setAiLoading('volume');
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
              volumeTitle: target?.title,
            },
            { signal, cancel: () => cancelLoadingOperation(operationId) },
          );
          setVolumeCandidate(candidate);
        },
      );
    } catch (e: unknown) {
      flash('AI 分卷大纲生成失败：' + describeUnknownError(e, '未知错误'));
    } finally {
      setAiLoading('');
    }
  };

  const handleSaveVolumeCandidate = async () => {
    if (!volumeCandidate) return;
    if (targetVolumeId) {
      await volumeRepository.update(targetVolumeId, {
        title: volumeCandidate.title,
        summary: volumeCandidate.summary,
        goal: volumeCandidate.goal,
        mainConflict: volumeCandidate.mainConflict,
      });
    } else {
      await createVolumeForNovel(novelId, volumeCandidate.title, {
        summary: volumeCandidate.summary,
        goal: volumeCandidate.goal,
        mainConflict: volumeCandidate.mainConflict,
      });
    }
    setVolumeCandidate(null);
    await loadData();
    flash('分卷大纲已保存');
  };

  const handleGenerateChapterOutlines = async () => {
    const volumeId = targetVolumeId || volumes[0]?.id;
    setAiLoading('chapters');
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
            { signal, cancel: () => cancelLoadingOperation(operationId) },
          );
          setChapterCandidates(candidates);
        },
      );
    } catch (e: unknown) {
      flash('AI 章节大纲生成失败：' + describeUnknownError(e, '未知错误'));
    } finally {
      setAiLoading('');
    }
  };

  const handleSaveChapterCandidate = async (candidate: ChapterOutlineCandidate) => {
    let volumeId = targetVolumeId || volumes[0]?.id || '';
    if (!volumeId) {
      const created = await createFirstVolumeAndChapter(novelId, {
        chapterTitle: candidate.title,
        outline: candidate.outline,
        goal: candidate.goal,
        targetWordCount: candidate.targetWordCount,
      });
      volumeId = created.chapter.volumeId || '';
    } else {
      await createChapterInVolume(novelId, volumeId, candidate.title, {
        outline: candidate.outline,
        goal: candidate.goal,
        targetWordCount: candidate.targetWordCount,
      });
    }
    setChapterCandidates((prev) => prev.filter((item) => item !== candidate));
    await loadData();
    flash('章节大纲已保存为新章节');
  };

  if (loading) {
    return (
      <div className="text-sm text-muted" style={{ padding: 16 }}>
        加载中...
      </div>
    );
  }

  return (
    <OutlineManagerView
      novelId={novelId}
      volumes={volumes}
      chapters={chapters}
      message={message}
      aiLoading={aiLoading}
      novelOutline={novelOutline}
      setNovelOutline={setNovelOutline}
      volumeCandidate={volumeCandidate}
      setVolumeCandidate={setVolumeCandidate}
      chapterCandidates={chapterCandidates}
      setChapterCandidates={setChapterCandidates}
      masterOutlines={masterOutlines}
      selectedMasterOutlineId={selectedMasterOutlineId}
      setSelectedMasterOutlineId={setSelectedMasterOutlineId}
      targetVolumeId={targetVolumeId}
      setTargetVolumeId={setTargetVolumeId}
      showVolumeForm={showVolumeForm}
      setShowVolumeForm={setShowVolumeForm}
      editingVolume={editingVolume}
      setEditingVolume={setEditingVolume}
      showChapterForm={showChapterForm}
      setShowChapterForm={setShowChapterForm}
      editingChapter={editingChapter}
      setEditingChapter={setEditingChapter}
      handleGenerateNovelOutline={handleGenerateNovelOutline}
      handleGenerateVolumeOutline={handleGenerateVolumeOutline}
      handleGenerateChapterOutlines={handleGenerateChapterOutlines}
      handleSaveNovelOutline={handleSaveNovelOutline}
      handleSetActiveMasterOutline={handleSetActiveMasterOutline}
      handleSaveVolumeCandidate={handleSaveVolumeCandidate}
      handleSaveChapterCandidate={handleSaveChapterCandidate}
      handleCreateVolume={handleCreateVolume}
      handleUpdateVolume={handleUpdateVolume}
      handleDeleteVolume={handleDeleteVolume}
      handleCreateChapter={handleCreateChapter}
      handleUpdateChapter={handleUpdateChapter}
      handleDeleteChapter={handleDeleteChapter}
    />
  );
}

export default OutlineManager;
