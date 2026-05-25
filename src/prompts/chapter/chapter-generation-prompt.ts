// src/prompts/chapter/chapter-generation-prompt.ts
// AI Novel Studio — 章节生成 Prompt 构建器
// 版本：v1.0.44
// 用途：根据章节目标和上下文构建章节生成 Prompt
// 注意：只返回字符串，不调用 AI，不替换现有生成链路

/**
 * 章节生成 Prompt 输入
 */
export interface ChapterGenerationInput {
  /** 本章目标 */
  chapterGoal: string;
  /** 章节大纲（可选） */
  outline?: string;
  /** 风格摘要（可选） */
  styleSummary?: string;
}

/**
 * 构建章节生成 Prompt
 *
 * @param input - 章节生成输入参数
 * @returns 构建好的 Prompt 字符串
 */
export function buildChapterGenerationPrompt(
  input: ChapterGenerationInput
): string {
  const parts: string[] = [];

  parts.push(`## 本章目标\n${input.chapterGoal}`);

  if (input.outline) {
    parts.push(`## 章节大纲\n${input.outline}`);
  }

  if (input.styleSummary) {
    parts.push(`## 风格要求\n${input.styleSummary}`);
  }

  parts.push(
    "请根据以上要求生成本章正文。注意保持与前后章节的连贯性。"
  );

  return parts.join("\n\n");
}
