import { isLoopbackAiBaseUrl } from '../ai/realAiClient';
import { getCredentialStorageCopy } from '../ai/credentialStorageCopy';
import type { CurrentPluginProjection } from './currentPluginService';
import { canonicalModelProviderId, modelRouteKey, normalizeModelId } from './modelIdentity';

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

export type WorkbenchModelDirectoryStatus =
  'not_registered' | 'initializing' | 'ready' | 'unavailable' | 'error';

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
  return modelRouteKey(model);
}

/** Stable key for the Runtime probe effect; endpoint changes must re-probe. */
export function workbenchModelProbeKey(
  model: WorkbenchModelSelection & {
    runtimeMode: 'mock' | 'api';
    baseUrl?: string;
  },
): string {
  return `${model.runtimeMode}\u0000${modelRouteKey(model)}\u0000${model.baseUrl?.trim() ?? ''}`;
}

/** Only saved API routes need a Runtime registration probe. */
export function shouldProbeConfiguredWorkbenchModel(
  model: WorkbenchModelSelection & { runtimeMode: 'mock' | 'api'; baseUrl?: string },
): boolean {
  return model.runtimeMode === 'api' && Boolean(model.baseUrl?.trim() && model.modelId.trim());
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
  const providerId = canonicalModelProviderId(model.providerId);
  if (providerId.includes('local') || providerId === 'local_llama_cpp') return true;
  return Boolean(model.baseUrl && isLoopbackAiBaseUrl(model.baseUrl));
}

function modelSelectionFromPlugin(
  plugin: CurrentPluginProjection,
): WorkbenchModelSelection | undefined {
  if (plugin.category !== 'model' || !plugin.id.startsWith(MODEL_PREFIX)) return undefined;
  if (plugin.id === BROWSER_MOCK_PLUGIN_ID) return { providerId: 'mock', modelId: 'Mock' };
  const identity = plugin.id.slice(MODEL_PREFIX.length);
  const separator = identity.indexOf(':');
  if (separator <= 0 || separator === identity.length - 1) return undefined;
  const providerId = canonicalModelProviderId(identity.slice(0, separator));
  const modelId = normalizeModelId(identity.slice(separator + 1));
  if (!providerId || !modelId) return undefined;
  return { providerId, modelId };
}

function optionFromPlugin(plugin: CurrentPluginProjection): WorkbenchModelOption | undefined {
  if (
    plugin.status !== 'loaded' ||
    plugin.availability !== 'available' ||
    plugin.initialization !== 'initialized' ||
    plugin.health === 'failed' ||
    plugin.source === 'provider-settings'
  ) {
    return undefined;
  }
  const selection = modelSelectionFromPlugin(plugin);
  if (!selection) return undefined;
  return {
    key: modelRouteKey(selection),
    providerId: selection.providerId,
    modelId: selection.modelId,
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
      status: 'initializing',
      options,
      selectedOption,
      canSend,
      message: '正在刷新模型列表',
    };
  }
  if (refreshError) {
    return {
      status: 'error',
      options,
      selectedOption,
      canSend,
      message: `模型列表刷新失败：${refreshError}。请点击重试，或打开模型设置检查接口地址与 API 密钥。`,
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
    // A row that exists in the Runtime projection but did not load is a real
    // failure; an unprobed configured model is directly usable in the native loop.
    const selectedDirectoryRow = plugins.find((plugin) => {
      if (plugin.source === 'provider-settings') return false;
      const selection = modelSelectionFromPlugin(plugin);
      return selection ? modelRouteKey(selection) === selectedKey : false;
    });
    if (
      selectedDirectoryRow &&
      (selectedDirectoryRow.status === 'failed' || selectedDirectoryRow.health === 'failed')
    ) {
      return {
        status: 'unavailable',
        options,
        canSend,
        message: `当前模型暂不可用：${selectedDirectoryRow.description}。请检查接口地址与 API 密钥后重试。`,
      };
    }
    if (runtimeFailure) {
      return {
        status: 'error',
        options,
        canSend,
        message: `本地运行时状态异常：${runtimeFailure}。请点击重试或检查模型设置。`,
      };
    }
    return { status: 'ready', options, canSend, message: '' };
  }
  return { status: 'ready', options, selectedOption, canSend, message: '' };
}
