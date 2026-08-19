interface AutonomousApplyBarProps {
  applying: boolean;
  onApply(): void;
}

export default function AutonomousApplyBar({ applying, onApply }: AutonomousApplyBarProps) {
  return (
    <footer className="autonomous-apply-bar">
      <div>
        <strong>计划已完成</strong>
        <span>应用后会一次性创建正式创作资产，不会自动生成或采用正文。</span>
      </div>
      <button type="button" className="btn btn-primary" disabled={applying} onClick={onApply}>
        {applying ? '正在应用...' : '确认应用全书计划'}
      </button>
    </footer>
  );
}
