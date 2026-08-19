import type { LocalChapterModelSettings } from '../../types/ai';
import { isTauriRuntime, tauriInvoke } from '../tauri/runtime';
import { requireLoopbackAiBaseUrl } from './realAiClient';

export interface LocalChapterModelHealthResult {
  healthOk: boolean;
  modelOk: boolean;
  smokeOk: boolean;
  modelName: string;
  finishReason?: string;
  textPreview?: string;
  message: string;
}

const SMOKE_PROMPT =
  '根据上下文、当前 Beat 目标和限制，续写这一个 Beat 的小说正文。严格保持人物身份、动作主体、因果顺序和既有设定；只完成输入中的一个 Beat，不提前写后续 Beat。只输出连贯小说正文，不要解释、总结、列提纲、输出 JSON 或思考过程。\n\nContext：\n夜雨中的旧车站，沈岚等待一列不该出现的列车。\n\nGoal：\n完成当前 Beat 并确认异常列车已经进站。\n\nBeat：\n听见本不该出现的列车进站。\n\nConstraints：\n- 只输出当前一个 Beat 的连续正文。';

function rootUrl(baseUrl: string): string {
  const clean = baseUrl.trim().replace(/\/+$/, '');
  return clean.endsWith('/v1') ? clean.slice(0, -3) : clean;
}

function signalWithTimeout(signal: AbortSignal | undefined, seconds: number) {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), seconds * 1000);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function headers(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey.trim() || 'local-no-key-required'}`,
    'Content-Type': 'application/json',
  };
}

async function browserHealthCheck(
  local: LocalChapterModelSettings,
  signal?: AbortSignal,
): Promise<LocalChapterModelHealthResult> {
  const availability = await browserAvailabilityCheck(local, signal);
  if (!availability.modelOk) return availability;
  const request = signalWithTimeout(signal, Math.min(30, local.timeoutSeconds));
  try {
    const smokeResponse = await fetch(`${local.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: headers(local.apiKey),
      signal: request.signal,
      body: JSON.stringify({
        model: local.modelName.trim(),
        messages: [{ role: 'user', content: SMOKE_PROMPT }],
        temperature: 0.2,
        max_tokens: 96,
        top_p: 0.8,
        top_k: 20,
        repeat_penalty: 1.08,
        stream: false,
      }),
    });
    if (!smokeResponse.ok) throw new Error(`Beat smoke 返回 HTTP ${smokeResponse.status}`);
    const smoke = (await smokeResponse.json()) as {
      choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }>;
    };
    const choice = smoke.choices?.[0];
    const text = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
    const smokeOk = Boolean(text) && !text.includes('<think>');
    return {
      healthOk: true,
      modelOk: true,
      smokeOk,
      modelName: local.modelName.trim(),
      finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
      textPreview: text ? text.slice(0, 240) : undefined,
      message: smokeOk
        ? '本地模型健康、模型匹配，Beat smoke 通过。'
        : '服务和模型匹配，但 Beat smoke 未返回可采纳正文。',
    };
  } finally {
    request.dispose();
  }
}

async function browserAvailabilityCheck(
  local: LocalChapterModelSettings,
  signal?: AbortSignal,
): Promise<LocalChapterModelHealthResult> {
  const request = signalWithTimeout(signal, Math.min(30, local.timeoutSeconds));
  try {
    const root = rootUrl(local.baseUrl);
    const healthResponse = await fetch(`${root}/health`, {
      method: 'GET',
      headers: headers(local.apiKey),
      signal: request.signal,
    });
    if (!healthResponse.ok) throw new Error(`/health 返回 HTTP ${healthResponse.status}`);
    const modelsResponse = await fetch(`${root}/v1/models`, {
      method: 'GET',
      headers: headers(local.apiKey),
      signal: request.signal,
    });
    if (!modelsResponse.ok) throw new Error(`/v1/models 返回 HTTP ${modelsResponse.status}`);
    const models = (await modelsResponse.json()) as {
      data?: Array<{ id?: unknown; model?: unknown; name?: unknown }>;
      models?: Array<{ id?: unknown; model?: unknown; name?: unknown }>;
    };
    const modelEntries = [...(models.data ?? []), ...(models.models ?? [])];
    const modelOk = Boolean(
      modelEntries.some(
        (item) =>
          item &&
          [item.id, item.model, item.name].some((value) => value === local.modelName.trim()),
      ),
    );
    return {
      healthOk: true,
      modelOk,
      smokeOk: false,
      modelName: local.modelName.trim(),
      message: modelOk
        ? '本地模型服务健康且模型身份匹配。'
        : '服务健康，但 /v1/models 中没有匹配的模型名称。',
    };
  } finally {
    request.dispose();
  }
}

/** Non-generative preflight: only /health and /v1/models, with no Beat smoke call. */
export async function checkLocalChapterModelAvailability(
  local: LocalChapterModelSettings,
  signal?: AbortSignal,
): Promise<LocalChapterModelHealthResult> {
  if (!local.baseUrl.trim() || !local.modelName.trim()) {
    throw new Error('本地模型检查缺少 Base URL 或模型名称。');
  }
  requireLoopbackAiBaseUrl(local.baseUrl);
  if (isTauriRuntime()) {
    return tauriInvoke<LocalChapterModelHealthResult>('check_local_chapter_model_availability', {
      request: {
        baseUrl: local.baseUrl,
        apiKey: local.apiKey || 'local-no-key-required',
        modelName: local.modelName,
        timeoutSeconds: Math.min(30, local.timeoutSeconds),
      },
    });
  }
  return browserAvailabilityCheck(local, signal);
}

export async function checkLocalChapterModel(
  local: LocalChapterModelSettings,
  signal?: AbortSignal,
): Promise<LocalChapterModelHealthResult> {
  if (!local.baseUrl.trim() || !local.modelName.trim()) {
    throw new Error('本地模型检查缺少 Base URL 或模型名称。');
  }
  requireLoopbackAiBaseUrl(local.baseUrl);
  if (isTauriRuntime()) {
    return tauriInvoke<LocalChapterModelHealthResult>('check_local_chapter_model', {
      request: {
        baseUrl: local.baseUrl,
        apiKey: local.apiKey || 'local-no-key-required',
        modelName: local.modelName,
        timeoutSeconds: Math.min(30, local.timeoutSeconds),
      },
    });
  }
  return browserHealthCheck(local, signal);
}
