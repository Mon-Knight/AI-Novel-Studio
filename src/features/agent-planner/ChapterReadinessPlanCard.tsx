import type { ChapterReadinessResult } from '../../types/agentPlan';
import type { LucideIcon } from 'lucide-react';
import { Ban, CheckCircle2, Circle, CircleX, Clock3, LoaderCircle } from 'lucide-react';
import { useChapterReadinessPlan } from './useChapterReadinessPlan';

const statusLabels = {
  ready: '待运行',
  running: '运行中',
  waiting_retry: '等待继续',
  completed: '已完成',
  failed: '已失败',
  cancelled: '已取消',
} as const;

const stepStatusIcons: Record<string, LucideIcon> = {
  pending: Circle,
  running: LoaderCircle,
  waiting_retry: Clock3,
  completed: CheckCircle2,
  failed: CircleX,
  cancelled: Ban,
};

export interface ChapterReadinessPlanCardProps {
  novelId?: string;
  chapterId?: string;
}

export function ChapterReadinessPlanCard({ novelId, chapterId }: ChapterReadinessPlanCardProps) {
  const planner = useChapterReadinessPlan(novelId, chapterId);
  const result = planner.bundle?.plan.resultJson?.data as ChapterReadinessResult | undefined;
  const completedSteps =
    planner.bundle?.steps.filter((step) => step.status === 'completed').length ?? 0;
  const waitingStep = planner.bundle?.steps.find((step) => step.status === 'waiting_retry');

  return (
    <section
      className="agent-plan-card"
      data-testid="chapter-readiness-plan"
      data-plan-id={planner.bundle?.plan.planId ?? ''}
      data-plan-status={planner.bundle?.plan.status ?? 'none'}
    >
      <div className="agent-plan-card__header">
        <div>
          <div className="agent-plan-card__title">章节准备计划</div>
          <div className="agent-plan-card__subtitle">本地只读 · 不调用 AI · 不修改正文</div>
        </div>
        {planner.bundle && (
          <span className={`agent-plan-status agent-plan-status--${planner.bundle.plan.status}`}>
            {statusLabels[planner.bundle.plan.status]}
          </span>
        )}
      </div>

      {!planner.available && (
        <div className="agent-plan-card__notice">
          浏览器开发模式不创建模拟计划；请在桌面应用中运行。
        </div>
      )}

      {planner.available && planner.loading && !planner.bundle && (
        <div className="agent-plan-card__notice">正在读取持久计划…</div>
      )}

      {planner.bundle && (
        <>
          <div className="agent-plan-progress">
            <span>
              {completedSteps}/{planner.bundle.steps.length} 步
            </span>
            <div className="agent-plan-progress__track" aria-hidden="true">
              <span style={{ width: `${(completedSteps / planner.bundle.steps.length) * 100}%` }} />
            </div>
          </div>
          <ol className="agent-plan-steps">
            {planner.bundle.steps.map((step) => {
              const StepStatusIcon = stepStatusIcons[step.status] || Circle;
              return (
                <li key={step.stepId} className={`agent-plan-step agent-plan-step--${step.status}`}>
                  <StepStatusIcon aria-hidden="true" size={13} strokeWidth={1.8} />
                  <span>{step.title}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {result && (
        <div className={`agent-plan-result ${result.ready ? 'is-ready' : 'is-blocked'}`}>
          <div className="agent-plan-result__score">准备度 {result.score}</div>
          <div>{result.summary}</div>
          {result.missing.length > 0 && (
            <div className="agent-plan-result__missing">
              待补充：{result.missing.map((item) => item.label).join('、')}
            </div>
          )}
        </div>
      )}

      {waitingStep && (
        <div className="agent-plan-card__notice is-warning">
          “{waitingStep.title}”已中止，不会自动重放。请明确点击继续。
        </div>
      )}
      {planner.error && (
        <div className="agent-plan-card__error" role="alert">
          {planner.error}
        </div>
      )}

      {planner.available && (
        <div className="agent-plan-card__actions">
          {!planner.bundle && (
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => void planner.createAndRun()}
              disabled={planner.loading || planner.running || !novelId || !chapterId}
              data-testid="chapter-readiness-create"
            >
              {planner.running ? '运行中…' : '创建并检查'}
            </button>
          )}
          {(planner.bundle?.plan.status === 'ready' ||
            planner.bundle?.plan.status === 'running') && (
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => void planner.runExisting()}
              disabled={planner.running}
              data-testid="chapter-readiness-run"
            >
              {planner.running ? '运行中…' : '运行计划'}
            </button>
          )}
          {planner.bundle?.plan.status === 'waiting_retry' && (
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => void planner.retry()}
              disabled={planner.running}
              data-testid="chapter-readiness-retry"
            >
              {planner.running ? '继续中…' : '明确继续 / 重试'}
            </button>
          )}
          {planner.bundle && !planner.running && (
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => void planner.reload()}
            >
              刷新
            </button>
          )}
          {planner.bundle &&
            ['completed', 'failed', 'cancelled'].includes(planner.bundle.plan.status) && (
              <button
                className="btn btn-secondary btn-sm"
                type="button"
                onClick={() => void planner.createAndRun()}
                disabled={planner.running}
              >
                重新检查
              </button>
            )}
        </div>
      )}
    </section>
  );
}
