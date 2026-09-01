import { isLoopbackAiBaseUrl } from '../ai/realAiClient';
import type { CurrentPluginProjection } from './currentPluginService';

export interface WorkbenchModelSelection {
  providerId: string;
  modelId: string;
}

export interface WorkbenchModelOption extends WorkbenchModelSelection {
  key: string;
  name: string;
  pluginId: string;
  source: string;
}

export type WorkbenchModelDirectoryStatus = 'refreshing' | 'available' | 'unavailable';

export interface WorkbenchModelAvailability {
  status: WorkbenchModelDirectoryStatus;
  options: WorkbenchModelOption[];
  selectedOption?: WorkbenchModelOption;
  fallbackOption?: WorkbenchModelOption;
  canSend: boolean;
  message: string;
}

interface WorkbenchModelAvailabilityInput {
  plugins: CurrentPluginProjection[];
  selectedModel: WorkbenchModelSelection;
  refreshing: boolean;
  refreshError?: string;
  allowLocalFallback?: boolean;
  selectionLocked?: boolean;
}

const MODEL_PREFIX = 'model:';
const BROWSER_MOCK_PLUGIN_ID = 'model:browser-fallback:Mock';

export class WorkbenchModelUnavailableError extends Error {
  readonly code = 'WORKBENCH_MODEL_NOT_IN_RUNTIME_DIRECTORY';

  constructor(model: WorkbenchModelSelection) {
    super(
      `模型 ${workbenchModelKey(model)} 不在当前 Runtime 模型目录中，请刷新目录或选择已加载模型。`,
    );
    this.name = 'WorkbenchModelUnavailableError';
  }
}

export function workbenchModelKey(model: WorkbenchModelSelection): string {
  return `${model.providerId.trim()}:${model.modelId.trim()}`;
}

export function resolveWorkbenchModelDirectoryTarget<T extends WorkbenchModelSelection>(
  taskCreatorOpen: boolean,
  selectedTaskModel: T,
  newTaskModel: T,
): T {
  return taskCreatorOpen ? newTaskModel : selectedTaskModel;
}

export function isLocalLikeWorkbenchModel(
  model: WorkbenchModelSelection & { baseUrl?: string },
): boolean {
  const providerId = model.providerId.trim().toLowerCase();
  if (providerId.includes('local') || providerId === 'local_llama_cpp') return true;
  return Boolean(model.baseUrl && isLoopbackAiBaseUrl(model.baseUrl));
}

function optionFromPlugin(plugin: CurrentPluginProjection): WorkbenchModelOption | undefined {
  if (
    plugin.category !== 'model' ||
    !plugin.id.startsWith(MODEL_PREFIX) ||
    plugin.status !== 'loaded' ||
    plugin.availability !== 'available' ||
    plugin.initialization !== 'initialized' ||
    plugin.health === 'failed' ||
    plugin.source === 'provider-settings'
  ) {
    return undefined;
  }

  if (plugin.id === BROWSER_MOCK_PLUGIN_ID && plugin.source === 'browser-fallback') {
    return {
      key: 'mock:Mock',
      providerId: 'mock',
      modelId: 'Mock',
      name: plugin.name,
      pluginId: plugin.id,
      source: plugin.source,
    };
  }

  const identity = plugin.id.slice(MODEL_PREFIX.length);
  const separator = identity.indexOf(':');
  if (separator <= 0 || separator === identity.length - 1) return undefined;

  const providerId = identity.slice(0, separator).trim();
  const modelId = identity.slice(separator + 1).trim();
  if (!providerId || !modelId) return undefined;

  return {
    key: `${providerId}:${modelId}`,
    providerId,
    modelId,
    name: plugin.name,
    pluginId: plugin.id,
    source: plugin.source,
  };
}

export function listAvailableWorkbenchModels(
  plugins: CurrentPluginProjection[],
): WorkbenchModelOption[] {
  const options = new Map<string, WorkbenchModelOption>();
  for (const plugin of plugins) {
    const option = optionFromPlugin(plugin);
    if (option && !options.has(option.key)) options.set(option.key, option);
  }
  return [...options.values()];
}

export function findAvailableWorkbenchModel(
  plugins: CurrentPluginProjection[],
  model: WorkbenchModelSelection,
): WorkbenchModelOption | undefined {
  const key = workbenchModelKey(model);
  return listAvailableWorkbenchModels(plugins).find((option) => option.key === key);
}

export function assertWorkbenchModelAvailable(
  plugins: CurrentPluginProjection[],
  model: WorkbenchModelSelection,
): WorkbenchModelOption {
  const option = findAvailableWorkbenchModel(plugins, model);
  if (!option) throw new WorkbenchModelUnavailableError(model);
  return option;
}

export function getWorkbenchModelAvailability({
  plugins,
  selectedModel,
  refreshing,
  refreshError,
  allowLocalFallback = false,
  selectionLocked = false,
}: WorkbenchModelAvailabilityInput): WorkbenchModelAvailability {
  const options = listAvailableWorkbenchModels(plugins);
  const selectedKey = workbenchModelKey(selectedModel);
  const selectedOption = options.find((option) => option.key === selectedKey);
  const runtimeFailure = plugins.find(
    (plugin) =>
      plugin.category === 'other' &&
      plugin.source === 'dsh-runtime-projection' &&
      plugin.status === 'failed',
  )?.description;

  if (refreshing) {
    return {
      status: 'refreshing',
      options,
      selectedOption,
      canSend: false,
      message: '正在刷新 Runtime 模型目录；可以继续编辑，完成后即可发送依赖模型的创作任务。',
    };
  }

  if (refreshError) {
    return {
      status: 'unavailable',
      options,
      selectedOption,
      canSend: false,
      message: 'Runtime 模型目录刷新失败，依赖模型的创作任务暂无法发送。',
    };
  }

  if (options.length === 0) {
    return {
      status: 'unavailable',
      options,
      canSend: false,
      message: runtimeFailure
        ? `当前 Runtime 模型目录不可用：${runtimeFailure}`
        : '当前 Runtime 模型目录不可用，依赖模型的创作任务暂无法发送。',
    };
  }

  if (!selectedOption) {
    const cloudFallback =
      allowLocalFallback && isLocalLikeWorkbenchModel(selectedModel)
        ? options.find(
            (option) => !isLocalLikeWorkbenchModel(option) && option.providerId !== 'mock',
          )
        : undefined;
    if (cloudFallback) {
      return {
        status: 'available',
        options,
        fallbackOption: cloudFallback,
        canSend: true,
        message: '本地模型当前不可用；创建任务时将先改用当前 API 模型，再冻结任务模型。',
      };
    }
    return {
      status: 'unavailable',
      options,
      canSend: false,
      message: selectionLocked
        ? `当前任务固定模型 ${selectedKey} 未进入 Runtime 模型目录；请使用当前已配置模型新建任务。`
        : '所选模型未进入当前 Runtime 模型目录；请选择已加载模型后发送创作任务。',
    };
  }

  return {
    status: 'available',
    options,
    selectedOption,
    canSend: true,
    message: '',
  };
}
