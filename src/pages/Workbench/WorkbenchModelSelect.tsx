import type { CurrentPluginProjection } from '../../services/conversation/currentPluginService';
import {
  getWorkbenchModelAvailability,
  workbenchModelKey,
} from '../../services/conversation/workbenchModelAvailability';
import { listSelectableWorkbenchModels } from '../../services/conversation/workbenchSelectableModels';
import type { TaskModelSnapshot } from '../../types/conversation';
import { Bot } from 'lucide-react';

interface WorkbenchModelSelectProps {
  id: string;
  plugins: CurrentPluginProjection[];
  selectedModel: TaskModelSnapshot;
  refreshing: boolean;
  refreshError: string;
  disabled?: boolean;
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
  testId,
  onChange,
}: WorkbenchModelSelectProps) {
  const selectedValue = workbenchModelKey(selectedModel);
  const availability = getWorkbenchModelAvailability({
    plugins,
    selectedModel,
    refreshing,
    refreshError,
  });
  const choices = listSelectableWorkbenchModels(plugins);
  const selectedMissing = !choices.some((option) => option.key === selectedValue);
  // Visual tone is separate from the five-state semantic status kept in
  // data attributes, so CSS does not need a selector per state.
  const statusTone =
    availability.status === 'ready'
      ? 'is-ready'
      : availability.status === 'initializing'
        ? 'is-initializing'
        : 'is-unavailable';
  const statusTitle =
    availability.status === 'ready'
      ? '模型已加载；实际可用性以调用结果为准'
      : availability.status === 'initializing'
        ? '正在刷新模型目录'
        : availability.message || '模型不可用';

  return (
    <label
      className={`workbench-model-control ${statusTone}`}
      htmlFor={id}
      title={`选择后续回合使用的模型；历史运行与重试保留原来源 · ${statusTitle}`}
      data-model-status={availability.status}
    >
      <Bot aria-hidden="true" size={14} strokeWidth={1.8} />
      <span className="workbench-model-status-dot" aria-hidden="true" />
      <span className="workbench-model-label">模型</span>
      <select
        id={id}
        data-testid={testId}
        aria-label="后续回合模型"
        data-model-locked={disabled ? 'true' : 'false'}
        data-model-value={selectedValue}
        data-model-status={availability.status}
        value={selectedValue}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
      >
        {selectedMissing && <option value={selectedValue}>{selectedModel.modelId}</option>}
        {choices.map((option) => (
          <option key={option.pluginId} value={option.key}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
}
