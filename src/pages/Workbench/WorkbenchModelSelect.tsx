import type { CurrentPluginProjection } from '../../services/conversation/currentPluginService';
import { getWorkbenchModelAvailability } from '../../services/conversation/workbenchModelAvailability';
import type { TaskModelSnapshot } from '../../types/conversation';
import { Bot } from 'lucide-react';

interface WorkbenchModelSelectProps {
  id: string;
  plugins: CurrentPluginProjection[];
  selectedModel: TaskModelSnapshot;
  refreshing: boolean;
  refreshError: string;
  disabled?: boolean;
  locked?: boolean;
  testId?: string;
  onChange?: (value: string) => void;
  lockedReason?: string;
}

export function WorkbenchModelSelect({
  id,
  plugins,
  selectedModel,
  refreshing,
  refreshError,
  disabled = false,
  locked = false,
  testId,
  onChange,
  lockedReason = '任务创建时固定；更换模型请新建任务。',
}: WorkbenchModelSelectProps) {
  const selectedValue = `${selectedModel.providerId}:${selectedModel.modelId}`;
  const availability = getWorkbenchModelAvailability({
    plugins,
    selectedModel,
    refreshing,
    refreshError,
    selectionLocked: locked,
  });
  const selectedMissing = !availability.selectedOption;
  const statusTitle =
    availability.status === 'available'
      ? '模型可用'
      : availability.status === 'refreshing'
        ? '正在刷新模型目录'
        : availability.message || '模型不可用';

  if (locked) {
    return (
      <div
        id={id}
        className={`workbench-model-control workbench-fixed-model is-${availability.status}`}
        role="group"
        aria-label="当前任务固定模型"
        aria-describedby={`${id}-fixed-reason`}
        data-testid={testId}
        data-model-locked="true"
        data-model-value={selectedValue}
        data-model-status={availability.status}
      >
        <Bot aria-hidden="true" size={14} strokeWidth={1.8} />
        <span className="workbench-model-status-dot" aria-hidden="true" />
        <span className="workbench-fixed-model-name" title={`${selectedValue} · ${statusTitle}`}>
          {availability.selectedOption?.name || selectedModel.modelId}
        </span>
        <details
          className="workbench-fixed-model-details"
          data-testid="workbench-fixed-model-reason"
        >
          <summary title={lockedReason}>固定原因</summary>
          <p id={`${id}-fixed-reason`}>{lockedReason}</p>
        </details>
      </div>
    );
  }

  return (
    <label
      className={`workbench-model-control${locked ? ' is-locked' : ''} is-${availability.status}`}
      htmlFor={id}
      title={locked ? `模型已在任务创建时固定 · ${statusTitle}` : statusTitle}
      data-model-status={availability.status}
    >
      <Bot aria-hidden="true" size={14} strokeWidth={1.8} />
      <span className="workbench-model-status-dot" aria-hidden="true" />
      <span className="workbench-model-label">模型</span>
      <select
        id={id}
        data-testid={testId}
        data-model-locked={locked ? 'true' : 'false'}
        value={selectedValue}
        disabled={
          locked ||
          disabled ||
          refreshing ||
          Boolean(refreshError) ||
          availability.options.length === 0
        }
        onChange={(event) => onChange?.(event.target.value)}
      >
        {selectedMissing && (
          <option value={selectedValue} disabled>
            {refreshing
              ? '正在刷新模型目录…'
              : availability.options.length === 0
                ? '模型目录不可用'
                : locked
                  ? '任务固定模型不可用'
                  : '所选模型未进入 Runtime 目录'}
          </option>
        )}
        {availability.options.map((option) => (
          <option key={option.pluginId} value={option.key}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}
