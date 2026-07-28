import type { AutonomousStoryBrief, AutonomousStoryPlan } from '../../types/autonomousCreation';
import { STATUS_LABELS } from './autonomousPlanningPresentation';

interface AutonomousBriefPanelProps {
  brief: AutonomousStoryBrief;
  running: boolean;
  plans: AutonomousStoryPlan[];
  activePlan: AutonomousStoryPlan | null;
  onBriefChange(brief: AutonomousStoryBrief): void;
  onCancel(): void;
  onRun(): void;
  onResume(plan: AutonomousStoryPlan): void;
  onSelectPlan(plan: AutonomousStoryPlan | null): void;
}

export default function AutonomousBriefPanel({
  brief,
  running,
  plans,
  activePlan,
  onBriefChange,
  onCancel,
  onRun,
  onResume,
  onSelectPlan,
}: AutonomousBriefPanelProps) {
  return (
    <aside className="autonomous-brief-panel" aria-label="小说创意输入">
      <div className="autonomous-panel-heading">
        <strong>小说 Brief</strong>
        <span>方向由你确认，结构由 Agent 展开</span>
      </div>

      <label className="autonomous-field">
        <span>核心创意</span>
        <textarea
          value={brief.premise}
          onChange={(event) => onBriefChange({ ...brief, premise: event.target.value })}
          rows={5}
          disabled={running}
        />
      </label>
      <label className="autonomous-field">
        <span>题材</span>
        <input
          value={brief.genre}
          onChange={(event) => onBriefChange({ ...brief, genre: event.target.value })}
          disabled={running}
        />
      </label>
      <div className="autonomous-number-grid">
        <label className="autonomous-field">
          <span>总章节</span>
          <input
            type="number"
            min={12}
            max={500}
            value={brief.targetChapterCount}
            onChange={(event) =>
              onBriefChange({ ...brief, targetChapterCount: Number(event.target.value) })
            }
            disabled={running}
          />
        </label>
        <label className="autonomous-field">
          <span>每章字数</span>
          <input
            type="number"
            min={500}
            max={10000}
            step={100}
            value={brief.targetWordsPerChapter}
            onChange={(event) =>
              onBriefChange({ ...brief, targetWordsPerChapter: Number(event.target.value) })
            }
            disabled={running}
          />
        </label>
      </div>
      <label className="autonomous-field">
        <span>读者承诺</span>
        <textarea
          value={brief.readerPromise}
          onChange={(event) => onBriefChange({ ...brief, readerPromise: event.target.value })}
          rows={3}
          disabled={running}
        />
      </label>
      <label className="autonomous-field">
        <span>结局方向</span>
        <textarea
          value={brief.endingPreference}
          onChange={(event) => onBriefChange({ ...brief, endingPreference: event.target.value })}
          rows={3}
          disabled={running}
        />
      </label>
      <label className="autonomous-field">
        <span>创作边界，每行一条</span>
        <textarea
          value={brief.constraints.join('\n')}
          onChange={(event) =>
            onBriefChange({
              ...brief,
              constraints: event.target.value
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean),
            })
          }
          rows={4}
          disabled={running}
        />
      </label>

      <div className="autonomous-primary-actions">
        {running ? (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            取消生成
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            disabled={brief.premise.trim().length < 20 || brief.targetChapterCount < 12}
            onClick={onRun}
          >
            {activePlan ? '生成新计划' : '开始自主规划'}
          </button>
        )}
        {!running &&
          activePlan &&
          ['running', 'failed', 'cancelled'].includes(activePlan.status) && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => onResume(activePlan)}
            >
              继续此计划
            </button>
          )}
      </div>

      {plans.length > 0 && (
        <label className="autonomous-field autonomous-history">
          <span>计划历史</span>
          <select
            value={activePlan?.planId ?? ''}
            onChange={(event) =>
              onSelectPlan(plans.find((item) => item.planId === event.target.value) ?? null)
            }
            disabled={running}
          >
            {plans.map((plan) => (
              <option key={plan.planId} value={plan.planId}>
                {new Date(plan.createdAt).toLocaleString()} · {STATUS_LABELS[plan.status]}
              </option>
            ))}
          </select>
        </label>
      )}
    </aside>
  );
}
