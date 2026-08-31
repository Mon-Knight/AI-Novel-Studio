export type WorkbenchFailureLayer = 'parameter' | 'scheduling' | 'data' | 'service' | 'model';

export interface WorkbenchFailure {
  layer: WorkbenchFailureLayer;
  code: string;
  message: string;
  hint: string;
}

const CHAPTER_REQUIRED = 'WORKBENCH_CHAPTER_REQUIRED';
const CORE_ASSETS_MISSING = 'GENERATION_CORE_ASSETS_MISSING';
const PREVIOUS_CHAPTER_NOT_ADOPTED = 'WORKBENCH_PREVIOUS_CHAPTER_NOT_ADOPTED';
const PREVIOUS_CHAPTER_CONTENT_UNAVAILABLE = 'WORKBENCH_PREVIOUS_CHAPTER_CONTENT_UNAVAILABLE';
const RETRY_TARGET_FAILURES = new Set([
  'WORKBENCH_RETRY_TARGET_MISSING',
  'WORKBENCH_RETRY_TARGET_CONFLICT',
  'WORKBENCH_RETRY_TARGET_INVALID',
]);
const TRANSIENT_PROVIDER_FAILURE_PATTERN =
  /(?:\bHTTP[_\s:=]*(?:408|429|5\d\d)\b|模型服务错误[（(]\s*5\d\d\s*[）)]|请求过于频繁或额度不足[（(]\s*429\b|模型服务当前过载[（(]\s*overloaded_error\s*[）)])/i;
const RETRYABLE_PROVIDER_FAILURE_CODES = new Set([
  'AI_PROVIDER_TIMEOUT',
  'AI_PROVIDER_RATE_LIMITED',
  'AI_PROVIDER_SERVER_ERROR',
  'AI_PROVIDER_NETWORK_ERROR',
  'AI_PROVIDER_CONNECT_FAILED',
  'AI_PROVIDER_TRANSPORT_INTERRUPTED',
]);

export function classifyWorkbenchFailure(error: unknown): WorkbenchFailure {
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : '';
  const message = error instanceof Error ? error.message : String(error ?? '任务失败');
  const text = code + ' ' + message;

  if (
    code === CHAPTER_REQUIRED ||
    /未绑定章节|请先选择或创建章节|必须绑定目标章节|chapterId is required/i.test(text)
  ) {
    return {
      layer: 'data',
      code: CHAPTER_REQUIRED,
      message: '当前任务没有绑定章节，无法生成或润色正文。',
      hint: '在工作台顶部选择目标章节；若还没有章节，先到小说作品页创建分卷和章节。',
    };
  }
  if (code === CORE_ASSETS_MISSING) {
    return {
      layer: 'data',
      code,
      message: message.trim() || '当前章节缺少生成正文所需的核心创作资产。',
      hint: '到作品详情补齐章节大纲、世界设定和主角设定后，再回到工作台重试。',
    };
  }
  if (code === PREVIOUS_CHAPTER_NOT_ADOPTED) {
    return {
      layer: 'data',
      code,
      message: message.trim() || '上一章尚未采用为正式正文。',
      hint: '先完成上一章的审阅与采用，再继续生成下一章。',
    };
  }
  if (code === PREVIOUS_CHAPTER_CONTENT_UNAVAILABLE) {
    return {
      layer: 'data',
      code,
      message: message.trim() || '上一章的已采用正文不可读取。',
      hint: '先恢复上一章的正式正文，再继续生成下一章。',
    };
  }
  if (RETRY_TARGET_FAILURES.has(code)) {
    return {
      layer: 'data',
      code,
      message: message.trim() || '原运行的章节目标无法安全恢复。',
      hint: '保留原失败记录，回到目标章节后重新发送该回合目标。',
    };
  }
  if (/chapter not found|章节不存在|草稿不存在|没有可润色/i.test(text)) {
    return {
      layer: 'data',
      code: code || 'WORKBENCH_CHAPTER_MISSING',
      message: message.trim() || '目标章节或正文不存在。',
      hint: '确认所选章节仍在当前作品中，润色前需要先有已采用正文。',
    };
  }
  if (/candidateText|候选内容不能为空|章节候选过短|超过长度上限/i.test(text)) {
    return {
      layer: 'parameter',
      code: code || 'WORKBENCH_CANDIDATE_INVALID',
      message: message.trim() || '章节候选参数无效。',
      hint: '这是校验槽错误。请重试生成；不要让模型空调用 generate_chapter。',
    };
  }
  if (
    /AbortError|任务已取消|The operation was aborted/i.test(text) ||
    (error instanceof DOMException && error.name === 'AbortError')
  ) {
    return {
      layer: 'scheduling',
      code: 'WORKBENCH_CANCELLED',
      message: '任务已取消。',
      hint: '需要时重新发送同一目标即可再跑一轮。',
    };
  }
  if (/MODEL_TOOL_CALLING_NOT_VERIFIED/i.test(text)) {
    return {
      layer: 'model',
      code: code || 'MODEL_TOOL_CALLING_NOT_VERIFIED',
      message: '所选模型未通过当前 Runtime 的工具调用能力验证。',
      hint: '可重试验证，或在模型设置中选择支持原生工具调用的模型后再发送。',
    };
  }
  if (RETRYABLE_PROVIDER_FAILURE_CODES.has(code) || TRANSIENT_PROVIDER_FAILURE_PATTERN.test(text)) {
    return {
      layer: 'service',
      code: code || 'WORKBENCH_PROVIDER_TRANSIENT',
      message: message.trim() || '模型服务暂时不可用。',
      hint: '请稍后重试本回合；任务会继续使用已经固定的模型。',
    };
  }
  if (
    /DSH|治理请求身份|largeTextRef|哈希不一致|未找到固定 DSH|apiKey|API Key|No fallback|executeAiTask|compiled contract|网络|ECONN|timeout|超时/i.test(
      text,
    )
  ) {
    return {
      layer: 'service',
      code: code || 'WORKBENCH_SERVICE_FAILED',
      message: message.trim() || '生成服务调用失败。',
      hint: '检查设置中心的模型、API Key 与桌面 DSH 运行时，然后重试。',
    };
  }
  return {
    layer: 'model',
    code: code || 'WORKBENCH_MODEL_FAILED',
    message: message.trim() || '模型未能产出可用章节候选。',
    hint: '可换模型后重试，或先补章节大纲、风格方案再生成。',
  };
}

export function formatWorkbenchFailure(error: unknown): string {
  const failure = classifyWorkbenchFailure(error);
  return '【' + failure.layer + '】' + failure.message + ' ' + failure.hint;
}

export function chapterRequiredError(): Error & { code: string } {
  const error = new Error('当前任务没有绑定章节，无法生成或润色正文。') as Error & {
    code: string;
  };
  error.code = CHAPTER_REQUIRED;
  return error;
}
