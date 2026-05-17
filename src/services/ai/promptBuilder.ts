/**
 * AI Novel Studio - 统一 Prompt 构建器 (v1.0.21)
 * 负责为所有 AI 任务类型构建提示词请求
 */
import type { AiGenerateRequest, AiChatMessage } from '../../types/ai';

// ==================== 类型定义 ====================

export interface ChapterGeneratePromptContext {
  novelTitle: string;
  novelGenre?: string;
  protagonist?: string;
  worldBackground?: string;
  ruleSystems?: string;
  specialAbility?: string;
  abilityLimits?: string;
  forbiddenBehaviors?: string;
  volumeTitle?: string;
  chapterTitle: string;
  chapterOutline?: string;
  chapterGoal?: string;
  targetWordCount: number;
  chapterCharacters?: string;
  chapterEvents?: string;
  styleProfile?: string;
  outputProfile?: string;
  previousContext?: string;
  userInstruction?: string;
}

export interface CharacterGeneratePromptContext {
  novelTitle: string;
  novelGenre?: string;
  protagonist?: string;
  worldBackground?: string;
  chapterTitle: string;
  chapterOutline?: string;
  existingCharacterNames: string[];
}

export interface EventSuggestPromptContext {
  novelTitle: string;
  novelGenre?: string;
  protagonist?: string;
  chapterTitle: string;
  chapterOutline?: string;
  volumeGoal?: string;
  previousContext?: string;
  existingEvents: string[];
  characterNames: string[];
}

export interface SettingExpandPromptContext {
  novelTitle: string;
  novelGenre?: string;
  worldBackground?: string;
  ruleSystems?: string;
  chapterTitle: string;
  chapterOutline?: string;
}

export interface QualityCheckPromptContext {
  novelTitle: string;
  chapterTitle: string;
  chapterOutline?: string;
  chapterGoal?: string;
  draftContent: string;
  specialAbility?: string;
  forbiddenBehaviors?: string;
}

export interface PolishPromptContext {
  novelTitle: string;
  chapterTitle: string;
  chapterOutline?: string;
  draftContent: string;
  polishMode: string;
  customInstruction?: string;
  styleProfile?: string;
}

// ==================== 提示词构建器 ====================

function systemPrompt(text: string): AiChatMessage {
  return { role: 'system', content: text };
}

function userPrompt(text: string): AiChatMessage {
  return { role: 'user', content: text };
}

/** 构建章节正文生成请求 */
export function buildChapterGeneratePrompt(ctx: ChapterGeneratePromptContext): AiGenerateRequest {
  const system = [
    '你是一位专业的小说作家，擅长创作引人入胜的长篇小说。',
    '',
    `作品：《${ctx.novelTitle}》`,
    ctx.novelGenre ? `题材：${ctx.novelGenre}` : '',
    ctx.protagonist ? `主角：${ctx.protagonist}` : '',
    '',
    `当前章节：${ctx.chapterTitle}`,
    ctx.volumeTitle ? `所属分卷：${ctx.volumeTitle}` : '',
    ctx.chapterOutline ? `章节大纲：${ctx.chapterOutline}` : '',
    ctx.chapterGoal ? `本章目标：${ctx.chapterGoal}` : '',
    `目标字数：约 ${ctx.targetWordCount} 字`,
    '',
    ctx.worldBackground ? `世界背景：${ctx.worldBackground}` : '',
    ctx.ruleSystems ? `规则体系：${ctx.ruleSystems}` : '',
    ctx.specialAbility ? `主角特殊能力：${ctx.specialAbility}` : '',
    ctx.abilityLimits ? `能力限制：${ctx.abilityLimits}` : '',
    ctx.forbiddenBehaviors ? `主角禁止行为：${ctx.forbiddenBehaviors}` : '',
    '',
    ctx.chapterCharacters ? `本章出场角色：\n${ctx.chapterCharacters}` : '',
    ctx.chapterEvents ? `本章关键事件：\n${ctx.chapterEvents}` : '',
    ctx.styleProfile ? `风格约束：\n${ctx.styleProfile}` : '',
    ctx.outputProfile ? `输出控制：\n${ctx.outputProfile}` : '',
    '',
    ctx.previousContext ? `前文上下文摘要：\n${ctx.previousContext}` : '',
    '',
    ctx.userInstruction ? `特别要求：${ctx.userInstruction}` : '',
    '',
    '请严格围绕大纲，直接输出小说正文。不要写"以下是正文"等引导语，只输出正文内容。',
  ].filter(Boolean).join('\n');

  return {
    messages: [systemPrompt(system), userPrompt(`请开始写《${ctx.chapterTitle}》的正文。`)],
    maxTokens: ctx.targetWordCount > 6000 ? 12000 : 8000,
  };
}

