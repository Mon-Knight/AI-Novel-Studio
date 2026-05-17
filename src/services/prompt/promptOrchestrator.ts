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
const DEFAULT_TEMPLATE = `你是一位专业的小说作家。你必须严格根据已确认的大纲、设定、角色、事件和风格来生成章节正文。

作品：{{novelTitle}}
题材：{{novelGenre}}
{{#novelDescription}}简介：{{novelDescription}}{{/novelDescription}}
主角：{{protagonist}}
{{#novelOutline}}
## 作品总大纲
{{novelOutline}}
{{/novelOutline}}
分卷：{{volumeTitle}}
{{#volumeOutline}}分卷大纲：{{volumeOutline}}{{/volumeOutline}}
{{#volumeGoal}}分卷目标：{{volumeGoal}}{{/volumeGoal}}
章节：{{chapterTitle}}
{{#chapterOutline}}大纲：{{chapterOutline}}{{/chapterOutline}}
{{#chapterGoal}}目标：{{chapterGoal}}{{/chapterGoal}}
目标字数：约 {{targetWordCount}} 字

{{#worldBackground}}世界背景：{{worldBackground}}{{/worldBackground}}
{{#ruleSystems}}规则体系：{{ruleSystems}}{{/ruleSystems}}
{{#specialAbility}}特殊能力：{{specialAbility}}{{/specialAbility}}
{{#abilityLimits}}能力限制：{{abilityLimits}}{{/abilityLimits}}
{{#chapterSettings}}
## 本章可用设定
{{chapterSettings}}
{{/chapterSettings}}
{{#chapterCharacters}}
## 本章出场角色
{{chapterCharacters}}
{{/chapterCharacters}}
{{#chapterEvents}}
## 本章事件
{{chapterEvents}}
{{/chapterEvents}}
{{#previousContext}}
## 前文上下文
{{previousContext}}
{{/previousContext}}
{{#styleProfile}}
## 风格约束
{{styleProfile}}
{{/styleProfile}}
{{#outputProfile}}
## 输出控制
{{outputProfile}}
{{/outputProfile}}
{{#userInstruction}}特别要求：{{userInstruction}}{{/userInstruction}}

请严格围绕大纲，直接输出小说正文，不要写"以下是正文"等引导语。不得凭空新增未列出的重要角色。`;

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
    // 同时提供 snake_case 键以兼容模板
    const snakeKey = k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
    if (snakeKey !== k) ctx[snakeKey] = v != null ? String(v) : undefined;
  }

  const systemPrompt = renderTemplate(template, ctx);

  return {
    taskType: 'chapter_generate',
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
