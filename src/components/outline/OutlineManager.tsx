import { appLogger } from '../../services/observability/appLogger';
import { useState, useEffect, useCallback, useRef } from 'react';
import { confirmDanger } from '../../utils/nativeDialog';
import { volumeRepository } from '../../services/database/volumeRepository';
import { novelContextAutoCompressionService } from '../../services/context/novelContextAutoCompressionService';
import { chapterRepository } from '../../services/database/chapterRepository';
import {
  createVolumeForNovel,
  createFirstVolumeAndChapter,
  createChapterInVolume,
} from '../../services/chapters/chapterCreationService';
import type {
  ChapterOutlineCandidate,
  VolumeOutlineCandidate,
} from '../../services/ai/outlineGenerateService';
import { OutlineManagerView } from './OutlineManagerView';
import { useOutlineManagerGeneration } from './useOutlineManagerGeneration';
import type { Volume, CreateVolumeInput, UpdateVolumeInput } from '../../types/volume';
import type { Chapter, CreateChapterInput, UpdateChapterInput } from '../../types/chapter';
import { runWithLoading } from '../../lib/runWithLoading';
import { masterOutlineService } from '../../services/outlines/outlineService';
import type { MasterOutline } from '../../types/outline';
import { describeUnknownError } from '../../utils/errorMessage';
import { isTauri } from '../../services/database/db';
import {
  applyNativeOutlineCandidate,
  outlineSourceFromSnapshot,
} from '../../services/outlines/outlineCandidateApplicationService';
import type { OutlineGenerationEvidence } from '../../types/outlineGeneration';
import { computeContentSha256 } from '../../utils/contentIntegrity';

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
  const activeNovel = useRef(novelId);
  activeNovel.current = novelId;
  const [masterSource, setMasterSource] = useState<OutlineGenerationEvidence | null>(null);
  const [volumeSource, setVolumeSource] = useState<OutlineGenerationEvidence | null>(null);
  const [chapterSource, setChapterSource] = useState<OutlineGenerationEvidence | null>(null);

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

  const { handleGenerateNovelOutline, handleGenerateVolumeOutline, handleGenerateChapterOutlines } =
    useOutlineManagerGeneration({
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
    });

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
      flash('分卷创建成功');
    } catch (e: unknown) {
      flash('创建失败：' + describeUnknownError(e, '未知错误'));
      appLogger.error('[OutlineManager] createVolume error:', e);
    }
  };

  const handleUpdateVolume = async (id: string, input: UpdateVolumeInput) => {
    const updated = await volumeRepository.update(id, input);
    if (input.status === 'completed' || updated?.status === 'completed') {
      void novelContextAutoCompressionService.triggerAfterConfirmation(novelId, 'volume_confirmed');
    }
    await loadData();
    setShowVolumeForm(false);
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
        flash('正在创建第一卷和第一章...');
        const result = await createFirstVolumeAndChapter(novelId, {
          chapterTitle: input.title,
          outline: input.outline,
          goal: input.goal,
          targetWordCount: input.targetWordCount,
        });
        await loadData();
        setShowChapterForm(false);
        setTargetVolumeId(undefined);
        flash('已创建第一卷和第1章（含空草稿）');
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
        flash('章节创建成功（含空草稿）');
        appLogger.info(
          '[OutlineManager] createChapterInVolume done, chapterId=',
          result.chapter.id,
        );
      }
    } catch (e: unknown) {
      flash('创建失败：' + describeUnknownError(e, '未知错误'));
      appLogger.error('[OutlineManager] createChapter error:', e);
    }
  };

  const handleUpdateChapter = async (id: string, input: UpdateChapterInput, baseline: Chapter) => {
    if (baseline.id !== id || baseline.novelId !== novelId)
      throw new Error('章节编辑范围已变化，请重新打开。');
    await chapterRepository.saveDetails(baseline, input);
    await loadData();
    setShowChapterForm(false);
    setEditingChapter(null);
    flash('章节保存成功');
  };

  const handleDeleteChapter = async (id: string) => {
    if (!(await confirmDanger({ title: '删除章节', message: '确定删除此章节？' }))) return;
    await chapterRepository.remove(id);
    await loadData();
    flash('章节已删除');
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
          if (isTauri()) {
            if (!masterSource || masterSource.novelId !== novelId)
              throw new Error('OUTLINE_SOURCE_REQUIRED: 候选来源不属于当前作品，内容已保留。');
            await applyNativeOutlineCandidate(masterSource, {
              kind: 'outline_version',
              outlineType: 'master',
              title: '作品总纲',
              content: novelOutline,
              saveAsNewVersion: false,
            });
          } else {
            await masterOutlineService.save({
              projectId: novelId,
              title: '作品总纲',
              content: novelOutline,
              sourceType: 'ai_generated',
              saveAsNewVersion: false,
            });
          }
          if (activeNovel.current !== novelId) return;
          // Reload existing outlines after the committed save; saving is not adoption.
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
    try {
      const selected = masterOutlines.find((outline) => outline.id === selectedMasterOutlineId);
      const source = isTauri() ? outlineSourceFromSnapshot(selected?.contextSnapshot) : null;
      if (source && selected) {
        if (source.novelId !== novelId) throw new Error('OUTLINE_SOURCE_SCOPE_MISMATCH');
        const current = masterOutlines.find((outline) => outline.isActive);
        await applyNativeOutlineCandidate(source, {
          kind: 'adopt_outline_version',
          outlineType: 'master',
          outlineId: selected.id,
          expectedVersion: selected.version,
          expectedContentHash: await computeContentSha256(selected.content),
          expectedActive: current
            ? {
                id: current.id,
                version: current.version,
                contentHash: await computeContentSha256(current.content),
              }
            : null,
        });
      } else {
        await masterOutlineService.setActive(selectedMasterOutlineId, novelId);
      }
      if (activeNovel.current !== novelId) return;
      const versions = await masterOutlineService.getVersions(novelId);
      setMasterOutlines(versions);
      flash('已设为当前采用总纲');
    } catch (error) {
      flash('采用失败：' + describeUnknownError(error, '未知错误'));
    }
  };

  const handleSaveVolumeCandidate = async () => {
    if (!volumeCandidate) return;
    if (isTauri()) {
      try {
        if (!volumeSource || volumeSource.novelId !== novelId)
          throw new Error('OUTLINE_SOURCE_REQUIRED: 候选来源不属于当前作品。');
        const { title, summary, goal, mainConflict } = volumeCandidate;
        await applyNativeOutlineCandidate(volumeSource, {
          kind: 'volume',
          targetVolumeId: targetVolumeId || undefined,
          candidate: { title, summary, goal, mainConflict },
        });
        if (activeNovel.current !== novelId) return;
        setVolumeCandidate(null);
        setVolumeSource(null);
        await loadData();
        flash('分卷大纲已保存，原生回执已提交');
      } catch (error) {
        flash('保存失败：' + describeUnknownError(error, '未知错误'));
      }
      return;
    }
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

  const handleSaveChapterCandidate = async (candidate: ChapterOutlineCandidate) => {
    if (isTauri()) {
      try {
        if (
          !chapterSource ||
          chapterSource.novelId !== novelId ||
          !Number.isSafeInteger(candidate.runtimeIndex)
        )
          throw new Error('OUTLINE_SOURCE_REQUIRED: 章节候选来源或批次位置不可核对，内容已保留。');
        const { title, outline, goal, targetWordCount } = candidate;
        await applyNativeOutlineCandidate(chapterSource, {
          kind: 'chapter',
          targetVolumeId: targetVolumeId || volumes[0]?.id,
          candidateIndex: candidate.runtimeIndex!,
          candidate: { title, outline, goal, targetWordCount },
        });
        if (activeNovel.current !== novelId) return;
        setChapterCandidates((previous) =>
          previous.filter((item) => item.runtimeIndex !== candidate.runtimeIndex),
        );
        await loadData();
        flash('章节大纲已保存为新章节，原生回执已提交');
      } catch (error) {
        flash('保存失败：' + describeUnknownError(error, '未知错误'));
      }
      return;
    }
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
      refreshChapter={chapterRepository.getById}
    />
  );
}

export default OutlineManager;