/** 构建角色生成请求 */
export function buildCharacterGeneratePrompt(ctx: CharacterGeneratePromptContext): AiGenerateRequest {
  const system = [
    '你是一位专业的小说创作顾问，擅长根据故事背景设计鲜活立体的角色。',
    '',
    `作品：《${ctx.novelTitle}》`,
    ctx.novelGenre ? `题材：${ctx.novelGenre}` : '',
    ctx.protagonist ? `主角：${ctx.protagonist}` : '',
    ctx.worldBackground ? `世界背景：${ctx.worldBackground}` : '',
    '',
    `当前章节：${ctx.chapterTitle}`,
    ctx.chapterOutline ? `章节大纲：${ctx.chapterOutline}` : '',
    '',
    ctx.existingCharacterNames.length > 0
      ? `已有角色：${ctx.existingCharacterNames.join('、')}`
      : '暂无已有角色',
    '',
    '请根据以上信息，推荐 3-6 个适合在本章出场的新角色候选。',
    '',
    '请严格按以下 JSON 格式返回，不要输出其他内容：',
    '```json',
    '{',
    '  "characters": [',
    '    {',
    '      "name": "角色名",',
    '      "roleType": "protagonist / supporting / antagonist / neutral",',
    '      "identity": "身份定位",',
    '      "faction": "所属阵营",',
    '      "relationToProtagonist": "与主角的关系",',
    '      "goal": "角色目标",',
    '      "personality": "性格描述",',
    '      "behaviorLimits": "行为限制",',
    '      "forbiddenBehaviors": "禁止行为",',
    '      "currentState": "当前状态",',
    '      "chapterFunction": "本章作用"',
    '    }',
    '  ]',
    '}',
    '```',
  ].filter(Boolean).join('\n');

  return { messages: [systemPrompt(system), userPrompt('请为本章推荐候选角色。')], maxTokens: 4000 };
}

/** 构建事件推荐请求 */
export function buildEventSuggestPrompt(ctx: EventSuggestPromptContext): AiGenerateRequest {
  const system = [
    '你是一位专业的小说剧情策划，擅长设计推动故事发展的关键事件。',
    '',
    `作品：《${ctx.novelTitle}》`,
    ctx.novelGenre ? `题材：${ctx.novelGenre}` : '',
    ctx.protagonist ? `主角：${ctx.protagonist}` : '',
    '',
    `当前章节：${ctx.chapterTitle}`,
    ctx.chapterOutline ? `章节大纲：${ctx.chapterOutline}` : '',
    ctx.volumeGoal ? `分卷目标：${ctx.volumeGoal}` : '',
    '',
    ctx.characterNames.length > 0 ? `出场角色：${ctx.characterNames.join('、')}` : '',
    ctx.existingEvents.length > 0 ? `已有事件：${ctx.existingEvents.join('、')}` : '',
    ctx.previousContext ? `前文摘要：${ctx.previousContext}` : '',
    '',
    '请推荐 3-8 个适合本章发生的关键事件候选。事件应基于分卷大纲、章节大纲、前文总结、当前角色状态和未回收伏笔。',
    '',
    '请严格按以下 JSON 格式返回，不要输出其他内容：',
    '```json',
    '{',
    '  "events": [',
    '    {',
    '      "title": "事件标题",',
    '      "type": "conflict / twist / reveal / battle / emotional",',
    '      "description": "事件说明",',
    '      "impact": "对后续剧情的影响",',
    '      "risk": "可能的风险",',
    '      "mustHappen": false',
    '    }',
    '  ]',
    '}',
    '```',
  ].filter(Boolean).join('\n');

  return { messages: [systemPrompt(system), userPrompt('请为本章推荐关键事件。')], maxTokens: 4000 };
}

