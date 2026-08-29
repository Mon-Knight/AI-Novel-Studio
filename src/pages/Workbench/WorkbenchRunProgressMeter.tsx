import { memo, useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import type { TaskRun, ToolCallEvent } from '../../types/conversation';
import {
  formatRunActivityAge,
  formatRunDuration,
  isActiveWorkbenchRun,
  resolveWorkbenchRunProgress,
  RUN_PROGRESS_VISIBLE_AFTER_MS,
} from './workbenchRunProgress';
import { formatWorkbenchTime } from './workbenchHelpers';

export const WorkbenchRunProgressMeter = memo(function WorkbenchRunProgressMeter({
  run,
  events,
}: {
  run: TaskRun;
  events: ToolCallEvent[];
}) {
  const active = isActiveWorkbenchRun(run);
  const [clockMs, setClockMs] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const updateClock = () => setClockMs(Date.now());
    updateClock();
    const interval = window.setInterval(updateClock, 1_000);
    return () => window.clearInterval(interval);
  }, [active, run.runId]);

  const progress = resolveWorkbenchRunProgress(run, events, clockMs);
  if (!progress.active && progress.elapsedMs < RUN_PROGRESS_VISIBLE_AFTER_MS) return null;

  return (
    <div
      className={'workbench-run-progress ' + (progress.active ? 'is-active' : '')}
      data-testid="workbench-run-progress"
      data-active={progress.active ? 'true' : 'false'}
      role="timer"
      aria-live="off"
    >
      <Clock3 aria-hidden="true" size={12} strokeWidth={1.8} />
      <span className="workbench-run-progress-stage">
        <span>当前阶段</span>
        {progress.stage}
      </span>
      <span className="workbench-run-progress-metric">
        已用时 {formatRunDuration(progress.elapsedMs)}
      </span>
      <span className="workbench-run-progress-metric">
        最后活动{' '}
        {progress.active
          ? formatRunActivityAge(progress.lastActivityAtMs, clockMs)
          : formatWorkbenchTime(new Date(progress.lastActivityAtMs).toISOString())}
      </span>
    </div>
  );
});
