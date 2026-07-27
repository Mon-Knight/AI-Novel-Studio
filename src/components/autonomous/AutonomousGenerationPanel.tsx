import { useState } from 'react';
import { useAutonomousGeneration } from '../../hooks/useAutonomousGeneration';
import type { AutonomousGenerationJob, AutonomousAction, QualityThresholds } from '../../types/autonomous';

interface Props {
  novelId: string;
  totalChapters: number;
}

export function AutonomousGenerationPanel({ novelId, totalChapters }: Props) {
  const state = useAutonomousGeneration({ novelId, autoRefresh: true });
  const [showActions, setShowActions] = useState(false);
  const [pauseReason, setPauseReason] = useState('');

  const create = async () => {
    if (totalChapters <= 0) return;
    await state.createJob(totalChapters);
  };
  const start = async () => {
    if (state.activeJob) await state.startJob(state.activeJob.id);
  };
  const pause = async () => {
    if (!state.activeJob) return;
    await state.pauseJob(state.activeJob.id, pauseReason.trim() || '用户暂停');
    setPauseReason('');
  };
  const showLog = async () => {
    if (!state.activeJob) return;
    await state.loadActions(state.activeJob.id);
    setShowActions(true);
  };

  if (state.loading && state.jobs.length === 0) return <section className="autonomous-panel">加载自主生成任务…</section>;
  if (state.error) {
    return <section className="autonomous-panel autonomous-panel-error"><strong>自主生成暂不可用</strong><span>{state.error.message}</span></section>;
  }

  return (
    <section className="autonomous-panel" aria-label="自主生成控制面板">
      <div className="autonomous-panel-header">
        <div>
          <h2>自主生成控制面板</h2>
          <p>生成、质量检查、连续性守护和专家评审都会写入操作日志。</p>
        </div>
        <button className="btn btn-secondary" onClick={() => void state.refresh()} disabled={state.loading}>刷新</button>
      </div>

      {state.activeJob ? (
        <JobCard
          job={state.activeJob}
          updating={state.updating}
          onStart={() => void start()}
          onPause={() => void pause()}
          onResume={() => void state.resumeJob(state.activeJob!.id)}
          onCancel={() => void state.cancelJob(state.activeJob!.id)}
          onShowActions={() => void showLog()}
        />
      ) : (
        <div className="autonomous-empty">
          <p>当前没有可操作的自主生成任务。</p>
          <button className="btn btn-primary" onClick={() => void create()} disabled={state.creating || totalChapters <= 0}>
            {state.creating ? '创建中…' : `创建 ${totalChapters} 章任务`}
          </button>
        </div>
      )}

      {state.activeJob?.status === 'running' && (
        <label className="autonomous-pause-reason">
          暂停原因
          <input value={pauseReason} onChange={(event) => setPauseReason(event.target.value)} placeholder="可选" />
        </label>
      )}

      {state.thresholds && (
        <ThresholdsCard thresholds={state.thresholds} updating={state.updating} onUpdate={state.updateThresholds} />
      )}
      {showActions && <ActionsLog actions={state.actions} onClose={() => setShowActions(false)} />}
      {state.jobs.length > 1 && (
        <div className="autonomous-history">
          <h3>历史任务</h3>
          {state.jobs.slice(1).map((job) => <HistoryItem key={job.id} job={job} />)}
        </div>
      )}
    </section>
  );
}

function JobCard(props: {
  job: AutonomousGenerationJob;
  updating: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onShowActions: () => void;
}) {
  const { job } = props;
  const progress = job.totalChapters > 0 ? Math.round((job.completedChapters / job.totalChapters) * 100) : 0;
  const statusLabels: Record<AutonomousGenerationJob['status'], string> = {
    pending: '待开始', running: '运行中', paused: '已暂停', completed: '已完成', failed: '失败', cancelled: '已取消',
  };
  return (
    <div className="autonomous-job-card">
      <div className="autonomous-job-meta"><strong>{statusLabels[job.status]}</strong><span>{job.completedChapters} / {job.totalChapters} 章</span></div>
      <div className="autonomous-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>
      <div className="autonomous-stat-grid">
        <span>输入 Token<strong>{job.totalTokensInput.toLocaleString()}</strong></span>
        <span>输出 Token<strong>{job.totalTokensOutput.toLocaleString()}</strong></span>
        <span>估算成本<strong>${job.estimatedCostUsd.toFixed(2)}</strong></span>
      </div>
      {job.pausedReason && <p className="autonomous-paused-reason">暂停原因：{job.pausedReason}</p>}
      <div className="autonomous-actions">
        {job.status === 'pending' && <button className="btn btn-primary" onClick={props.onStart} disabled={props.updating}>开始</button>}
        {job.status === 'running' && <button className="btn btn-secondary" onClick={props.onPause} disabled={props.updating}>暂停</button>}
        {job.status === 'paused' && <button className="btn btn-primary" onClick={props.onResume} disabled={props.updating}>恢复</button>}
        {(job.status === 'running' || job.status === 'paused') && <button className="btn btn-danger" onClick={props.onCancel} disabled={props.updating}>取消</button>}
        <button className="btn btn-secondary" onClick={props.onShowActions}>查看日志</button>
      </div>
    </div>
  );
}

function ThresholdsCard({
  thresholds,
  updating,
  onUpdate,
}: {
  thresholds: QualityThresholds;
  updating: boolean;
  onUpdate: (params: Partial<QualityThresholds>) => Promise<void>;
}) {
  const fields: Array<[keyof QualityThresholds, string]> = [
    ['minTotalScore', '总分'],
    ['minLogicScore', '逻辑'],
    ['minSettingScore', '设定'],
    ['minCharacterScore', '人物'],
    ['minContinuityScore', '连续性'],
    ['maxRetryAttempts', '最大重试'],
  ];
  return (
    <div className="autonomous-thresholds">
      <h3>质量门槛</h3>
      <div className="autonomous-threshold-grid">
        {fields.map(([key, label]) => (
          <label key={key}>{label}<input type="number" min={0} max={100} value={Number(thresholds[key])} disabled={updating} onChange={(event) => void onUpdate({ [key]: Number(event.target.value) })} /></label>
        ))}
      </div>
    </div>
  );
}

function ActionsLog({ actions, onClose }: { actions: AutonomousAction[]; onClose: () => void }) {
  return (
    <div className="autonomous-log">
      <div className="autonomous-panel-header"><h3>操作日志</h3><button className="btn btn-secondary" onClick={onClose}>关闭</button></div>
      {actions.length === 0 ? <p>暂无日志。</p> : actions.map((action) => <div className="autonomous-log-row" key={action.id}><strong>{action.actionType}</strong><span>{action.decisionReason}</span></div>)}
    </div>
  );
}

function HistoryItem({ job }: { job: AutonomousGenerationJob }) {
  return <div className="autonomous-history-row"><span>{job.status}</span><span>{job.completedChapters} / {job.totalChapters} 章</span></div>;
}
