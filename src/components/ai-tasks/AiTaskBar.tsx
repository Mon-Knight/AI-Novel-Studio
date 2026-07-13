import { Link } from 'react-router-dom';
import { useAiTaskCenter } from '../../hooks/useAiTaskCenter';
import { AI_TASK_USER_STATUS_LABELS } from '../../types/aiTaskCenter';
import { getAiTaskDisplayLabel } from '../../utils/aiTaskDisplay';

function AiTaskBar() {
  const { items, error } = useAiTaskCenter({ pollMs: 4000 });
  const active = items.filter((item) => ['preparing', 'working', 'checking'].includes(item.userStatus));
  const review = items.filter((item) => item.userStatus === 'awaiting_confirmation');
  const failed = items.filter((item) => item.userStatus === 'failed');
  const primary = active[0] || review[0] || failed[0];

  if (!primary && !error) return null;

  return (
    <div className="ai-task-bar" role="status" aria-live="polite" data-testid="ai-task-bar">
      <span className={`ai-task-bar-dot status-${primary?.userStatus || 'failed'}`} />
      <div className="ai-task-bar-message">
        {error ? (
          <span>任务状态暂时无法读取</span>
        ) : primary ? (
          <>
            <strong>{getAiTaskDisplayLabel(primary.taskType)}</strong>
            <span>{AI_TASK_USER_STATUS_LABELS[primary.userStatus]}</span>
            {(primary.chapterTitle || primary.novelTitle) && (
              <span className="ai-task-bar-scope">{primary.chapterTitle || primary.novelTitle}</span>
            )}
          </>
        ) : null}
      </div>
      <div className="ai-task-bar-counts">
        {active.length > 0 && <span>{active.length} 项进行中</span>}
        {review.length > 0 && <span>{review.length} 项待确认</span>}
      </div>
      <Link className="ai-task-bar-link" to="/ai-tasks">
        {review.length > 0 ? '进入任务中心审查' : '查看任务中心'}
      </Link>
    </div>
  );
}

export default AiTaskBar;
