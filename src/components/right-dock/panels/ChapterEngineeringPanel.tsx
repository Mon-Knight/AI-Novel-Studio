import { useEffect, useMemo, useRef, useState } from 'react';
import {
  chapterEngineeringService,
  createDefaultChapterCard,
  createDefaultGenerationConstraints,
  createDefaultQualityRules,
  createDefaultScenePlan,
} from '../../../services/engineering/chapterEngineeringService';
import { generationContextCompiler } from '../../../services/generation/generationContextCompiler';
import { generationJobService } from '../../../services/generation/generationJobService';
import { qualityCheckService } from '../../../services/quality/qualityCheckService';
import type { Chapter } from '../../../types/chapter';
import type { ChapterDraft } from '../../../types/ai';
import type {
  ChapterEngineeringBundle,
  ChapterEngineeringState,
} from '../../../types/chapterEngineering';
import type { ChapterGenerationSnapshot } from '../../../types/generationContext';
import type { GenerationJob, GenerationStepResult } from '../../../types/generationJob';
import type { GetQualityCheckIssuesResult } from '../../../types/qualityCheck';
import { hashTextContent } from '../../../utils/contentHash';
import type { DraftResultMetadata } from '../../../types/workspaceSafety';
import {
  EMPTY_QUALITY_RESULT,
  isActiveGenerationJob,
  isTerminalGenerationJob,
  latestStepByName,
  type TabId,
} from './chapterEngineeringPanelSupport';
import { ChapterEngineeringPanelView } from './ChapterEngineeringPanelView';
import { useChapterEngineeringEditorState } from './useChapterEngineeringEditorState';
import { buildEngineeringLoopItems } from './chapterEngineeringLoop';

interface ChapterEngineeringPanelProps {
  novelId?: string;
  chapter?: Chapter;
  currentEditorContent?: string;
  currentContentHash?: string;
  currentDraftId?: string;
  currentDraftVersion?: number;
  onGenerated?: (draft: ChapterDraft, metadata?: DraftResultMetadata) => void;
}

