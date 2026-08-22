// src/prompts/style/style-constraint-prompt.ts
// AI Novel Studio — 风格约束 Prompt 构建器
// 版本：v1.0.44
// 用途：根据风格方案构建风格约束 Prompt
// 注意：只返回字符串，不调用 AI，不替换现有生成链路

/**
 * 风格约束 Prompt 输入
 */
export interface StyleConstraintInput {
  /** 风格方案名称（可选） */
  styleName?: string;
  /** 风格规则文本（可选） */
  styleRules?: string;
}

/**
 * 构建风格约束 Prompt
 *
 * @param input - 风格约束输入参数
 * @returns 构建好的 Prompt 字符串
 */
export function buildStyleConstraintPrompt(input: StyleConstraintInput): string {
  const parts: string[] = ['## 风格约束'];

  if (input.styleName) {
    parts.push(`应用风格方案：${input.styleName}`);
  }

  if (input.styleRules) {
    parts.push(`风格规则：\n${input.styleRules}`);
  } else {
    parts.push('（未指定风格约束）');
  }

  return parts.join('\n');
}
