import { useEffect, useMemo, useState } from 'react';
import type { AutonomousStoryPlan } from '../../types/autonomousCreation';
import type {
  AutonomousAutomationMode,
  AutonomousAutomationPolicy,
  AutonomousSchedulerSnapshot,
} from '../../types/autonomousScheduler';
import { createDefaultAutonomousPolicy } from '../../services/autonomous-creation/autonomousSchedulerService';

interface AutonomousSchedulerControlsProps {
  plan: AutonomousStoryPlan;
  scheduler: AutonomousSchedulerSnapshot;
  onStart: (policy: AutonomousAutomationPolicy) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

const MODES: Array<{ id: AutonomousAutomationMode; title: string; detail: string }> = [
  { id: 'draft_night', title: '夜间草稿', detail: '连续生成安全候选，全部保留给人工审阅。' },
  { id: 'quality_gate', title: '质量门禁', detail: '六专家指标达标后自动采用，否则暂停复核。' },
  { id: 'full_auto', title: '全自动', detail: '达标后采用正文并确认章节分析，持续推进上下文。' },
];

function minuteOfDay(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return Math.max(0, Math.min(1439, hour * 60 + minute));
}

function modePolicy(
  current: AutonomousAutomationPolicy,
  mode: AutonomousAutomationMode,
): AutonomousAutomationPolicy {
  return { ...current, mode, autoConfirmAnalysis: mode === 'full_auto' };
}

export function AutonomousSchedulerControls({
  plan,
  scheduler,
  onStart,
  onPause,
  onResume,
  onStop,
}: AutonomousSchedulerControlsProps) {
  const [policy, setPolicy] = useState(() => createDefaultAutonomousPolicy(plan));
  const [windowEnabled, setWindowEnabled] = useState(false);
  const [windowStart, setWindowStart] = useState('22:00');
  const [windowEnd, setWindowEnd] = useState('07:00');
  const run = scheduler.run;
  const editable = !run || ['completed', 'failed', 'stopped'].includes(run.status);

  useEffect(() => {
    if (run) {
      setPolicy(run.policy);
      setWindowEnabled(Boolean(run.policy.runWindow));
      if (run.policy.runWindow) {
        const format = (minute: number) =>
          `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
        setWindowStart(format(run.policy.runWindow.startMinute));
        setWindowEnd(format(run.policy.runWindow.endMinute));
      }
    }
  }, [run]);

  const startPolicy = useMemo<AutonomousAutomationPolicy>(
    () => ({
      ...policy,
      maxChapters: Math.max(1, Math.min(plan.chapters.length, policy.maxChapters)),
      runWindow: windowEnabled
        ? {
            startMinute: minuteOfDay(windowStart),
            endMinute: minuteOfDay(windowEnd),
            utcOffsetMinutes: -new Date().getTimezoneOffset(),
          }
        : undefined,
    }),
    [plan.chapters.length, policy, windowEnabled, windowEnd, windowStart],
  );

  if (!scheduler.capability.persistent) {
    return (
      <div className="autonomous-scheduler-unavailable" role="note">
        <strong>跨进程调度在浏览器模式停用</strong>
        <span>{scheduler.capability.reason}</span>
      </div>
    );
  }

  return (
    <section className="autonomous-scheduler" aria-label="跨进程无人值守调度">
      <header>
        <div>
          <strong>跨进程无人值守调度</strong>
          <span>策略与预算创建时冻结；lease、心跳、检查点和重启恢复由桌面端持久化。</span>
        </div>
        {run && <span className={`autonomous-run-status status-${run.status}`}>{run.status}</span>}
      </header>

      <div className="autonomous-scheduler-modes">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            className={policy.mode === mode.id ? 'active' : ''}
            disabled={!editable}
            onClick={() => setPolicy(modePolicy(policy, mode.id))}
          >
            <strong>{mode.title}</strong>
            <span>{mode.detail}</span>
          </button>
        ))}
      </div>

      <div className="autonomous-scheduler-grid">
        <label>
          <span>本次最多章节</span>
          <input
            type="number"
            min={1}
            max={plan.chapters.length}
            disabled={!editable}
            value={policy.maxChapters}
            onChange={(event) => setPolicy({ ...policy, maxChapters: Number(event.target.value) })}
          />
        </label>
        <label>
          <span>连续失败熔断</span>
          <input
            type="number"
            min={1}
            max={20}
            disabled={!editable}
            value={policy.maxConsecutiveFailures}
            onChange={(event) =>
              setPolicy({ ...policy, maxConsecutiveFailures: Number(event.target.value) })
            }
          />
        </label>
        <label>
          <span>单章重试次数</span>
          <input
            type="number"
            min={0}
            max={10}
            disabled={!editable}
            value={policy.maxRetriesPerChapter}
            onChange={(event) =>
              setPolicy({ ...policy, maxRetriesPerChapter: Number(event.target.value) })
            }
          />
        </label>
        <label>
          <span>最少成功专家</span>
          <input
            type="number"
            min={1}
            max={6}
            disabled={!editable}
            value={policy.minimumSuccessfulExperts}
            onChange={(event) =>
              setPolicy({ ...policy, minimumSuccessfulExperts: Number(event.target.value) })
            }
          />
        </label>
        <label>
          <span>最低平均分</span>
          <input
            type="number"
            min={0}
            max={100}
            disabled={!editable}
            value={policy.minimumAverageScore}
            onChange={(event) =>
              setPolicy({ ...policy, minimumAverageScore: Number(event.target.value) })
            }
          />
        </label>
        <label>
          <span>最低接受率（%）</span>
          <input
            type="number"
            min={0}
            max={100}
            disabled={!editable}
            value={Math.round(policy.minimumAcceptanceRate * 100)}
            onChange={(event) =>
              setPolicy({ ...policy, minimumAcceptanceRate: Number(event.target.value) / 100 })
            }
          />
        </label>
        <label>
          <span>每日 Token 上限</span>
          <input
            type="number"
            min={1}
            disabled={!editable}
            value={policy.dailyTokenBudget ?? ''}
            onChange={(event) =>
              setPolicy({ ...policy, dailyTokenBudget: Number(event.target.value) || undefined })
            }
          />
        </label>
        <label>
          <span>全书 Token 上限</span>
          <input
            type="number"
            min={1}
            disabled={!editable}
            value={policy.bookTokenBudget ?? ''}
            onChange={(event) =>
              setPolicy({ ...policy, bookTokenBudget: Number(event.target.value) || undefined })
            }
          />
        </label>
        <label>
          <span>每日成本上限（USD）</span>
          <input
            type="number"
            min={0.01}
            step={0.5}
            disabled={!editable}
            value={policy.dailyCostBudgetUsd ?? ''}
            onChange={(event) =>
              setPolicy({ ...policy, dailyCostBudgetUsd: Number(event.target.value) || undefined })
            }
          />
        </label>
        <label>
          <span>全书成本上限（USD）</span>
          <input
            type="number"
            min={0.01}
            step={1}
            disabled={!editable}
            value={policy.bookCostBudgetUsd ?? ''}
            onChange={(event) =>
              setPolicy({ ...policy, bookCostBudgetUsd: Number(event.target.value) || undefined })
            }
          />
        </label>
      </div>

      <div className="autonomous-scheduler-window">
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={windowEnabled}
            disabled={!editable}
            onChange={(event) => setWindowEnabled(event.target.checked)}
          />
          <span>仅在指定本地时段运行</span>
        </label>
        {windowEnabled && (
          <div>
            <label>
              <span>开始</span>
              <input
                type="time"
                value={windowStart}
                disabled={!editable}
                onChange={(event) => setWindowStart(event.target.value)}
              />
            </label>
            <label>
              <span>结束</span>
              <input
                type="time"
                value={windowEnd}
                disabled={!editable}
                onChange={(event) => setWindowEnd(event.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      {run && (
        <div className="autonomous-scheduler-progress">
          <span>
            {run.completedChapters} / {Math.min(run.totalChapters, run.policy.maxChapters)} 章
          </span>
          <span>
            今日 {(run.dailyTokenInput + run.dailyTokenOutput).toLocaleString()} Token · $
            {run.dailyCostUsd.toFixed(4)}
          </span>
          <span>连续失败 {run.consecutiveFailures}</span>
          {run.pauseReason && <span>原因：{run.pauseReason}</span>}
        </div>
      )}
      {scheduler.error && <p className="autonomous-scheduler-error">{scheduler.error}</p>}

      <footer>
        {!run || ['completed', 'failed', 'stopped'].includes(run.status) ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={scheduler.busy}
            onClick={() => onStart(startPolicy)}
          >
            启动无人值守任务
          </button>
        ) : run.status === 'paused' ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={scheduler.busy}
            onClick={onResume}
          >
            继续任务
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={scheduler.busy || run.status !== 'running'}
            onClick={onPause}
          >
            暂停任务
          </button>
        )}
        {run && ['queued', 'running', 'paused'].includes(run.status) && (
          <button type="button" className="btn btn-secondary" onClick={onStop}>
            停止任务
          </button>
        )}
      </footer>
    </section>
  );
}

export default AutonomousSchedulerControls;
