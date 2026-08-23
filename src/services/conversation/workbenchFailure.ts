export type WorkbenchFailureLayer = 'parameter' | 'scheduling' | 'data' | 'service' | 'model';

export interface WorkbenchFailure {
  layer: WorkbenchFailureLayer;
  code: string;
  message: string;
  hint: string;
}

const CHAPTER_REQUIRED = 'WORKBENCH_CHAPTER_REQUIRED';

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
