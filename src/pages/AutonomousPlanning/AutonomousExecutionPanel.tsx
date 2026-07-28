import { useMemo } from 'react';
import type { AutonomousChapterRun, AutonomousStoryPlan } from '../../types/autonomousCreation';
import type {
  AutonomousAutomationPolicy,
  AutonomousSchedulerSnapshot,
} from '../../types/autonomousScheduler';
import AutonomousSchedulerControls from './AutonomousSchedulerControls';

interface AutonomousExecutionPanelProps {
  plan: AutonomousStoryPlan;
  chapterRunning: boolean;
  bookRunning: boolean;
  analysisSaving: boolean;
  onGenerateCandidate: () => void;
  onGenerateBookCandidates: () => void;
  onPauseBookCandidates: () => void;
  onOpenCandidate: (chapterId: string, draftId: string) => void;
  onRetryAnalysis: (run: AutonomousChapterRun) => void;
  onStopAnalysis?: () => void;
  onConfirmAnalysis: (run: AutonomousChapterRun) => void;
  onViewWorldSuggestions: () => void;
  scheduler?: AutonomousSchedulerSnapshot;
  onStartScheduler?: (policy: AutonomousAutomationPolicy) => void;
  onPauseScheduler?: () => void;
  onResumeScheduler?: () => void;
  onStopScheduler?: () => void;
}

