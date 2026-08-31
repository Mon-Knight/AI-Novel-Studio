import type { AiSettings } from '../../types/ai';
import type { TaskModelSnapshot } from '../../types/conversation';
import type { ToolDescriptorV1, ToolRegistryManifestV1 } from '../../types/toolRegistry';
import { productionToolRegistry } from '../agent-tools/productionToolRegistry';
import { getAiSettings } from '../ai/aiSettingsStore';
import { isTauri } from '../database/db';
import { dshTaskRuntimeService } from '../dsh/taskRuntimeService';

export type CurrentPluginCategory = 'function' | 'model' | 'other';
export type CurrentPluginStatus = 'loaded' | 'failed' | 'unavailable';
export type PluginAvailability = 'available' | 'unavailable';
export type PluginInitialization = 'initialized' | 'not_initialized' | 'failed';
export type PluginHealth = 'healthy' | 'unknown' | 'failed';

export interface CurrentPluginProjection {
  id: string;
  name: string;
  category: CurrentPluginCategory;
  version: string;
  description: string;
  status: CurrentPluginStatus;
  availability: PluginAvailability;
  initialization: PluginInitialization;
  health: PluginHealth;
  source: string;
  capabilities: string[];
}

export interface CurrentPluginProjectionInput {
  desktop: boolean;
  settings: AiSettings;
  manifest?: ToolRegistryManifestV1;
  manifestError?: string;
  runtimeRows?: unknown[];
  runtimeError?: string;
}

export const WORKBENCH_TOOLS = [
  'novel.read_context',
  'chapter.read_outline',
  'get_character_states',
  'search_memory',
  'generate_chapter',
  'generate_outline',
  'generate_characters',
  'suggest_events',
  'expand_settings',
  'polish_chapter',
  'check_quality',
  'summarize_chapter',
] as const;

const E2E_WORKBENCH_MODEL_STORAGE_KEY = 'ai_novel_studio_e2e_workbench_model';

function deterministicE2eModelEnabled(): boolean {
  if (import.meta.env?.VITE_AI_NOVEL_STUDIO_E2E !== '1') return false;
  try {
    return (
      typeof localStorage !== 'undefined' &&
      localStorage.getItem(E2E_WORKBENCH_MODEL_STORAGE_KEY) === 'enabled'
    );
  } catch {
    return false;
  }
}

function deterministicE2eModelProjection(): CurrentPluginProjection {
  return {
    id: 'model:mock:Mock',
    name: 'Mock',
    category: 'model',
    version: 'e2e-deterministic',
    description: 'Deterministic Workbench model exposed only by an explicitly enabled E2E test.',
    status: 'loaded',
    availability: 'available',
    initialization: 'initialized',
    health: 'healthy',
    source: 'e2e-deterministic-runtime',
    capabilities: ['conversation_turn', 'chapter_generate'],
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeText(value: unknown, fallback: string, max = 240): string {
  if (typeof value !== 'string') return fallback;
  const normalized = [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 0x1f && codePoint !== 0x7f;
    })
    .join('')
    .replace(
      /\b(authorization|proxy-authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|secret|password|credential)s?\b\s*[:=]\s*(?:bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '[REDACTED]',
    )
    .replace(/\bbearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/\bagt_[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]')
    .trim()
    .slice(0, max);
  return normalized || fallback;
}

export function safePluginErrorText(error: unknown, fallback: string): string {
  if (error instanceof Error) return safeText(error.message, fallback, 300);
  if (typeof error === 'string') return safeText(error, fallback, 300);
  const message = record(error)?.message;
  return safeText(message, fallback, 300);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => safeText(item, '', 120)).filter(Boolean))].slice(0, 32);
}

