/**
 * AI Novel Studio - 提示词调度中心
 * 负责将上下文组装为 AI 请求
 */
import type { AiGenerateRequest } from '../../types/ai';
import type { ChapterGenerationContext } from '../../types/ai';

// 简单模板引擎：替换 {{variable}} 和处理 {{#variable}}块{{/variable}}
function renderTemplate(template: string, context: Record<string, string | undefined>): string {
  let result = template;

  // 处理条件块 {{#key}}...{{/key}}
  result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key: string, content: string) => {
    return context[key] ? content : '';
  });

  // 替换变量
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return context[key] || '';
  });

  return result.trim();
}

// 默认章节生成模板（兜底）
const DEFAULT_TEMPLATE = `你是一位专业的小说作家。

作品：{{novel_title}}
题材：{{novel_genre}}
主角：{{protagonist}}
章节：{{chapter_title}}
{{#chapter_outline}}大纲：{{chapter_outline}}{{/chapter_outline}}
{{#chapter_goal}}目标：{{chapter_goal}}{{/chapter_goal}}
目标字数：约 {{target_word_count}} 字

{{#world_background}}世界背景：{{world_background}}{{/world_background}}
{{#rule_systems}}规则体系：{{rule_systems}}{{/rule_systems}}
{{#special_ability}}特殊能力：{{special_ability}}{{/special_ability}}
{{#user_instruction}}特别要求：{{user_instruction}}{{/user_instruction}}

请严格围绕大纲，直接输出小说正文，不要写"以下是正文"等引导语。`;

export async function buildGenerateRequest(
  context: ChapterGenerationContext,
): Promise<AiGenerateRequest> {
  // 尝试加载外部模板
  let template = DEFAULT_TEMPLATE;
  try {
    const resp = await fetch('/prompts/chapter_generate.md');
    if (resp.ok) {
      template = await resp.text();
    }
  } catch {
    // 使用默认模板
  }

  const ctx: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(context)) {
    ctx[k] = v != null ? String(v) : undefined;
  }

  const systemPrompt = renderTemplate(template, ctx);

  return {
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: `请开始写《${context.chapterTitle}》的正文。`,
      },
    ],
  };
}