export function AutonomousExecutionPanel({
  plan,
  chapterRunning,
  bookRunning,
  analysisSaving,
  onGenerateCandidate,
  onGenerateBookCandidates,
  onPauseBookCandidates,
  onOpenCandidate,
  onRetryAnalysis,
  onStopAnalysis,
  onConfirmAnalysis,
  onViewWorldSuggestions,
  scheduler,
  onStartScheduler,
  onPauseScheduler,
  onResumeScheduler,
  onStopScheduler,
}: AutonomousExecutionPanelProps) {
  const { nextChapter, currentRun, pendingAnalysisRun, candidateCount } = useMemo(() => {
    const runs = plan.chapterRuns ?? [];
    const next = plan.chapters.find((chapter) => chapter.status !== 'adopted');
    const latestRuns = [...runs].reverse();
    const current = next ? latestRuns.find((run) => run.chapterId === next.id) : undefined;
    const pending = latestRuns.find(
      (run) =>
        run.analysis?.status === 'pending_confirmation' ||
        run.analysis?.status === 'running' ||
        run.analysis?.status === 'cancelled' ||
        run.analysis?.status === 'failed',
    );
    const latestRunByChapter = new Map<string, AutonomousChapterRun>();
    for (const run of runs) latestRunByChapter.set(run.chapterId, run);
    const candidates = plan.chapters.filter((chapter) => {
      if (chapter.status === 'adopted') return true;
      const run = latestRunByChapter.get(chapter.id);
      return run?.status === 'candidate_ready' || run?.status === 'adopted';
    }).length;
    return {
      nextChapter: next,
      currentRun: current,
      pendingAnalysisRun: pending,
      candidateCount: candidates,
    };
  }, [plan.chapterRuns, plan.chapters]);
  const schedulerOwnsQueue = Boolean(
    scheduler?.capability.persistent &&
    scheduler.run &&
    ['queued', 'running'].includes(scheduler.run.status),
  );

  return (
    <section className="autonomous-execution-band" aria-label="逐章自主创作">
      <header className="autonomous-execution-header">
        <div>
          <strong>逐章自主执行</strong>
          <span>生成候选 → 六专家评审 → 人工采用 → 章节收束确认</span>
        </div>
        <div className="autonomous-execution-count">
          <strong>{plan.progress.adoptedChapterNumbers.length}</strong>
          <span>/ {plan.chapters.length} 已采用</span>
        </div>
      </header>

      <div className="autonomous-execution-current">
        {nextChapter ? (
          <>
            <div className="autonomous-execution-copy">
              <span>当前章节</span>
              <strong>
                第 {nextChapter.chapterNumber} 章 · {nextChapter.title}
              </strong>
              <small>
                {nextChapter.pacingMode} · 张力 {nextChapter.tension} · {nextChapter.goal}
              </small>
            </div>
            <div className="autonomous-execution-action">
              {currentRun?.status === 'candidate_ready' ? (
                <>
                  <div className="autonomous-review-result">
                    <strong>{currentRun.reviewAccepted ? '专家共识通过' : '建议人工复核'}</strong>
                    <span>
                      接受率 {Math.round((currentRun.acceptanceRate ?? 0) * 100)}% · 均分{' '}
                      {currentRun.averageScore ?? 0}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!currentRun.candidateDraftId}
                    onClick={() =>
                      currentRun.candidateDraftId &&
                      onOpenCandidate(nextChapter.id, currentRun.candidateDraftId)
                    }
                  >
                    在工作台审阅候选
                  </button>
                </>
              ) : currentRun?.status === 'generating' ||
                currentRun?.status === 'reviewing' ||
                chapterRunning ||
                scheduler?.busy ? (
                <div className="autonomous-review-result is-running">
                  <strong>
                    {currentRun?.status === 'reviewing' ? '六专家评审中' : '候选正文生成中'}
                  </strong>
                  <span>结果只保存为草稿，不会自动采用</span>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={chapterRunning || schedulerOwnsQueue}
                  onClick={onGenerateCandidate}
                >
                  {currentRun?.status === 'failed' || currentRun?.status === 'cancelled'
                    ? '重试本章候选'
                    : '生成下一章候选'}
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="autonomous-execution-complete">
            <strong>全书章节均已采用</strong>
            <span>人物成长节点、世界候选和长期上下文已按确认状态持续沉淀。</span>
          </div>
        )}
      </div>

      {scheduler &&
        onStartScheduler &&
        onPauseScheduler &&
        onResumeScheduler &&
        onStopScheduler && (
          <AutonomousSchedulerControls
            plan={plan}
            scheduler={scheduler}
            onStart={onStartScheduler}
            onPause={onPauseScheduler}
            onResume={onResumeScheduler}
            onStop={onStopScheduler}
          />
        )}

      {(!scheduler || !scheduler.capability.persistent) && (
        <div className="autonomous-book-queue">
          <div>
            <strong>全书候选队列</strong>
            <span>按章节串行生成并逐章保存到写作工作台；候选不会自动采用。</span>
            <small>
              {candidateCount} / {plan.chapters.length} 章已有可编辑候选
            </small>
          </div>
          {bookRunning ? (
            <button type="button" className="btn btn-secondary" onClick={onPauseBookCandidates}>
              暂停全书生成
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={chapterRunning || candidateCount >= plan.chapters.length}
              onClick={onGenerateBookCandidates}
            >
              {candidateCount > 0 ? '继续生成全书候选' : '生成全书候选草稿'}
            </button>
          )}
        </div>
      )}

      {pendingAnalysisRun && (
        <div
          className={`autonomous-analysis-candidate status-${pendingAnalysisRun.analysis?.status}`}
        >
          <div>
            <span>第 {pendingAnalysisRun.chapterNumber} 章收束</span>
            {pendingAnalysisRun.analysis?.status === 'running' && (
              <strong>正在提取人物变化与世界新增事实</strong>
            )}
            {pendingAnalysisRun.analysis?.status === 'cancelled' && <strong>章节分析已停止</strong>}
            {pendingAnalysisRun.analysis?.status === 'failed' && <strong>章节分析未完成</strong>}
            {pendingAnalysisRun.analysis?.result && (
              <>
                <strong>{pendingAnalysisRun.analysis.result.summary}</strong>
                <small>
                  人物变化 {pendingAnalysisRun.analysis.result.characterChanges.length} 条 · 新地点{' '}
                  {pendingAnalysisRun.analysis.result.newLocations?.length ?? 0} 条 · 待确认世界候选{' '}
                  {pendingAnalysisRun.analysis.worldSuggestionIds.length} 条
                </small>
              </>
            )}
            {pendingAnalysisRun.analysis?.errorMessage && (
              <small className="autonomous-analysis-error">
                {pendingAnalysisRun.analysis.errorMessage}
              </small>
            )}
          </div>
          <div className="autonomous-analysis-actions">
            {pendingAnalysisRun.analysis?.status === 'running' && onStopAnalysis && (
              <button type="button" className="btn btn-secondary" onClick={onStopAnalysis}>
                停止分析
              </button>
            )}
            {(pendingAnalysisRun.analysis?.status === 'failed' ||
              pendingAnalysisRun.analysis?.status === 'cancelled') && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={analysisSaving}
                onClick={() => onRetryAnalysis(pendingAnalysisRun)}
              >
                重试分析
              </button>
            )}
            {pendingAnalysisRun.analysis?.status === 'pending_confirmation' && (
              <button
                type="button"
                className="btn btn-primary"
                disabled={analysisSaving}
                onClick={() => onConfirmAnalysis(pendingAnalysisRun)}
              >
                {analysisSaving ? '正在保存...' : '确认沉淀章节分析'}
              </button>
            )}
            {(pendingAnalysisRun.analysis?.worldSuggestionIds.length ?? 0) > 0 && (
              <button type="button" className="btn btn-secondary" onClick={onViewWorldSuggestions}>
                查看世界候选
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default AutonomousExecutionPanel;
