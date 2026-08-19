import type { AutonomousStoryPlan } from '../../types/autonomousCreation';
import { AGENT_LABELS } from './autonomousPlanningPresentation';

interface AutonomousPlanProgressProps {
  plan: AutonomousStoryPlan;
  percent: number;
}

export default function AutonomousPlanProgress({ plan, percent }: AutonomousPlanProgressProps) {
  return (
    <section className="autonomous-progress-band" aria-label="自主创作进度">
      <div className="autonomous-progress-copy">
        <strong>{plan.progress.lastCheckpoint}</strong>
        <span>
          {plan.chapters.length} / {plan.brief.targetChapterCount} 章
        </span>
      </div>
      <div className="autonomous-progress-track">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="autonomous-agent-strip">
        {plan.agentRuns.map((run) => (
          <div key={run.agent} className={`autonomous-agent-state agent-${run.status}`}>
            <span>{AGENT_LABELS[run.agent]}</span>
            <strong>
              {run.status === 'succeeded'
                ? '完成'
                : run.status === 'running'
                  ? '运行中'
                  : run.status === 'failed'
                    ? '失败'
                    : run.status === 'cancelled'
                      ? '已取消'
                      : '等待'}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}
