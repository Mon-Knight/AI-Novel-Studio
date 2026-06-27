/**
 * AI Novel Studio - 提示词调度中心
 * 负责将上下文组装为 AI 请求
 */
import chapterGenerateTemplate from '../../../prompts/chapter_generate.md?raw';
import type { AiGenerateRequest, ChapterPromptDebugInfo } from '../../types/ai';
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

function containsInsertedText(prompt: string, source?: string): boolean {
  const text = source?.trim();
  if (!text) return false;
  const probe = text.length > 120 ? text.slice(0, 120) : text;
  return prompt.includes(probe);
}

function buildPromptDebug(
  systemPrompt: string,
  context: ChapterGenerationContext,
  templateSource: ChapterPromptDebugInfo['templateSource'],
): ChapterPromptDebugInfo {
  const requiredCharacterNames = context.requiredCharacters?.map((item) => item.name).filter(Boolean) ?? [];
  return {
    templateSource,
    hasChapterOutlineBlock: systemPrompt.includes('【当前章节大纲】'),
    hasOutlineChecklistBlock: systemPrompt.includes('【章节大纲执行清单】'),
    hasVolumeOutlineBlock: systemPrompt.includes('【当前采用分卷大纲】'),
    hasMasterOutlineBlock: systemPrompt.includes('【当前采用总纲】'),
    hasChapterGoalBlock: systemPrompt.includes('【本章目标】'),
    hasChapterCharactersBlock: systemPrompt.includes('【本章出场角色】'),
    hasRequiredCharactersBlock: systemPrompt.includes('【本章必须直接出场角色】'),
    includesChapterOutlineText: containsInsertedText(systemPrompt, context.chapterOutline),
    includesOutlineChecklistText: containsInsertedText(systemPrompt, context.outlineChecklistText),
    includesVolumeOutlineText: containsInsertedText(systemPrompt, context.volumeOutline),
    includesMasterOutlineText: containsInsertedText(systemPrompt, context.masterOutline || context.novelOutline),
    outlineKeyPointCount: context.outlineKeyPoints?.length || 0,
    requiredCharactersCount: requiredCharacterNames.length,
    requiredCharacterNames,
    promptLength: systemPrompt.length,
  };
}

function buildUserGenerationPrompt(context: ChapterGenerationContext): string {
  const parts = [
    `请开始写《${context.chapterTitle}》的正文。`,
    '',
    '以下约束是本次生成最后确认的执行摘要，必须落实到正文中：',
    '',
    '【当前章节大纲】',
    context.chapterOutline?.trim() || '（空）',
    '',
    '【章节大纲执行清单】',
    context.outlineChecklistText?.trim() || context.chapterOutline?.trim() || '（空）',
    '',
    '【本章必须直接出场角色】',
    context.requiredCharactersSummary?.trim() || context.requiredCharacterNames || '无',
    '',
    '请直接输出小说正文，不要输出说明、分析或 Markdown 标记。',
  ];

  return parts.join('\n');
}