function ChapterEngineeringPanel({
  novelId,
  chapter,
  currentEditorContent,
  currentContentHash,
  currentDraftId,
  currentDraftVersion,
  onGenerated,
}: ChapterEngineeringPanelProps) {
  const liveChapterIdRef = useRef(chapter?.id || '');
  liveChapterIdRef.current = chapter?.id || '';
  const effectiveNovelId = novelId ?? chapter?.novelId;
  const liveNovelIdRef = useRef(effectiveNovelId || '');
  liveNovelIdRef.current = effectiveNovelId || '';
  const jobRunEpochRef = useRef(0);
  const draftRunEpochRef = useRef(0);
  const [activeTab, setActiveTab] = useState<TabId>('card');
  const [bundle, setBundle] = useState<ChapterEngineeringBundle | null>(null);
  const [latestSnapshot, setLatestSnapshot] = useState<ChapterGenerationSnapshot | null>(null);
  const [latestJob, setLatestJob] = useState<GenerationJob | null>(null);
  const [jobSteps, setJobSteps] = useState<GenerationStepResult[]>([]);
  const [qualityResult, setQualityResult] =
    useState<GetQualityCheckIssuesResult>(EMPTY_QUALITY_RESULT);
  const {
    card,
    setCard,
    scenePlan,
    setScenePlan,
    constraints,
    setConstraints,
    qualityRules,
    setQualityRules,
    dirty,
    setDirty,
    updateCard,
    updateConstraints,
    updateWordRange,
    updateQuality,
    updateScene,
    addScene,
    removeScene,
  } = useChapterEngineeringEditorState();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [jobRunning, setJobRunning] = useState(false);
  const [draftRunning, setDraftRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const chapterId = chapter?.id;
  const chapterTitle = chapter?.title;
  const chapterGoal = chapter?.goal;
  const chapterOutline = chapter?.outline;
  const chapterTargetWordCount = chapter?.targetWordCount;
  const chapterTargetWords = chapter?.targetWords;

  const applyJobUpdate = (incoming: GenerationJob) => {
    setLatestJob((current) => {
      if (current?.id === incoming.id && isTerminalGenerationJob(current)) return current;
      return incoming;
    });
  };

  useEffect(() => {
    let alive = true;
    jobRunEpochRef.current += 1;
    draftRunEpochRef.current += 1;
    setJobRunning(false);
    setDraftRunning(false);
    setMessage('');
    setError('');

    if (!chapterId) {
      setBundle(null);
      setLatestSnapshot(null);
      setLatestJob(null);
      setJobSteps([]);
      setQualityResult(EMPTY_QUALITY_RESULT);
      setCard(createDefaultChapterCard());
      setScenePlan(createDefaultScenePlan());
      setConstraints(createDefaultGenerationConstraints());
      setQualityRules(createDefaultQualityRules());
      setDirty(false);
      return () => {
        alive = false;
      };
    }

    setLoading(true);
    const chapterSeed = {
      title: chapterTitle,
      goal: chapterGoal,
      outline: chapterOutline,
      targetWordCount: chapterTargetWordCount,
      targetWords: chapterTargetWords,
    };
    Promise.all([
      chapterEngineeringService.getBundle(chapterId, chapterSeed),
      generationContextCompiler.getLatestByChapterId(chapterId),
      generationJobService.getByChapterId(chapterId),
      qualityCheckService.getChapterIssues(chapterId).catch(() => EMPTY_QUALITY_RESULT),
    ])
      .then(async ([nextBundle, snapshot, jobs, quality]) => {
        if (!alive) return;
        const source = nextBundle.latestDraft ?? nextBundle.activeState;
        setBundle(nextBundle);
        setLatestSnapshot(snapshot);
        setQualityResult(quality);
        const latest = jobs.find((job) => isActiveGenerationJob(job)) ?? jobs[0] ?? null;
        setLatestJob(latest);
        if (latest) {
          const steps = await generationJobService.getSteps(latest.id);
          if (alive) setJobSteps(steps);
        } else {
          setJobSteps([]);
        }
        setCard(source?.chapterCard ?? createDefaultChapterCard(chapterSeed));
        setScenePlan(
          source?.scenePlan.length ? source.scenePlan : createDefaultScenePlan(chapterSeed),
        );
        setConstraints(
          source?.generationConstraints ?? createDefaultGenerationConstraints(chapterSeed),
        );
        setQualityRules(source?.qualityRules ?? createDefaultQualityRules());
        setDirty(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : '章节工程状态读取失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [
    chapterGoal,
    chapterId,
    chapterOutline,
    chapterTargetWordCount,
    chapterTargetWords,
    chapterTitle,
    setCard,
    setConstraints,
    setDirty,
    setQualityRules,
    setScenePlan,
  ]);

  const statusText = useMemo(() => {
    const active = bundle?.activeState ? `active v${bundle.activeState.draftVersion}` : '未应用';
    const draft = bundle?.latestDraft ? `草稿 v${bundle.latestDraft.draftVersion}` : '无草稿';
    return `${active} / ${draft}${bundle?.hasUnappliedDraft ? ' / 有未应用草稿' : ''}`;
  }, [bundle]);

  const patchGenerationStep = useMemo(
    () => latestStepByName(jobSteps, 'patch_generation'),
    [jobSteps],
  );
  const patchApplyStep = useMemo(() => latestStepByName(jobSteps, 'patch_apply'), [jobSteps]);
  const hasActiveJob = isActiveGenerationJob(latestJob);
  const visibleQualityItems = useMemo(
    () => qualityResult.items.filter((item) => item.status === 'pending').slice(0, 6),
    [qualityResult.items],
  );
  const loopItems = useMemo(
    () =>
      buildEngineeringLoopItems({
        bundle,
        latestJob,
        latestSnapshot,
        patchApplyStep,
        qualityResult,
      }),
    [bundle, latestJob, latestSnapshot, patchApplyStep, qualityResult],
  );

  const persistDraft = async (): Promise<ChapterEngineeringState | null> => {
    if (!chapter?.id || !effectiveNovelId) {
      setError('请先选择章节');
      return null;
    }
    const saved = await chapterEngineeringService.saveDraft(
      {
        novelId: effectiveNovelId,
        volumeId: chapter.volumeId,
        chapterId: chapter.id,
        chapterCard: card,
        scenePlan,
        generationConstraints: constraints,
        qualityRules,
      },
      chapter,
    );
    const nextBundle = await chapterEngineeringService.getBundle(chapter.id, chapter);
    setBundle(nextBundle);
    setDirty(false);
    return saved;
  };

  const handleSaveDraft = async () => {
    setBusy(true);
    setError('');
    setMessage('正在保存草稿...');
    try {
      const saved = await persistDraft();
      if (saved) setMessage(`已保存草稿 v${saved.draftVersion}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '章节工程草稿保存失败');
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAndApply = async () => {
    if (!chapter?.id) return;
    setBusy(true);
    setError('');
    setMessage('正在保存并应用...');
    try {
      const target = dirty
        ? await persistDraft()
        : (bundle?.latestDraft ?? bundle?.activeState ?? (await persistDraft()));
      if (!target) return;
      const active = await chapterEngineeringService.activate(target.id, chapter.id, chapter);
      const nextBundle = await chapterEngineeringService.getBundle(chapter.id, chapter);
      setBundle(nextBundle);
      setDirty(false);
      setMessage(`已应用 active v${active.draftVersion}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '章节工程状态应用失败');
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  const handleCompileSnapshot = async () => {
    if (!chapter?.id || !effectiveNovelId) {
      setError('请先选择章节');
      return;
    }
    if (dirty) {
      setError('请先保存并应用当前工程修改，再编译上下文快照。');
      return;
    }
    setCompiling(true);
    setError('');
    setMessage('正在编译上下文快照...');
    try {
      const snapshot = await generationContextCompiler.compileAndSave({
        novelId: effectiveNovelId,
        volumeId: chapter.volumeId,
        chapterId: chapter.id,
        currentEditorContent,
      });
      setLatestSnapshot(snapshot);
      setMessage(`已编译上下文快照 ${snapshot.contextHash}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '上下文快照编译失败');
      setMessage('');
    } finally {
      setCompiling(false);
    }
  };

  const handleRunMockJob = async () => {
    if (!chapter?.id || !effectiveNovelId) {
      setError('请先选择章节');
      return;
    }
    if (dirty) {
      setError('请先保存并应用当前工程修改，再启动 Mock 任务。');
      return;
    }
    if (hasActiveJob) {
      setError('当前章节已有生成任务正在运行。');
      return;
    }
    setJobRunning(true);
    setError('');
    setMessage('正在运行 Mock 生成任务...');
    const requestNovelId = effectiveNovelId;
    const requestChapterId = chapter.id;
    const requestEpoch = ++jobRunEpochRef.current;
    try {
      const finalJob = await generationJobService.runMockChapterJob(
        {
          novelId: requestNovelId,
          volumeId: chapter.volumeId,
          chapterId: chapter.id,
          currentEditorContent,
        },
        (job, steps) => {
          if (
            jobRunEpochRef.current === requestEpoch &&
            liveNovelIdRef.current === requestNovelId &&
            liveChapterIdRef.current === requestChapterId
          ) {
            applyJobUpdate(job);
            setJobSteps(steps);
          }
        },
      );
      const steps = await generationJobService.getSteps(finalJob.id);
      if (
        jobRunEpochRef.current !== requestEpoch ||
        liveNovelIdRef.current !== requestNovelId ||
        liveChapterIdRef.current !== requestChapterId
      )
        return;
      applyJobUpdate(finalJob);
      setJobSteps(steps);
      setMessage(`Mock 任务已${finalJob.status === 'completed' ? '完成' : finalJob.status}`);
    } catch (e: unknown) {
      if (
        jobRunEpochRef.current === requestEpoch &&
        liveNovelIdRef.current === requestNovelId &&
        liveChapterIdRef.current === requestChapterId
      ) {
        setError(e instanceof Error ? e.message : 'Mock 生成任务失败');
        setMessage('');
      }
    } finally {
      if (
        jobRunEpochRef.current === requestEpoch &&
        liveNovelIdRef.current === requestNovelId &&
        liveChapterIdRef.current === requestChapterId
      ) {
        setJobRunning(false);
      }
    }
  };

  const handleRunDraftJob = async () => {
    if (!chapter?.id || !effectiveNovelId) {
      setError('请先选择章节');
      return;
    }
    if (dirty) {
      setError('请先保存并应用当前工程修改，再生成本章初稿。');
      return;
    }
    if (hasActiveJob) {
      setError('当前章节已有生成任务正在运行。');
      return;
    }
    setDraftRunning(true);
    setError('');
    setMessage('正在生成本章初稿...');
    const requestNovelId = effectiveNovelId;
    const requestChapterId = chapter.id;
    const requestEpoch = ++draftRunEpochRef.current;
    const resultBase: Omit<DraftResultMetadata, 'resultId'> = {
      novelId: requestNovelId,
      chapterId: requestChapterId,
      sourceDraftId: currentDraftId,
      sourceRevision: currentDraftVersion,
      baseContentHash: currentContentHash || hashTextContent(currentEditorContent || ''),
      source: 'chapter_engineering',
    };
    try {
      const result = await generationJobService.runChapterDraftJob(
        {
          novelId: requestNovelId,
          volumeId: chapter.volumeId,
          chapterId: chapter.id,
          title: `${chapter.title || '章节'} - AI 初稿`,
          currentEditorContent,
        },
        (job, steps) => {
          if (
            draftRunEpochRef.current === requestEpoch &&
            liveNovelIdRef.current === requestNovelId &&
            liveChapterIdRef.current === requestChapterId
          ) {
            applyJobUpdate(job);
            setJobSteps(steps);
          }
        },
      );
      const [steps, quality] = await Promise.all([
        generationJobService.getSteps(result.job.id),
        qualityCheckService.getChapterIssues(requestChapterId).catch(() => EMPTY_QUALITY_RESULT),
      ]);
      if (
        draftRunEpochRef.current !== requestEpoch ||
        liveNovelIdRef.current !== requestNovelId ||
        liveChapterIdRef.current !== requestChapterId
      )
        return;
      applyJobUpdate(result.job);
      setJobSteps(steps);
      setQualityResult(quality);
      if (result.draft) {
        onGenerated?.(result.draft, { ...resultBase, resultId: result.draft.id });
        setMessage(`已生成并保存正文草稿 v${result.draft.versionNo}`);
      } else {
        setMessage(`正文生成任务已${result.job.status}`);
      }
    } catch (e: unknown) {
      if (
        draftRunEpochRef.current === requestEpoch &&
        liveNovelIdRef.current === requestNovelId &&
        liveChapterIdRef.current === requestChapterId
      ) {
        setError(e instanceof Error ? e.message : '正文生成任务失败');
        setMessage('');
      }
    } finally {
      if (
        draftRunEpochRef.current === requestEpoch &&
        liveNovelIdRef.current === requestNovelId &&
        liveChapterIdRef.current === requestChapterId
      ) {
        setDraftRunning(false);
      }
    }
  };

  const handleCancelJob = async () => {
    if (
      !latestJob ||
      latestJob.status === 'completed' ||
      latestJob.status === 'failed' ||
      latestJob.status === 'cancelled'
    )
      return;
    setError('');
    try {
      const cancelled = await generationJobService.cancel(latestJob.id);
      if (cancelled) {
        applyJobUpdate(cancelled);
        setJobSteps(await generationJobService.getSteps(cancelled.id));
        setMessage('任务已取消');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '任务取消失败');
    }
  };

  const toggleQualityCheck = (id: string) => {
    const exists = qualityRules.enabledChecks.includes(id);
    updateQuality(
      'enabledChecks',
      exists
        ? qualityRules.enabledChecks.filter((item) => item !== id)
        : [...qualityRules.enabledChecks, id],
    );
  };

  if (!chapter) {
    return <div className="engineering-empty">请先在左侧目录树中选择一个章节。</div>;
  }

  return (
    <ChapterEngineeringPanelView
      activeTab={activeTab}
      setActiveTab={setActiveTab}
      statusText={statusText}
      dirty={dirty}
      loopItems={loopItems}
      message={message}
      error={error}
      card={card}
      scenePlan={scenePlan}
      constraints={constraints}
      qualityRules={qualityRules}
      qualityResult={qualityResult}
      visibleQualityItems={visibleQualityItems}
      bundle={bundle}
      latestSnapshot={latestSnapshot}
      latestJob={latestJob}
      jobSteps={jobSteps}
      patchGenerationStep={patchGenerationStep}
      patchApplyStep={patchApplyStep}
      hasActiveJob={hasActiveJob}
      busy={busy}
      loading={loading}
      compiling={compiling}
      jobRunning={jobRunning}
      draftRunning={draftRunning}
      updateCard={updateCard}
      updateConstraints={updateConstraints}
      updateWordRange={updateWordRange}
      updateQuality={updateQuality}
      updateScene={updateScene}
      addScene={addScene}
      removeScene={removeScene}
      toggleQualityCheck={toggleQualityCheck}
      handleCompileSnapshot={handleCompileSnapshot}
      handleRunDraftJob={handleRunDraftJob}
      handleRunMockJob={handleRunMockJob}
      handleCancelJob={handleCancelJob}
      handleSaveDraft={handleSaveDraft}
      handleSaveAndApply={handleSaveAndApply}
    />
  );
}

export default ChapterEngineeringPanel;
