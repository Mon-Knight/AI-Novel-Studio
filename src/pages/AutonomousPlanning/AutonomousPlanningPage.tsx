import { appLogger } from '../../services/observability/appLogger';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { novelService } from '../../services/novels/novelService';
import { autonomousStoryService } from '../../services/autonomous-creation/autonomousRuntime';
import { autonomousChapterRuntimeLoader } from '../../services/autonomous-creation/autonomousChapterRuntimeLoader';
import {
  autonomousPostChapterService,
  cancelAutonomousPostChapterAnalysis,
  runAutonomousPostChapterAnalysis,
} from '../../services/autonomous-creation/autonomousPostChapterRuntime';
import { reconcileAutonomousAdoptions } from '../../services/autonomous-creation/autonomousAdoptionReconciler';
import { useAutonomousScheduler } from '../../services/autonomous-creation/useAutonomousScheduler';
import { chapterRepository } from '../../services/database/chapterRepository';
import { draftVersionService } from '../../services/database/draftVersionService';
import { isAiRequestCancelled } from '../../services/ai/aiCancellation';
import type {
  AutonomousChapterRun,
  AutonomousPlanningBaseline,
  AutonomousStoryBrief,
  AutonomousStoryPlan,
  AutonomousVolumeStrategy,
} from '../../types/autonomousCreation';
import type { Novel } from '../../types/novel';
import type { AutonomousAutomationPolicy } from '../../types/autonomousScheduler';
import AutonomousExecutionPanel from './AutonomousExecutionPanel';
import AutonomousBriefPanel from './AutonomousBriefPanel';
import AutonomousApplyBar from './AutonomousApplyBar';
import AutonomousPlanContent from './AutonomousPlanContent';
import AutonomousPlanProgress from './AutonomousPlanProgress';
import {
  AutonomousPlanningEmptyState,
  AutonomousPlanningHeader,
  AutonomousPlanningMissingState,
} from './AutonomousPlanningChrome';
import { defaultBrief, progressPercent, type PlanTab } from './autonomousPlanningPresentation';
import { confirmDanger, confirmInfo } from '../../utils/nativeDialog';
import { getAutonomousPlanningBaseline } from '../../services/autonomous-creation/autonomousPlanningBaselineService';
import '../../styles/autonomous-planning.css';

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