function runtimeProjection(value: unknown): CurrentPluginProjection | undefined {
  const row = record(value);
  if (!row) return undefined;
  const category = row.category;
  const status = row.status;
  const availability = row.availability;
  const initialization = row.initialization;
  const health = row.health;
  if (
    !['function', 'model', 'other'].includes(String(category)) ||
    !['loaded', 'failed', 'unavailable'].includes(String(status)) ||
    !['available', 'unavailable'].includes(String(availability)) ||
    !['initialized', 'not_initialized', 'failed'].includes(String(initialization)) ||
    !['healthy', 'unknown', 'failed'].includes(String(health))
  ) {
    return undefined;
  }
  const id = safeText(row.id, '', 240);
  const name = safeText(row.name, '', 160);
  if (!id || !name) return undefined;
  return {
    id,
    name,
    category: category as CurrentPluginCategory,
    version: safeText(row.version, 'unknown', 80),
    description: safeText(row.description, 'Runtime 未提供公开说明。', 500),
    status: status as CurrentPluginStatus,
    availability: availability as PluginAvailability,
    initialization: initialization as PluginInitialization,
    health: health as PluginHealth,
    source: safeText(row.source, 'dsh-runtime-projection', 120),
    capabilities: stringList(row.capabilities),
  };
}

function uniqueCapabilities(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function unavailableTool(tool: ToolDescriptorV1): CurrentPluginProjection {
  return {
    id: `tool:${tool.name}@${tool.version}`,
    name: tool.name,
    category: 'function',
    version: tool.version,
    description: `${tool.description} Tool Registry 已注册；尚无 DSH scoped registry 初始化证据。`,
    status: 'unavailable',
    availability: 'available',
    initialization: 'not_initialized',
    health: 'unknown',
    source: 'production-tool-registry',
    capabilities: [
      tool.name,
      `scope:${tool.scope}`,
      `side-effect:${tool.sideEffect}`,
      `confirmation:${tool.confirmationPolicy}`,
    ],
  };
}

function functionProjection(
  manifest: ToolRegistryManifestV1 | undefined,
  runtimeRows: Map<string, CurrentPluginProjection>,
  manifestError?: string,
): CurrentPluginProjection[] {
  if (!manifest) {
    return [
      {
        id: 'tool-registry:production',
        name: 'Production Tool Registry',
        category: 'function',
        version: 'unknown',
        description: safeText(manifestError, 'Tool Registry manifest 不可读取。', 300),
        status: 'failed',
        availability: 'unavailable',
        initialization: 'failed',
        health: 'failed',
        source: 'production-tool-registry',
        capabilities: [],
      },
    ];
  }

  const byName = new Map(manifest.tools.map((tool) => [tool.name, tool]));
  return WORKBENCH_TOOLS.map((name) => {
    const tool = byName.get(name);
    if (!tool) {
      return {
        id: `tool:${name}@1`,
        name,
        category: 'function' as const,
        version: '1',
        description: '首批 Workbench 工具不在当前 production Tool Registry manifest 中。',
        status: 'failed' as const,
        availability: 'unavailable' as const,
        initialization: 'failed' as const,
        health: 'failed' as const,
        source: 'production-tool-registry',
        capabilities: [name],
      };
    }
    const runtime = runtimeRows.get(`tool:${name}@${tool.version}`);
    if (!runtime) return unavailableTool(tool);
    return {
      ...runtime,
      name: tool.name,
      version: tool.version,
      description: `${tool.description} ${runtime.description}`,
      source: 'production-tool-registry+dsh-runtime-health',
      capabilities: uniqueCapabilities([
        tool.name,
        `scope:${tool.scope}`,
        `side-effect:${tool.sideEffect}`,
        `confirmation:${tool.confirmationPolicy}`,
        ...runtime.capabilities,
      ]),
    };
  });
}

function configuredModel(settings: AiSettings, desktop: boolean): CurrentPluginProjection {
  if (settings.runtimeMode === 'mock') {
    const browserAvailable = !desktop;
    return {
      id: 'model:browser-fallback:Mock',
      name: 'Mock',
      category: 'model',
      version: 'builtin',
      description: browserAvailable
        ? '浏览器确定性 fallback，明确不代表 DSH Provider 已加载。'
        : 'Mock 仅属于浏览器 fallback；桌面 Workbench 不把它投影为 DSH 模型。',
      status: browserAvailable ? 'loaded' : 'unavailable',
      availability: browserAvailable ? 'available' : 'unavailable',
      initialization: browserAvailable ? 'initialized' : 'not_initialized',
      health: browserAvailable ? 'healthy' : 'unknown',
      source: 'browser-fallback',
      capabilities: ['conversation_turn', 'chapter_generate', 'fallback'],
    };
  }

  const providerId = settings.provider === 'deepseek' ? 'deepseek-official' : settings.provider;
  const modelId = settings.modelName.trim() || 'unconfigured';
  const configured = Boolean(settings.baseUrl.trim() && settings.modelName.trim());
  return {
    id: `model:${providerId}:${modelId}`,
    name: settings.modelName.trim() || '未配置模型',
    category: 'model',
    version: 'configured',
    description: configured
      ? '设置中已配置；只有 runtime/health 模型目录出现后才视为 DSH loaded。'
      : 'Provider 设置缺少 Base URL 或模型名称。',
    status: 'unavailable',
    availability: configured ? 'available' : 'unavailable',
    initialization: 'not_initialized',
    health: 'unknown',
    source: 'provider-settings',
    capabilities: ['conversation_turn', 'chapter_generate', 'settings-only'],
  };
}

export function buildCurrentPluginProjection(
  input: CurrentPluginProjectionInput,
): CurrentPluginProjection[] {
  const normalizedRuntimeRows = (input.runtimeRows ?? [])
    .map(runtimeProjection)
    .filter((row): row is CurrentPluginProjection => Boolean(row));
  const runtimeById = new Map(normalizedRuntimeRows.map((row) => [row.id, row]));
  const functions = functionProjection(input.manifest, runtimeById, input.manifestError);
  const runtimeModels = normalizedRuntimeRows.filter((row) => row.category === 'model');
  const configured = configuredModel(input.settings, input.desktop);
  const models = runtimeModels.some((row) => row.id === configured.id)
    ? runtimeModels
    : [...runtimeModels, configured];
  const other = normalizedRuntimeRows.filter((row) => row.category === 'other');
  if (other.length === 0) {
    other.push({
      id: 'dsh-carrier:unavailable',
      name: 'Pinned DSH Carrier',
      category: 'other',
      version: 'unknown',
      description: safeText(
        input.runtimeError,
        input.desktop
          ? 'Runtime Projection 不可读取；未将桌面环境猜测为 loaded。'
          : '浏览器 fallback 没有 DSH Runtime。',
        300,
      ),
      status: input.runtimeError ? 'failed' : 'unavailable',
      availability: 'unavailable',
      initialization: input.runtimeError ? 'failed' : 'not_initialized',
      health: input.runtimeError ? 'failed' : 'unknown',
      source: input.desktop ? 'dsh-runtime-projection' : 'browser-fallback',
      capabilities: [],
    });
  }
  return [...functions, ...models, ...other];
}

export async function getCurrentPluginProjection(
  conversationId?: string,
  modelSnapshot?: TaskModelSnapshot,
): Promise<CurrentPluginProjection[]> {
  const settings = getAiSettings();
  let manifest: ToolRegistryManifestV1 | undefined;
  let manifestError: string | undefined;
  try {
    manifest = await productionToolRegistry.getManifest();
  } catch (error) {
    manifestError = safePluginErrorText(error, 'Tool Registry manifest 不可读取。');
  }

  const desktop = isTauri();
  let runtimeRows: unknown[] = [];
  let runtimeError: string | undefined;
  if (desktop) {
    try {
      runtimeRows = await dshTaskRuntimeService.listCurrentPlugins(conversationId, modelSnapshot);
    } catch (error) {
      runtimeError = safePluginErrorText(error, 'DSH Runtime Projection 不可读取。');
    }
  }
  if (deterministicE2eModelEnabled()) {
    runtimeRows.push(deterministicE2eModelProjection());
  }
  return buildCurrentPluginProjection({
    desktop,
    settings,
    manifest,
    manifestError,
    runtimeRows,
    runtimeError,
  });
}
