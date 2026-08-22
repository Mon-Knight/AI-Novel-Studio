// src/prompts/verification/chapter-verification-prompt.ts
// AI Novel Studio — 章节验证 Prompt 构建器
// 版本：v1.0.44
// 用途：根据大纲和草稿构建验证 Prompt
// 注意：只返回字符串，不调用 AI，不替换现有生成链路

/**
 * 章节验证 Prompt 输入
 */
export interface ChapterVerificationInput {
  /** 章节大纲（可选） */
  outline?: string;
  /** 待验证的章草稿 */
  draft: string;
}

/**
 * 构建章节验证 Prompt
 *
 * 用于检查生成的内容是否：
 * - 覆盖了章节大纲的主要要点
 * - 保持与设定的连贯性
 *
 * @param input - 验证输入参数
 * @returns 构建好的 Prompt 字符串
 */
export function buildChapterVerificationPrompt(input: ChapterVerificationInput): string {
  const parts: string[] = [];

  parts.push('## 章节验证');

  if (input.outline) {
    parts.push(`参考大纲：\n${input.outline}`);
  }

  parts.push(`待验证正文：\n${input.draft}`);
  parts.push(
    '请检查以上正文是否：\n' +
      '1. 覆盖了章节大纲的主要要点\n' +
      '2. 角色行为符合设定\n' +
      '3. 与前后文保持连贯\n' +
      '4. 没有逻辑矛盾',
  );

  return parts.join('\n\n');
}
