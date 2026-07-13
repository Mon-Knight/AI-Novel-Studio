import type { CoCreationStage, CoCreationStageProgress } from '../../types/coCreation';
import { CO_CREATION_STAGES } from '../../features/co-creation/stageMachine';

interface Props {
  currentStage: CoCreationStage;
  progress: CoCreationStageProgress[];
  disabled?: boolean;
  onSelect: (stage: CoCreationStage) => void;
}

const statusLabel: Record<CoCreationStageProgress['status'], string> = {
  not_started: '未开始',
  in_progress: '进行中',
  minimum_complete: '最低完备',
  complete: '已完成',
  skipped: '已跳过',
};

export default function CoCreationStageRail({ currentStage, progress, disabled, onSelect }: Props) {
  return (
    <aside className="co-creation-stage-rail" aria-label="创作阶段">
      <div className="co-creation-rail-heading">
        <strong>创作阶段</strong>
        <span>按顺序推进，已确认内容自动跳过</span>
      </div>
      <ol className="co-creation-stage-list">
        {CO_CREATION_STAGES.map((definition, index) => {
          const item = progress.find((entry) => entry.stage === definition.stage) ?? {
            stage: definition.stage, status: 'not_started' as const, percentage: 0, missingRequiredFields: [],
          };
          const active = currentStage === definition.stage;
          return (
            <li key={definition.stage}>
              <button
                type="button"
                className={`co-creation-stage-button${active ? ' is-active' : ''}`}
                onClick={() => onSelect(definition.stage)}
                disabled={disabled}
                aria-current={active ? 'step' : undefined}
              >
                <span className="co-creation-stage-index">{index + 1}</span>
                <span className="co-creation-stage-copy">
                  <strong>{definition.label}</strong>
                  <small>{statusLabel[item.status]} · {item.percentage}%</small>
                </span>
                <span className={`co-creation-stage-dot is-${item.status}`} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