// 默认章节生成模板（兜底）
const DEFAULT_TEMPLATE = `你是一位专业的小说作家。你必须严格根据已确认的大纲、设定、角色、事件和风格生成章节正文，不得脱离规划另起剧情。

【优先级】
用户本次额外要求 > 本章目标 > 当前章节大纲 > 当前采用分卷大纲 > 当前采用总纲 > 世界背景 / 主角 / 角色 / 风格方案。

{{#protagonist_names}}
【硬性角色约束（最高优先级）】
本作品主角固定为：{{protagonist_names}}。
严禁将主角名字改为任何其他名字。
严禁新增替代主角或使用其他姓名替代主角。
如果需要称呼主角，只能使用以上列出的名字及其自然代词。
{{/protagonist_names}}

【作品信息】
作品：{{novelTitle}}
题材：{{novelGenre}}
{{#novelDescription}}简介：{{novelDescription}}{{/novelDescription}}
主角：{{protagonist}}

{{#masterOutline}}
【当前采用总纲】
{{masterOutline}}
{{/masterOutline}}

分卷：{{volumeTitle}}
{{#volumeOutline}}
【当前采用分卷大纲】
{{volumeOutline}}
{{/volumeOutline}}

章节：{{chapterTitle}}
{{#chapterGoal}}
【本章目标】
{{chapterGoal}}
{{/chapterGoal}}
{{^chapterGoal}}
【本章目标】
未单独设置本章目标，请根据当前章节大纲、当前采用分卷大纲和当前采用总纲自然推进。
{{/chapterGoal}}

{{#chapterOutline}}
【当前章节大纲】
{{chapterOutline}}
{{/chapterOutline}}
{{^chapterOutline}}
【当前章节大纲】
（空）
当前章节大纲为空，建议先生成或填写章节大纲。本次生成必须降级参考本章目标、当前采用分卷大纲和当前采用总纲。
{{/chapterOutline}}

{{#outlineChecklistText}}
【章节大纲执行清单】
以下是本章必须执行的剧情清单。正文必须逐项覆盖，不得跳过：
{{outlineChecklistText}}
{{/outlineChecklistText}}

【大纲执行硬性要求】
1. 正文必须围绕【章节大纲执行清单】展开。
2. 清单中的每一项必须在正文中有对应剧情。
3. 不允许只写氛围、日常或闲聊而跳过关键事件。
4. 不允许另起一条与大纲无关的新剧情。
5. 如果因篇幅无法完全展开，也必须至少覆盖每个关键点的核心动作。
6. 结尾必须服务于章节大纲中的结尾安排或下一章钩子。
7. 如果当前章节大纲为空，必须优先依据【本章目标】、【当前采用分卷大纲】和【当前采用总纲】推进。
8. 如用户额外要求与大纲冲突，以用户额外要求为最高优先级，但不得完全抛弃大纲主线。

目标字数：约 {{targetWordCount}} 字

{{#worldBackground}}【世界背景】
{{worldBackground}}
{{/worldBackground}}
{{#ruleSystems}}【规则体系】
{{ruleSystems}}
{{/ruleSystems}}

{{#protagonistsSummary}}
【主角详细设定】
{{protagonistsSummary}}
{{/protagonistsSummary}}
{{#protagonistAppearance}}
【主角本章出场状态】
{{protagonistAppearance}}
{{/protagonistAppearance}}
{{#dualProtagonistSummary}}
【双主角关系】
{{dualProtagonistSummary}}
{{/dualProtagonistSummary}}
{{#styleProfile}}
【写作风格约束（必须遵守）】
{{styleProfile}}
{{/styleProfile}}
{{#chapterSettings}}
【本章可用设定】
{{chapterSettings}}
{{/chapterSettings}}

{{#chapterCharacters}}
【本章出场角色】
{{chapterCharacters}}
{{/chapterCharacters}}

{{#requiredCharactersSummary}}
【本章必须直接出场角色】
{{requiredCharactersSummary}}

【强制要求】
正文中必须出现这些角色姓名。
每个角色至少有行动、对话、心理活动、冲突参与中的一种。
不能只在设定说明、旁白总结或备注中提到。
不能完全忽略本章出场角色。
{{/requiredCharactersSummary}}

{{#chapterEvents}}
【本章必须发生的事件】
{{chapterEvents}}
{{/chapterEvents}}
{{#previousContext}}
【前文上下文摘要】
{{previousContext}}
{{/previousContext}}
{{#outputProfile}}
【输出控制（必须遵守）】
{{outputProfile}}
{{/outputProfile}}
{{#userInstruction}}
【本章特别要求】
{{userInstruction}}
{{/userInstruction}}{{#draftContent}}
【当前草稿正文（请基于此改写）】
以下是当前章节的草稿正文。请在此基础之上进行改写、优化或重写：
{{draftContent}}
改写要求：保持核心剧情、人物关系和关键事件不变，但可以根据大纲和设定优化、扩展或删减，修复逻辑问题、角色行为不一致和设定违背。
{{/draftContent}}
请直接输出小说正文，不要写“以下是正文”等引导语，不要输出 Markdown 标记。字数尽量接近目标字数 {{targetWordCount}} 字。`;

export async function buildGenerateRequest(
  context: ChapterGenerationContext,
): Promise<AiGenerateRequest> {
  const template = chapterGenerateTemplate?.trim() ? chapterGenerateTemplate : DEFAULT_TEMPLATE;
  const templateSource: ChapterPromptDebugInfo['templateSource'] = chapterGenerateTemplate?.trim()
    ? 'chapter_generate.md'
    : 'DEFAULT_TEMPLATE';

  const ctx: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(context)) {
    ctx[k] = v != null ? String(v) : undefined;
    // 同时提供 snake_case 键以兼容模板
    const snakeKey = k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
    if (snakeKey !== k) ctx[snakeKey] = v != null ? String(v) : undefined;
  }
  ctx.outline_checklist = context.outlineChecklistText || context.chapterOutline;

  const systemPrompt = renderTemplate(template, ctx);
  const userPromptContent = buildUserGenerationPrompt(context);
  const promptDebug = buildPromptDebug(`${systemPrompt}\n${userPromptContent}`, context, templateSource);

  // 开发态只输出摘要，不输出完整 prompt 或 API Key。
  if (import.meta.env.DEV) {
    console.info(`[ChapterGenerate] final prompt includes chapterOutline=${promptDebug.includesChapterOutlineText} length=${context.chapterOutline?.length || 0}`);
    console.info(`[ChapterGenerate] final prompt includes outlineChecklist=${promptDebug.includesOutlineChecklistText} count=${promptDebug.outlineKeyPointCount}`);
    console.info(`[ChapterGenerate] final prompt includes volumeOutline=${promptDebug.includesVolumeOutlineText} length=${context.volumeOutline?.length || 0}`);
    console.info(`[ChapterGenerate] final prompt includes masterOutline=${promptDebug.includesMasterOutlineText} length=${(context.masterOutline || context.novelOutline)?.length || 0}`);
    console.info(`[ChapterGenerate] final prompt includes requiredCharacters=${promptDebug.requiredCharactersCount} names=${promptDebug.requiredCharacterNames.join(',') || '(none)'}`);
    console.info(`[ChapterGenerate] final prompt length=${promptDebug.promptLength} templateSource=${promptDebug.templateSource}`);
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
        content: userPromptContent,
      },
    ],
    promptTemplateSource: templateSource,
    promptDebug,
  };
}