/** 构建设定补充请求 */
export function buildSettingExpandPrompt(ctx: SettingExpandPromptContext): AiGenerateRequest {
  const system = [
    '你是一位世界观构建专家，擅长为小说补充和扩展设定细节。',
    '',
    `作品：《${ctx.novelTitle}》`,
    ctx.novelGenre ? `题材：${ctx.novelGenre}` : '',
    ctx.worldBackground ? `世界背景：${ctx.worldBackground}` : '',
    ctx.ruleSystems ? `规则体系：${ctx.ruleSystems}` : '',
    '',
    `当前章节：${ctx.chapterTitle}`,
    ctx.chapterOutline ? `章节大纲：${ctx.chapterOutline}` : '',
    '',
    '请根据以上信息，推荐本章可能涉及的设定补充项。',
    '',
    '请严格按以下 JSON 格式返回，不要输出其他内容：',
    '```json',
    '{',
    '  "settings": [',
    '    {',
    '      "name": "设定名称",',
    '      "category": "world_rules / faction / location / magic / technology / item",',
    '      "description": "设定说明",',
    '      "usageInChapter": "本章如何使用",',
    '      "risk": "可能造成的设定冲突"',
    '    }',
    '  ]',
    '}',
    '```',
  ].filter(Boolean).join('\n');

  return { messages: [systemPrompt(system), userPrompt('请为本章补充相关设定。')], maxTokens: 5000 };
}

/** 构建质量检查请求 */
export function buildQualityCheckPrompt(ctx: QualityCheckPromptContext): AiGenerateRequest {
  const system = [
    '你是一位专业的小说编辑和质量审查专家。请对以下章节正文进行全面检查。',
    '',
    `作品：《${ctx.novelTitle}》`,
    `章节：${ctx.chapterTitle}`,
    ctx.chapterOutline ? `章节大纲：${ctx.chapterOutline}` : '',
    ctx.chapterGoal ? `本章目标：${ctx.chapterGoal}` : '',
    ctx.specialAbility ? `主角能力：${ctx.specialAbility}` : '',
    ctx.forbiddenBehaviors ? `禁止行为：${ctx.forbiddenBehaviors}` : '',
    '',
    '请从以下维度检查：逻辑一致性、设定违背、角色行为一致性、前后文割裂、节奏问题、文风问题、语言问题。',
    '',
    '请严格按以下 JSON 格式返回检查结果，不要输出其他内容：',
    '```json',
    '{',
    '  "overallScore": 78,',
    '  "summary": "总体评价（一段话）",',
    '  "items": [',
    '    {',
    '      "issueType": "logic / setting_violation / character_behavior / continuity / pacing / style / language / other",',
    '      "severity": "critical / high / medium / low",',
    '      "title": "问题标题",',
    '      "description": "问题描述",',
    '      "evidence": "原文证据（可选）",',
    '      "suggestion": "修改建议"',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    '以下是本章正文：',
    '',
    ctx.draftContent.slice(0, 8000),
  ].filter(Boolean).join('\n');

  return { messages: [systemPrompt(system), userPrompt('请对以上正文进行质量检查。')], maxTokens: 6000 };
}

/** 构建润色请求 */
export function buildChapterPolishPrompt(ctx: PolishPromptContext): AiGenerateRequest {
  const modeMap: Record<string, string> = {
    keep_plot: '保持剧情不变，优化表达、增强可读性',
    enhance_description: '增强描写细节，丰富环境、动作和心理描写',
    reduce_redundancy: '精简冗余表达，删除废话，提升节奏',
    strengthen_conflict: '强化冲突描写，突出矛盾张力',
    adjust_pacing: '调整叙事节奏，使推进更加平滑自然',
    unify_style: '统一文风，保持前后语气一致',
    fix_language: '修正语言问题，包括病句、错别字、表达不当',
    custom: ctx.customInstruction || '按用户要求进行润色优化',
  };

  const system = [
    '你是一位资深小说文字编辑，擅长润色和优化小说正文。',
    '',
    `作品：《${ctx.novelTitle}》`,
    `章节：${ctx.chapterTitle}`,
    ctx.chapterOutline ? `章节大纲：${ctx.chapterOutline}` : '',
    '',
    `润色模式：${modeMap[ctx.polishMode] || ctx.polishMode}`,
    ctx.customInstruction ? `自定义要求：${ctx.customInstruction}` : '',
    ctx.styleProfile ? `风格约束：${ctx.styleProfile}` : '',
    '',
    '要求：',
    '1. 保持核心剧情、人物关系和关键事件不变。',
    '2. 可以优化用词、句式、段落结构。',
    '3. 不得改变故事走向和角色立场。',
    '',
    '请直接输出润色后的完整正文，不要写说明性文字。',
    '',
    '以下是原文：',
    '',
    ctx.draftContent.slice(0, 8000),
  ].filter(Boolean).join('\n');

  return { messages: [systemPrompt(system), userPrompt('请对以上正文进行润色。')], maxTokens: 8000 };
}

/** 构建连接测试请求 */
export function buildConnectionTestPrompt(): AiGenerateRequest {
  return {
    messages: [
      systemPrompt('You are an AI assistant. Reply with "OK" only.'),
      userPrompt('hi'),
    ],
    maxTokens: 50,
  };
}
