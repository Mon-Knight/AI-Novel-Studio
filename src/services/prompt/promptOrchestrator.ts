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
  result = result.replace(/\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key: string, content: string) => {
    return context[key] ? '' : content;
  });

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

{{#protagonist_names}}
【硬性角色约束（最高优先级）】
本作品主角固定为：{{protagonist_names}}。
严禁将主角名字改为任何其他名字。
严禁新增替代主角或使用其他姓名替代主角。
如果需要称呼主角，只能使用以上列出的名字及其自然代词。
{{/protagonist_names}}

作品：{{novelTitle}}
题材：{{novelGenre}}
{{#novelDescription}}简介：{{novelDescription}}{{/novelDescription}}
主角：{{protagonist}}

【主角档案】
姓名：{{protagonist}}
{{#protagonistsSummary}}{{protagonistsSummary}}{{/protagonistsSummary}}
{{#specialAbility}}特殊能力：{{specialAbility}}{{/specialAbility}}
{{#abilityLimits}}限制：{{abilityLimits}}{{/abilityLimits}}
{{#forbiddenBehaviors}}禁止行为：{{forbiddenBehaviors}}{{/forbiddenBehaviors}}

{{#styleProfile}}
【写作风格约束（必须遵守）】
{{styleProfile}}

你必须严格按照以上风格生成本章正文，不要使用默认网文模板。
{{/styleProfile}}

{{#novelOutline}}
## 作品总大纲
{{novelOutline}}
{{/novelOutline}}
分卷：{{volumeTitle}}
{{#volumeOutline}}分卷大纲：{{volumeOutline}}{{/volumeOutline}}
{{#volumeGoal}}分卷目标：{{volumeGoal}}{{/volumeGoal}}
章节：{{chapterTitle}}
{{#chapterOutline}}大纲：{{chapterOutline}}{{/chapterOutline}}
{{#chapterGoal}}
【本章目标】
{{chapterGoal}}
正文必须围绕本章目标推进；如果本章目标与章节大纲冲突，以用户最新修改的本章目标为优先。
{{/chapterGoal}}
{{^chapterGoal}}
【本章目标】
未单独设置本章目标，请根据章节大纲和分卷大纲自然推进。
{{/chapterGoal}}
目标字数：约 {{targetWordCount}} 字

{{#worldBackground}}世界背景：{{worldBackground}}{{/worldBackground}}
{{#ruleSystems}}规则体系：{{ruleSystems}}{{/ruleSystems}}
{{#specialAbility}}特殊能力：{{specialAbility}}{{/specialAbility}}
{{#abilityLimits}}能力限制：{{abilityLimits}}{{/abilityLimits}}
{{#protagonistsSummary}}
## 主角详细设定
{{protagonistsSummary}}
{{/protagonistsSummary}}
{{#protagonistAppearance}}
## 主角本章出场状态
{{protagonistAppearance}}
{{/protagonistAppearance}}
{{#dualProtagonistSummary}}
## 双主角关系
{{dualProtagonistSummary}}
{{/dualProtagonistSummary}}
{{#chapterSettings}}
## 本章可用设定
{{chapterSettings}}
{{/chapterSettings}}
{{#chapterCharacters}}
【本章出场角色 — 强制约束】
{{chapterCharacters}}

必须遵守以下角色出场规则：
1. 标记为「必须直接出场」的角色必须在正文中直接出现，参与本章剧情
2. 每个必须出场角色至少应有实际行动、对话或心理描写
3. 不得只在旁白或设定说明中提到角色
4. 标记为「主角」的角色必须有足够篇幅，不能写成路人
5. 不得凭空添加未在本列表中列出的重要新角色
{{/chapterCharacters}}
{{#chapterEvents}}
## 本章事件
{{chapterEvents}}
{{/chapterEvents}}
{{#previousContext}}
## 前文上下文
{{previousContext}}
{{/previousContext}}
{{#outputProfile}}
【输出控制（必须遵守）】
{{outputProfile}}
{{/outputProfile}}
{{#userInstruction}}特别要求：{{userInstruction}}{{/userInstruction}}

请严格围绕大纲，直接输出小说正文，不要写"以下是正文"等引导语。不得凭空新增未列出的重要角色。
如果本章主角未加入出场角色，不要强行安排主角直接出场；如果主角已加入出场角色，必须写出主角的有效行动。
**涉及主角时必须严格使用主角姓名，不得改名。**
字数尽量接近目标字数 {{targetWordCount}} 字。`;

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

  // v1.0.43 调试日志：确认最终 prompt 包含关键内容
  if (typeof window !== 'undefined' && (window as any).__TAURI__) {
    console.info('[PromptOrchestrator] 最终 prompt 摘要:', {
      hasChapterOutline: systemPrompt.includes('章节大纲'),
      hasVolumeOutline: systemPrompt.includes('分卷大纲'),
      hasNovelOutline: systemPrompt.includes('作品总大纲'),
      hasChapterGoal: systemPrompt.includes('本章目标'),
      hasChapterCharacters: systemPrompt.includes('本章出场角色'),
      hasMustAppear: systemPrompt.includes('必须直接出场'),
      promptLength: systemPrompt.length,
    });
  }

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
