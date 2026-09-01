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

  return (
    <label
      className={`workbench-model-control${locked ? ' is-locked' : ''}`}
      htmlFor={id}
      title={locked ? '模型已在任务创建时固定' : undefined}
    >
      <Bot aria-hidden="true" size={14} strokeWidth={1.8} />
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