function AutonomousPlanningPage() {
  const { novelId } = useParams<{ novelId: string }>();
  const navigate = useNavigate();
  const abortRef = useRef<AbortController | null>(null);
  const chapterAbortRef = useRef<AbortController | null>(null);
  const analysisAbortRef = useRef<AbortController | null>(null);
  const [novel, setNovel] = useState<Novel | null>(null);
  const [brief, setBrief] = useState<AutonomousStoryBrief | null>(null);
  const [baseline, setBaseline] = useState<AutonomousPlanningBaseline | null>(null);
  const [volumeStrategy, setVolumeStrategy] =
    useState<AutonomousVolumeStrategy>('create_new_volume');
  const [plans, setPlans] = useState<AutonomousStoryPlan[]>([]);
  const [activePlan, setActivePlan] = useState<AutonomousStoryPlan | null>(null);
  const [tab, setTab] = useState<PlanTab>('overview');
  const [running, setRunning] = useState(false);
  const [applying, setApplying] = useState(false);
  const [chapterRunning, setChapterRunning] = useState(false);
  const [bookRunning, setBookRunning] = useState(false);
  const [analysisSaving, setAnalysisSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const scheduler = useAutonomousScheduler(activePlan?.status === 'applied' ? activePlan : null);
  const schedulerRefresh = scheduler.refresh;
  const schedulerWorkerActive = scheduler.workerActive;

  const reconcileCandidateAdoptions = useCallback(async (plan: AutonomousStoryPlan) => {
    const reconciliation = await reconcileAutonomousAdoptions(plan, {
      getAdoptedDraft: (chapterId) =>
        draftVersionService.getAdoptedByChapterId(chapterId).catch(() => null),
      markAdopted: (draft) => autonomousPostChapterService.markAdopted(draft),
    });
    if (reconciliation.draftsRequiringAnalysis.length > 0 && !analysisAbortRef.current) {
      const controller = new AbortController();
      analysisAbortRef.current = controller;
      void (async () => {
        for (const adopted of reconciliation.draftsRequiringAnalysis) {
          await runAutonomousPostChapterAnalysis(
            reconciliation.plan.planId,
            adopted,
            controller.signal,
          );
        }
      })()
        .catch((reason) => {
          if (!controller.signal.aborted && !isAiRequestCancelled(reason)) {
            appLogger.warn('[AutonomousCreation] 恢复章节分析失败', reason);
          }
        })
        .finally(() => {
          if (analysisAbortRef.current === controller) analysisAbortRef.current = null;
        });
    }
    return reconciliation.plan;
  }, []);

  const refreshPlans = useCallback(
    async (preferredPlanId?: string) => {
      if (!novelId) return;
      const history = await autonomousStoryService.listPlansByNovel(novelId, 20);
      const initial = history.find((item) => item.planId === preferredPlanId) ?? history[0] ?? null;
      const selected = initial ? await reconcileCandidateAdoptions(initial) : null;
      const reconciledHistory = selected
        ? history.map((item) => (item.planId === selected.planId ? selected : item))
        : history;
      setPlans(reconciledHistory);
      setActivePlan(selected);
    },
    [novelId, reconcileCandidateAdoptions],
  );

  useEffect(() => {
    if (!novelId) return;
    let active = true;
    setLoading(true);
    Promise.all([
      novelService.getNovelById(novelId),
      autonomousStoryService.listPlansByNovel(novelId, 20),
      getAutonomousPlanningBaseline(novelId),
    ])
      .then(async ([loadedNovel, history, loadedBaseline]) => {
        if (!active) return;
        if (!loadedNovel) throw new Error('作品不存在。');
        const selected = history[0] ? await reconcileCandidateAdoptions(history[0]) : null;
        if (!active) return;
        setNovel(loadedNovel);
        setBaseline(loadedBaseline);
        setVolumeStrategy('create_new_volume');
        const initialBrief = defaultBrief(loadedNovel);
        const lastChapter = Math.max(
          0,
          ...loadedBaseline.existingChapters.map((chapter) => chapter.chapterNumber),
        );
        if (lastChapter > 0 && initialBrief.targetChapterCount <= lastChapter) {
          initialBrief.targetChapterCount = Math.min(500, lastChapter + 12);
        }
        setBrief(initialBrief);
        setPlans(
          selected
            ? history.map((item) => (item.planId === selected.planId ? selected : item))
            : history,
        );
        setActivePlan(selected);
      })
      .catch((reason) => {
        if (active) setError(errorText(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      abortRef.current?.abort();
      chapterAbortRef.current?.abort();
      analysisAbortRef.current?.abort();
    };
  }, [novelId, reconcileCandidateAdoptions]);

  const runPlan = async (resumePlan?: AutonomousStoryPlan) => {
    if (!novelId || !brief || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError('');
    setTab('overview');
    try {
      const currentBaseline =
        resumePlan?.baseline ?? (await getAutonomousPlanningBaseline(novelId));
      if (!resumePlan) setBaseline(currentBaseline);
      const result = resumePlan
        ? await autonomousStoryService.resume(resumePlan.planId, controller.signal, setActivePlan)
        : await autonomousStoryService.generate({
            novelId,
            brief,
            planningMode:
              currentBaseline &&
              (currentBaseline.existingVolumes.length > 0 ||
                currentBaseline.existingChapters.length > 0)
                ? 'continuation'
                : 'greenfield',
            volumeStrategy,
            baseline: currentBaseline ?? undefined,
            signal: controller.signal,
            onProgress: setActivePlan,
          });
      setActivePlan(result);
      await refreshPlans(result.planId);
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorText(reason));
      await refreshPlans(resumePlan?.planId).catch(() => undefined);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
    }
  };

  const applyPlan = async () => {
    if (!activePlan || activePlan.status !== 'ready' || applying) return;
    const createdVolumeCount = activePlan.volumes.filter(
      (volume) => volume.materialization !== 'existing',
    ).length;
    const continuation = activePlan.planningMode === 'continuation';
    const confirmed = await confirmDanger({
      title: '应用全书规划',
      message: continuation
        ? `将在已有结构后新增 ${createdVolumeCount} 个分卷和 ${activePlan.chapters.length} 个章节，目标为第 ${activePlan.brief.targetChapterCount} 章；已有卷章不会被覆盖。继续吗？`
        : `将创建 ${createdVolumeCount} 个分卷和 ${activePlan.chapters.length} 个章节，并同步角色、设定与章节参数。继续吗？`,
      testId: 'autonomous-plan-apply-confirmation',
    });
    if (!confirmed) return;
    setApplying(true);
    setError('');
    try {
      const result = await autonomousStoryService.applyPlan(activePlan.planId, activePlan.revision);
      setActivePlan(result.plan);
      await refreshPlans(result.plan.planId);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setApplying(false);
    }
  };

  const generateNextChapterCandidate = async () => {
    if (
      !activePlan ||
      activePlan.status !== 'applied' ||
      chapterRunning ||
      bookRunning ||
      (scheduler.run && ['queued', 'running'].includes(scheduler.run.status))
    )
      return;
    const controller = new AbortController();
    chapterAbortRef.current = controller;
    setChapterRunning(true);
    setError('');
    try {
      const result = await autonomousChapterRuntimeLoader.generateNextCandidate(activePlan.planId, {
        signal: controller.signal,
        onProgress: setActivePlan,
      });
      setActivePlan(result.plan);
      await refreshPlans(result.plan.planId);
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorText(reason));
      await refreshPlans(activePlan.planId).catch(() => undefined);
    } finally {
      if (chapterAbortRef.current === controller) chapterAbortRef.current = null;
      setChapterRunning(false);
    }
  };

  const generateAllChapterCandidates = async () => {
    if (
      !activePlan ||
      activePlan.status !== 'applied' ||
      chapterRunning ||
      bookRunning ||
      scheduler.capability.persistent
    )
      return;
    const confirmed = await confirmDanger({
      title: '启动全书生成',
      message:
        '系统将按章节串行生成全书候选，每章完成后立即保存到写作工作台。过程可能产生较多 API 调用，候选不会自动采用。继续吗？',
      testId: 'autonomous-book-run-confirmation',
    });
    if (!confirmed) return;
    const controller = new AbortController();
    chapterAbortRef.current = controller;
    setBookRunning(true);
    setError('');
    try {
      const result = await autonomousChapterRuntimeLoader.generateAllCandidates(activePlan.planId, {
        signal: controller.signal,
        onProgress: setActivePlan,
      });
      setActivePlan(result.plan);
      await refreshPlans(result.plan.planId);
    } catch (reason) {
      if (!controller.signal.aborted) setError(errorText(reason));
      await refreshPlans(activePlan.planId).catch(() => undefined);
    } finally {
      if (chapterAbortRef.current === controller) chapterAbortRef.current = null;
      setBookRunning(false);
    }
  };

  const startScheduler = async (policy: AutonomousAutomationPolicy) => {
    if (!activePlan || activePlan.status !== 'applied') return;
    setError('');
    try {
      await scheduler.start(policy);
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  const controlScheduler = async (action: 'pause' | 'resume' | 'stop') => {
    setError('');
    try {
      if (action === 'pause') await scheduler.pause();
      else if (action === 'resume') await scheduler.resume();
      else await scheduler.stop();
      if (activePlan) await refreshPlans(activePlan.planId);
    } catch (reason) {
      setError(errorText(reason));
      await scheduler.refresh().catch(() => undefined);
    }
  };

  const loadAdoptedRunTarget = async (run: AutonomousChapterRun) => {
    const chapter = await chapterRepository.getById(run.chapterId);
    const draft = await draftVersionService.getAdoptedByChapterId(run.chapterId);
    if (!chapter || chapter.novelId !== activePlan?.novelId) {
      throw new Error('自主章节对应的正式章节不存在。');
    }
    if (!draft || draft.id !== run.adoptedDraftId) {
      throw new Error('当前采用稿与自主章节记录不一致。');
    }
    return { chapter, draft };
  };

  const retryChapterAnalysis = async (run: AutonomousChapterRun) => {
    if (!activePlan || analysisSaving || analysisAbortRef.current) return;
    const controller = new AbortController();
    analysisAbortRef.current = controller;
    setAnalysisSaving(true);
    setError('');
    try {
      const { draft } = await loadAdoptedRunTarget(run);
      const updated = await runAutonomousPostChapterAnalysis(
        activePlan.planId,
        draft,
        controller.signal,
      );
      setActivePlan(updated);
      await refreshPlans(updated.planId);
    } catch (reason) {
      if (!controller.signal.aborted && !isAiRequestCancelled(reason)) setError(errorText(reason));
    } finally {
      if (analysisAbortRef.current === controller) analysisAbortRef.current = null;
      setAnalysisSaving(false);
    }
  };

  const stopChapterAnalysis = () => {
    analysisAbortRef.current?.abort();
    if (activePlan) cancelAutonomousPostChapterAnalysis(activePlan.planId);
  };

  const confirmChapterAnalysis = async (run: AutonomousChapterRun) => {
    if (!activePlan || !run.analysis?.result || analysisSaving) return;
    const confirmed = await confirmInfo({
      title: `确认第 ${run.chapterNumber} 章上下文`,
      message: `确认将本章的总结、人物变化与长期事实写入上下文吗？\n\n${run.analysis.result.summary}`,
      testId: 'autonomous-analysis-confirmation',
    });
    if (!confirmed) return;
    setAnalysisSaving(true);
    setError('');
    try {
      const { chapter, draft } = await loadAdoptedRunTarget(run);
      const updated = await autonomousPostChapterService.confirmAnalysis({
        planId: activePlan.planId,
        chapter,
        draft,
      });
      setActivePlan(updated);
      await refreshPlans(updated.planId);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setAnalysisSaving(false);
    }
  };

  const percent = activePlan ? progressPercent(activePlan) : 0;
  const hasBackgroundWork = Boolean(
    activePlan?.chapterRuns?.some(
      (run) =>
        run.status === 'generating' ||
        run.status === 'reviewing' ||
        run.analysis?.status === 'running',
    ),
  );

  useEffect(() => {
    if (!activePlan?.planId || (!hasBackgroundWork && !schedulerWorkerActive)) return undefined;
    const timer = window.setInterval(() => {
      void Promise.all([refreshPlans(activePlan.planId), schedulerRefresh()]).catch(
        () => undefined,
      );
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [
    activePlan?.planId,
    hasBackgroundWork,
    refreshPlans,
    schedulerRefresh,
    schedulerWorkerActive,
  ]);

  if (loading)
    return <div className="autonomous-page autonomous-loading">正在读取自主创作计划...</div>;
  if (!novel || !brief) {
    return <AutonomousPlanningMissingState error={error} onBack={() => navigate('/')} />;
  }

  return (
    <div className="autonomous-page">
      <AutonomousPlanningHeader
        novelTitle={novel.title}
        status={activePlan?.status}
        onBack={() => navigate(`/novels/${novel.id}`)}
        onOpenWorkspace={() => navigate(`/novels/${novel.id}/workspace`)}
      />

      <div className="autonomous-layout">
        <AutonomousBriefPanel
          brief={brief}
          baseline={baseline}
          volumeStrategy={volumeStrategy}
          running={running}
          plans={plans}
          activePlan={activePlan}
          onBriefChange={setBrief}
          onVolumeStrategyChange={setVolumeStrategy}
          onCancel={() => abortRef.current?.abort()}
          onRun={() => void runPlan()}
          onResume={(plan) => void runPlan(plan)}
          onSelectPlan={setActivePlan}
        />

        <main className="autonomous-workspace">
          {error && (
            <div className="autonomous-error" role="alert">
              {error}
            </div>
          )}
          {!activePlan ? (
            <AutonomousPlanningEmptyState />
          ) : (
            <>
              <AutonomousPlanProgress plan={activePlan} percent={percent} />

              {activePlan.status === 'applied' && (
                <AutonomousExecutionPanel
                  plan={activePlan}
                  chapterRunning={chapterRunning}
                  bookRunning={bookRunning}
                  analysisSaving={analysisSaving}
                  onGenerateCandidate={generateNextChapterCandidate}
                  onGenerateBookCandidates={generateAllChapterCandidates}
                  onPauseBookCandidates={() => chapterAbortRef.current?.abort()}
                  onOpenCandidate={(chapterId, draftId) => {
                    const query = new URLSearchParams({ chapterId, draftId });
                    navigate(`/novels/${novel.id}/workspace?${query.toString()}`);
                  }}
                  onRetryAnalysis={retryChapterAnalysis}
                  onStopAnalysis={stopChapterAnalysis}
                  onConfirmAnalysis={confirmChapterAnalysis}
                  onViewWorldSuggestions={() => navigate(`/novels/${novel.id}/setting-suggestions`)}
                  scheduler={scheduler}
                  onStartScheduler={(policy) => {
                    void startScheduler(policy);
                  }}
                  onPauseScheduler={() => {
                    void controlScheduler('pause');
                  }}
                  onResumeScheduler={() => {
                    void controlScheduler('resume');
                  }}
                  onStopScheduler={() => {
                    void controlScheduler('stop');
                  }}
                />
              )}

              <AutonomousPlanContent plan={activePlan} tab={tab} onTabChange={setTab} />

              {activePlan.status === 'ready' && (
                <AutonomousApplyBar applying={applying} onApply={() => void applyPlan()} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default AutonomousPlanningPage;
