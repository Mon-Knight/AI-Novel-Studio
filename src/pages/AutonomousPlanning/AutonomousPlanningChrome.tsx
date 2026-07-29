import type { AutonomousPlanStatus } from '../../types/autonomousCreation';
import { STATUS_LABELS } from './autonomousPlanningPresentation';

interface AutonomousPlanningHeaderProps {
  novelTitle: string;
  status?: AutonomousPlanStatus;
  onBack(): void;
  onOpenWorkspace(): void;
}

export function AutonomousPlanningHeader({
  novelTitle,
  status,
  onBack,
  onOpenWorkspace,
}: AutonomousPlanningHeaderProps) {
  return (
    <header className="autonomous-header">
      <button
        type="button"
        className="autonomous-icon-button"
        title="返回作品详情"
        onClick={onBack}
      >
        ←
      </button>
      <div className="autonomous-heading">
        <h1>自主创作规划</h1>
        <span>{novelTitle}</span>
      </div>
      <div className="autonomous-header-actions">
        {status && (
          <span className={`autonomous-status status-${status}`}>{STATUS_LABELS[status]}</span>
        )}
        {status === 'applied' && (
          <button type="button" className="btn btn-primary" onClick={onOpenWorkspace}>
            进入写作工作台
          </button>
        )}
      </div>
    </header>
  );
}

interface AutonomousPlanningMissingStateProps {
  error: string;
  onBack(): void;
}

export function AutonomousPlanningMissingState({
  error,
  onBack,
}: AutonomousPlanningMissingStateProps) {
  return (
    <div className="autonomous-page autonomous-loading">
      <p>{error || '作品不存在。'}</p>
      <button type="button" className="btn btn-secondary" onClick={onBack}>
        返回作品库
      </button>
    </div>
  );
}

export function AutonomousPlanningEmptyState() {
  return (
    <div className="autonomous-empty">
      <strong>从一个创意开始</strong>
      <p>
        系统将先建立故事圣经，再让人物、世界、冲突与节奏 Agent 协作，最后按分卷生成完整章节计划。
      </p>
    </div>
  );
}
