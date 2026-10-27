import { isLoopbackAiBaseUrl } from '../ai/realAiClient';
import { getCredentialStorageCopy } from '../ai/credentialStorageCopy';
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
  /**
   * Whether the selected model's process-scoped credential can be resolved.
   * This is an advisory setting hint. It never gates submission, switches
   * models or proves that a provider request will succeed.
   */
  credentialAvailable?: boolean;
}

const MODEL_PREFIX = 'model:';
const BROWSER_MOCK_PLUGIN_ID = 'model:browser-fallback:Mock';

export class WorkbenchModelUnavailableError extends Error {
  readonly code: string = 'WORKBENCH_MODEL_NOT_IN_RUNTIME_DIRECTORY';

  constructor(model: WorkbenchModelSelection) {
    super(
      `模型 ${workbenchModelKey(model)} 不在当前 Runtime 模型目录中，请刷新目录或选择已加载模型。`,
    );
    this.name = 'WorkbenchModelUnavailableError';
  }
}

export class WorkbenchModelCredentialUnavailableError extends WorkbenchModelUnavailableError {
  readonly code = 'WORKBENCH_MODEL_CREDENTIAL_UNAVAILABLE';

  constructor(model: WorkbenchModelSelection) {
    super(model);
    this.name = 'WorkbenchModelCredentialUnavailableError';
    this.message = `模型 ${workbenchModelKey(model)} 的匹配凭据不可用；${getCredentialStorageCopy().unavailableHint} 或在当前任务选择其他已配置模型后发送新回合。重试仍使用原回合模型。`;
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
  credentialAvailable,
}: WorkbenchModelAvailabilityInput): WorkbenchModelAvailability {
  const options = listAvailableWorkbenchModels(plugins);
  const selectedKey = workbenchModelKey(selectedModel);
  const selectedOption = options.find((option) => option.key === selectedKey);
  // A directory entry is descriptive. Availability is established by the actual
  // request, whose failure belongs in the persisted conversation.
  const canSend = Boolean(selectedModel.providerId.trim() && selectedModel.modelId.trim());
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
      canSend,
      message: '正在刷新模型列表；仍可直接发送，调用失败会显示在对话中。',
    };
  }
  if (refreshError) {
    return {
      status: 'unavailable',
      options,
      selectedOption,
      canSend,
      message: '模型列表刷新失败；仍可直接发送，调用失败会显示在对话中。',
    };
  }
  if (credentialAvailable === false) {
    return {
      status: 'unavailable',
      options,
      selectedOption,
      canSend,
      message: `尚未找到当前模型的匹配凭据；${getCredentialStorageCopy().unavailableHint} 发送后将使用同一模型执行，错误显示在对话中。`,
    };
  }
  if (!selectedOption) {
    return {
      status: 'unavailable',
      options,
      canSend,
      message: runtimeFailure
        ? `模型列表不可用：${runtimeFailure}。仍可直接发送，调用失败会显示在对话中。`
        : '可直接发送当前已配置模型，调用失败会显示在对话中。',
    };
  }
  return { status: 'available', options, selectedOption, canSend, message: '' };
}
