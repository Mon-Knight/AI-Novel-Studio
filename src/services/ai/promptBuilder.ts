/**
 * AI Novel Studio - 统一 Prompt 构建器 (v1.0.21)
 * 负责为所有 AI 任务类型构建提示词请求
 */
import type { AiGenerateRequest, AiChatMessage } from '../../types/ai';
import { CONNECTION_TEST_MAX_OUTPUT_TOKENS } from './providerRequestPolicy';

// ==================== 类型定义 ====================

export interface ChapterGeneratePromptContext {
  novelTitle: string;
  novelGenre?: string;
  novelDescription?: string;
  novelOutline?: string;
  masterOutline?: string;
  protagonist?: string;
  protagonistMode?: string;
  protagonistsSummary?: string;
  dualProtagonistSummary?: string;
  worldBackground?: string;
  ruleSystems?: string;
  specialAbility?: string;
  abilityLimits?: string;
  forbiddenBehaviors?: string;
  volumeTitle?: string;
  volumeOutline?: string;
  volumeGoal?: string;
  volumeConflict?: string;
  chapterTitle: string;
  chapterOutline?: string;
  outlineChecklistText?: string;
  chapterGoal?: string;
  targetWordCount: number;
  chapterCharacters?: string;
  requiredCharactersSummary?: string;
  requiredCharacterNames?: string;
  chapterEvents?: string;
  chapterSettings?: string;
  styleProfile?: string;
  outputProfile?: string;
  previousContext?: string;
  userInstruction?: string;
  /** 当前草稿正文（重新生成/改写模式时传入） */
  draftContent?: string;
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
  contentHash?: string;
  wordCount?: number;
  specialAbility?: string;
  forbiddenBehaviors?: string;
  /** v1.7.15 上下文注入 */
  contextSummary?: string;
  segment?: {
    index: number;
    total: number;
    startOffset: number;
    paragraphStart: number;
    previousContext: string;
    nextContext: string;
  };
}

export interface PolishPromptContext {
  novelTitle: string;
  chapterTitle: string;
  chapterOutline?: string;
  draftContent: string;
  polishMode: string;
  customInstruction?: string;
  styleProfile?: string;
  segment?: {
    index: number;
    total: number;
    previousContext: string;
    nextContext: string;
  };
}

export interface ChapterSummarizePromptContext {
  novelTitle?: string;
  chapterTitle: string;
  chapterOutline?: string;
  adoptedContent: string;
  chapterCharacters?: string;
  chapterEvents?: string;
  segment?: {
    index: number;
    total: number;
    previousContext: string;
    nextContext: string;
  };
}

export interface ChapterSummarizeReducePromptContext {
  novelTitle?: string;
  chapterTitle: string;
  chapterOutline?: string;
  sourceSegmentCount: number;
  reductionPass: number;
  groupIndex: number;
  groupTotal: number;
  partialSummaries: readonly unknown[];
}

export interface OutlineGeneratePromptContext {
  novelTitle: string;
  novelGenre?: string;
  description?: string;
  worldBackground?: string;
  ruleSystems?: string;
  protagonist?: string;
  specialAbility?: string;
  existingVolumes?: string;
  existingChapters?: string;
  activeMasterOutline?: string;
  styleSummary?: string;
}

export interface VolumeOutlineGeneratePromptContext extends OutlineGeneratePromptContext {
  volumeTitle?: string;
}

export interface ChapterOutlineGeneratePromptContext extends OutlineGeneratePromptContext {
  volumeTitle?: string;
  volumeSummary?: string;
  currentChapterTitle?: string;
  currentChapterGoal?: string;
  chapterCount?: number;
  activeVolumeOutline?: string;
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
    '你是一位专业的小说作家，擅长创作引人入胜的长篇小说。你必须严格根据已确认的大纲、设定、角色、事件和风格来生成章节正文。',
    '',
    // v1.0.36: 硬性角色约束放在最前面
    ctx.protagonistsSummary
      ? [
          '【硬性角色约束（最高优先级）】',
          '必须严格按照以下主角设定写作，严禁改变主角姓名：',
          ctx.protagonistsSummary,
          '',
          '严禁将主角名字改为任何其他名字。如果需要称呼主角，只能使用以上列出的名字及自然代词。',
          '',
        ].join('\n')
      : '',
    `作品：《${ctx.novelTitle}》`,
    ctx.novelGenre ? `题材：${ctx.novelGenre}` : '',
    ctx.novelDescription ? `作品简介：${ctx.novelDescription}` : '',
    ctx.protagonist ? `主角：${ctx.protagonist}` : '',
    ctx.protagonistMode ? `主角模式：${ctx.protagonistMode}` : '',
    '',
    // v1.0.36: 风格方案提前，并加"必须遵守"
    ctx.styleProfile
      ? [
          '【写作风格约束（必须遵守）】',
          ctx.styleProfile,
          '',
          '你必须严格按照以上风格生成本章正文，不要使用默认网文模板。',
          '',
        ].join('\n')
      : '',
    ctx.dualProtagonistSummary ? `## 双主角关系\n${ctx.dualProtagonistSummary}\n` : '',
    '',
    ctx.masterOutline || ctx.novelOutline
      ? `【当前采用总纲】\n${ctx.masterOutline || ctx.novelOutline}\n`
      : '',
    '',
    ctx.volumeTitle ? `分卷：${ctx.volumeTitle}` : '',
    ctx.volumeOutline ? `【当前采用分卷大纲】\n${ctx.volumeOutline}` : '',
    ctx.volumeGoal ? `分卷目标：${ctx.volumeGoal}` : '',
    ctx.volumeConflict ? `分卷冲突：${ctx.volumeConflict}` : '',
    '',
    `当前章节：${ctx.chapterTitle}`,
    ctx.chapterOutline
      ? `【当前章节大纲】\n${ctx.chapterOutline}`
      : '【当前章节大纲】\n（空）\n当前章节大纲为空，建议先生成或填写章节大纲。本次生成必须降级参考本章目标、当前采用分卷大纲和当前采用总纲。',
    ctx.outlineChecklistText
      ? [
          '【章节大纲执行清单】',
          '以下是本章必须执行的剧情清单。正文必须逐项覆盖，不得跳过：',
          ctx.outlineChecklistText,
          '',
          '【大纲执行硬性规则】',
          '1. 正文必须围绕“章节大纲执行清单”展开。',
          '2. 清单中的每一项必须在正文中有对应剧情。',
          '3. 不允许只写氛围、日常或闲聊而跳过关键事件。',
          '4. 不允许另起一条与大纲无关的新剧情。',
          '5. 如果因篇幅无法完全展开，也必须至少覆盖每个关键点的核心动作。',
          '6. 结尾必须服务于章节大纲中的结尾安排或下一章钩子。',
        ].join('\n')
      : '',
    ctx.chapterGoal ? `本章目标：${ctx.chapterGoal}` : '',
    `目标字数：约 ${ctx.targetWordCount} 字`,
    '',
    ctx.worldBackground ? `世界背景：${ctx.worldBackground}` : '',
    ctx.ruleSystems ? `规则体系：${ctx.ruleSystems}` : '',
    ctx.specialAbility ? `主角特殊能力：${ctx.specialAbility}` : '',
    ctx.abilityLimits ? `能力限制：${ctx.abilityLimits}` : '',
    ctx.forbiddenBehaviors ? `主角禁止行为：${ctx.forbiddenBehaviors}` : '',
    '',
    ctx.chapterSettings ? `## 本章可用设定\n${ctx.chapterSettings}\n` : '',
    '',
    ctx.chapterCharacters ? ['【本章出场角色】', ctx.chapterCharacters].join('\n') : '',
    ctx.requiredCharactersSummary
      ? [
          '【本章必须直接出场角色】',
          ctx.requiredCharactersSummary,
          '',
          '【角色出场硬性要求】',
          '- 正文中必须出现这些角色姓名',
          '- 每个角色至少需要行动、对话、心理活动、冲突参与中的一种',
          '- 不能只在设定说明、旁白总结或章节备注中提到',
          '- 不能完全忽略本章出场角色',
        ].join('\n')
      : '',
    ctx.chapterEvents ? `## 本章关键事件\n${ctx.chapterEvents}` : '',
    '',
    ctx.previousContext ? `## 前文上下文摘要\n${ctx.previousContext}` : '',
    '',
    // v1.0.36: 输出控制加"必须遵守"
    ctx.outputProfile ? ['【输出控制（必须遵守）】', ctx.outputProfile, ''].join('\n') : '',
    ctx.userInstruction ? `特别要求：${ctx.userInstruction}` : '',
    '',
    ctx.draftContent
      ? [
          '【当前草稿正文（请基于此改写）】',
          '以下是当前章节的草稿正文。请在此基础之上进行改写、优化或重写：',
          '',
          ctx.draftContent,
          '',
          '改写要求：',
          '- 保持核心剧情、人物关系和关键事件不变',
          '- 可以根据大纲和设定进行优化、扩展或删减',
          '- 修复逻辑问题、角色行为不一致和设定违背',
          '- 补充大纲中要求的但当前草稿缺失的内容',
        ].join('\n')
      : '',
    '',
    '正文必须优先执行【当前章节大纲】和【章节大纲执行清单】；章节大纲中的关键事件、冲突推进和结尾安排必须保留。',
    '如用户额外要求与大纲冲突，以用户额外要求为最高优先级，但不得完全抛弃大纲主线。',
    '请严格围绕大纲，直接输出小说正文。不要写"以下是正文"等引导语，只输出正文内容。',
    '不得凭空添加未在出场角色列表中列出的重要角色。',
    '**必须严格使用主角姓名，不得改名。**',
    `字数尽量接近目标字数 ${ctx.targetWordCount} 字。`,
    '如果章节大纲中描述了具体场景或道具，必须如实写入正文。',
    ...(ctx.protagonistMode === 'dual'
      ? [
          '',
          '## 双主角写作约束：',
          '- 必须同时考虑两位主角的目标和限制，不能忽略第二主角',
          '- 不要把第二主角写成普通配角或路人',
          '- 如果本章涉及双主角关系线，应推进关系冲突或合作',
          '- 不得违背任一主角的特殊能力限制和行为禁令',
        ]
      : []),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    taskType: 'chapter_generate',
    messages: [systemPrompt(system), userPrompt(`请开始写《${ctx.chapterTitle}》的正文。`)],
    maxTokens: ctx.targetWordCount > 6000 ? 12000 : 8000,
  };
}

/** 构建角色生成请求 */
export function buildCharacterGeneratePrompt(
  ctx: CharacterGeneratePromptContext,
): AiGenerateRequest {
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
  ]
    .filter(Boolean)
    .join('\n');

  return {
    taskType: 'character_generate',
    messages: [systemPrompt(system), userPrompt('请为本章推荐候选角色。')],
    maxTokens: 4000,
  };
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
  ]
    .filter(Boolean)
    .join('\n');

  return {
    taskType: 'event_suggest',
    messages: [systemPrompt(system), userPrompt('请为本章推荐关键事件。')],
    maxTokens: 4000,
  };
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
  ]
    .filter(Boolean)
    .join('\n');

  return {
    taskType: 'setting_expand',
    messages: [systemPrompt(system), userPrompt('请为本章补充相关设定。')],
    maxTokens: 5000,
  };
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
    ctx.contextSummary ? ctx.contextSummary : '',
    '',
    '【检查范围硬性规则】',
    '只分析用户当前提供的正文快照，不得虚构未出现的后续剧情，不得分析与当前正文无关的内容。',
    '如果正文信息不足以判断某类问题，请说明“当前正文信息不足”，不要补写无关内容。',
    '所有 evidence、quote、startOffset、endOffset 或 paragraphIndex 都必须来自下方正文。',
    ctx.contentHash ? `正文快照 Hash：${ctx.contentHash}` : '',
    typeof ctx.wordCount === 'number' ? `正文快照字数：${ctx.wordCount}` : '',
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
    '      "suggestion": "修改建议",',
    '      "quote": "与问题直接相关的原文片段（可选）",',
    '      "startOffset": 0,',
    '      "endOffset": 12,',
    '      "paragraphIndex": 0',
    '    }',
    '  ]',
    '}',
    '```',
    '',
    ctx.segment
      ? `以下是本章第 ${ctx.segment.index + 1}/${ctx.segment.total} 段；问题位置必须相对本段返回，系统会换算到全文。`
      : '以下是本章正文：',
    ctx.segment?.previousContext
      ? `前段衔接（仅供判断，不属于检查正文）：\n${ctx.segment.previousContext}`
      : '',
    ctx.segment?.nextContext
      ? `后段衔接（仅供判断，不属于检查正文）：\n${ctx.segment.nextContext}`
      : '',
    '',
    ctx.draftContent,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    taskType: 'quality_check',
    messages: [systemPrompt(system), userPrompt('请对以上正文进行质量检查。')],
    maxTokens: 6000,
  };
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
    ctx.segment
      ? `当前处理第 ${ctx.segment.index + 1}/${ctx.segment.total} 段。只输出当前段的润色结果，不要重复前后衔接文本。`
      : '请直接输出润色后的完整正文，不要写说明性文字。',
    ctx.segment?.previousContext
      ? `前段衔接（只参考，不输出）：\n${ctx.segment.previousContext}`
      : '',
    ctx.segment?.nextContext ? `后段衔接（只参考，不输出）：\n${ctx.segment.nextContext}` : '',
    '',
    '以下是原文：',
    '',
    ctx.draftContent,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    taskType: 'chapter_polish',
    messages: [systemPrompt(system), userPrompt('请对以上正文进行润色。')],
    maxTokens: 8000,
  };
}

function chapterSummarizeJsonContract(): string[] {
  return [
    '请严格返回 JSON，不要输出解释文字：',
    '```json',
    '{',
    '  "summaryTitle": "本章上下文标题",',
    '  "summary": "本章摘要，一段话",',
    '  "keyEvents": ["关键事件1", "关键事件2"],',
    '  "coreEvents": ["改变后续剧情状态的核心事件"],',
    '  "protagonistStateChange": "主角相对上一章的实际变化",',
    '  "importantCharacterChanges": [{ "name": "角色名", "change": "本章确认发生的变化" }],',
    '  "characterChanges": [',
    '    { "characterName": "角色名", "stateSummary": "状态变化", "relationshipChanges": "关系变化", "goalChanges": "目标变化", "location": "位置", "healthState": "健康状态", "knowledgeState": "掌握的信息" }',
    '  ],',
    '  "relationshipChanges": [',
    '    { "fromCharacterName": "角色A", "toCharacterName": "角色B", "change": "关系变化" }',
    '  ],',
    '  "settingChanges": ["本章确认新增或改变的世界规则与势力事实"],',
    '  "newLocations": ["正文中首次实际出现的新地点"],',
    '  "newItemsOrAbilities": ["正文中首次实际出现的新物品或能力"],',
    '  "newForeshadows": ["新伏笔"],',
    '  "resolvedForeshadows": ["已回收伏笔"],',
    '  "foreshadowing": ["仍在生效的伏笔"],',
    '  "unresolvedQuestions": ["正文尚未回答的问题"],',
    '  "factsMustRemember": ["后续写作不得违背的已确认事实"],',
    '  "nextChapterHints": "下一章承接建议",',
    '  "nextChapterHook": "正文结尾形成的具体钩子",',
    '  "contextRecords": [',
    '    { "contextType": "chapter_summary", "title": "记录标题", "content": "需要长期记住的内容", "importance": 4 }',
    '  ]',
    '}',
    '```',
    '只能记录正文中已经发生或明确出现的内容；不得把大纲计划、推测或下一章建议写成既成事实。',
    '没有对应变化时返回空数组或空字符串，不得为了填满字段而编造。',
  ];
}

/** 构建章节总结请求 */
export function buildChapterSummarizePrompt(ctx: ChapterSummarizePromptContext): AiGenerateRequest {
  const system = [
    '你是长篇小说上下文整理助手。请从已采用的章节正文中提炼后续创作必须记住的信息。',
    '',
    ctx.novelTitle ? `作品：${ctx.novelTitle}` : '',
    `章节：${ctx.chapterTitle}`,
    ctx.chapterOutline ? `章节大纲：${ctx.chapterOutline}` : '',
    ctx.chapterCharacters ? `本章角色：\n${ctx.chapterCharacters}` : '',
    ctx.chapterEvents ? `本章事件：\n${ctx.chapterEvents}` : '',
    ctx.segment
      ? `当前处理原章第 ${ctx.segment.index + 1}/${ctx.segment.total} 个连续分段；必须覆盖当前段开头、中部和结尾。`
      : '',
    ctx.segment
      ? '这里只生成分段事实摘要，最终会按原文顺序归并；不要把前后衔接参考重复记为当前段事实。'
      : '',
    ctx.segment?.previousContext
      ? `前段衔接（仅供判断，不属于当前待总结正文）：\n${ctx.segment.previousContext}`
      : '',
    ctx.segment?.nextContext
      ? `后段衔接（仅供判断，不属于当前待总结正文）：\n${ctx.segment.nextContext}`
      : '',
    '',
    ...chapterSummarizeJsonContract(),
    '',
    ctx.segment ? '当前连续分段正文：' : '已采用正文：',
    ctx.adoptedContent,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    taskType: 'context_summarize',
    messages: [systemPrompt(system), userPrompt('请总结本章上下文。')],
    maxTokens: 5000,
  };
}

/** 将按原文顺序生成的分段总结归并为一个完整章节上下文。 */
export function buildChapterSummarizeReducePrompt(
  ctx: ChapterSummarizeReducePromptContext,
): AiGenerateRequest {
  const system = [
    '你是长篇小说上下文归并助手。请把按原文顺序排列的分段总结合并为一个完整章节上下文。',
    '必须保留各分段中互不重复的事件、人物变化、设定、伏笔和长期事实，不得只保留首段或末段。',
    '相同事实只保留一次；发生演进时按先后关系归纳，最终状态以较后分段为准。',
    '下一章承接建议和章节结尾钩子以最后一个原文分段为准。',
    '',
    ctx.novelTitle ? `作品：${ctx.novelTitle}` : '',
    `章节：${ctx.chapterTitle}`,
    ctx.chapterOutline ? `章节大纲（只用于核对，不得写成既成事实）：${ctx.chapterOutline}` : '',
    `原章共 ${ctx.sourceSegmentCount} 个连续分段。当前为第 ${ctx.reductionPass} 轮归并，第 ${ctx.groupIndex + 1}/${ctx.groupTotal} 组。`,
    '',
    ...chapterSummarizeJsonContract(),
    '',
    '【按原文顺序排列的分段总结 JSON】',
    JSON.stringify(ctx.partialSummaries, null, 2),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    taskType: 'context_summarize',
    messages: [systemPrompt(system), userPrompt('请归并以上分段总结。')],
    maxTokens: 5000,
  };
}

/** 构建作品总大纲请求 */
export function buildOutlineGeneratePrompt(ctx: OutlineGeneratePromptContext): AiGenerateRequest {
  const system = [
    '你是长篇小说大纲策划。请基于作品基础信息生成可执行的作品总大纲。',
    `作品：${ctx.novelTitle}`,
    ctx.novelGenre ? `题材：${ctx.novelGenre}` : '',
    ctx.description ? `简介：${ctx.description}` : '',
    ctx.worldBackground ? `世界背景：${ctx.worldBackground}` : '',
    ctx.ruleSystems ? `规则体系：${ctx.ruleSystems}` : '',
    ctx.protagonist ? `主角：${ctx.protagonist}` : '',
    ctx.specialAbility ? `主角特殊能力：${ctx.specialAbility}` : '',
    ctx.existingVolumes ? `已有分卷：\n${ctx.existingVolumes}` : '',
    ctx.existingChapters ? `已有章节：\n${ctx.existingChapters}` : '',
    '',
    '请返回完整作品总大纲，包含主线、阶段目标、主要冲突、分卷规划和章节方向。可以使用 Markdown，但不要写无关说明。',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    taskType: 'outline_generate',
    messages: [systemPrompt(system), userPrompt('请生成作品总大纲。')],
    maxTokens: 8000,
  };
}

/** 构建分卷大纲请求 */
export function buildVolumeOutlineGeneratePrompt(
  ctx: VolumeOutlineGeneratePromptContext,
): AiGenerateRequest {
  const system = [
    '你是长篇小说分卷策划。请严格基于当前作品总纲生成一个分卷大纲，要求能直接保存到分卷摘要、目标和主冲突中。',
    `作品：${ctx.novelTitle}`,
    ctx.novelGenre ? `题材：${ctx.novelGenre}` : '',
    ctx.description ? `简介：${ctx.description}` : '',
    ctx.worldBackground ? `世界背景：${ctx.worldBackground}` : '',
    ctx.protagonist ? `主角：${ctx.protagonist}` : '',
    ctx.specialAbility ? `主角特殊能力：${ctx.specialAbility}` : '',
    ctx.volumeTitle ? `目标分卷：${ctx.volumeTitle}` : '',
    ctx.existingVolumes ? `已有分卷：\n${ctx.existingVolumes}` : '',
    ctx.existingChapters ? `已有章节：\n${ctx.existingChapters}` : '',
    ctx.styleSummary ? `风格方案：\n${ctx.styleSummary}` : '',
    ctx.activeMasterOutline
      ? [
          '',
          '【当前采用总纲】',
          '请严格基于以下总纲生成当前分卷大纲：',
          ctx.activeMasterOutline.slice(0, 4000),
          '',
          '要求：',
          '1. 本分卷必须服务于总纲中的主线推进、人物成长和阶段冲突',
          '2. 不得生成与总纲主线冲突的分卷方向',
          '3. 需明确本卷在总纲中的位置和承接关系',
        ].join('\n')
      : [
          '',
          '⚠️ 当前作品尚未设置采用总纲',
          '请根据作品背景、世界设定和已有分卷信息，为当前分卷规划合理的发展方向。',
          '建议用户先生成并采用总纲后再生成分卷大纲，可以提高连贯性。',
        ].join('\n'),
    '',
    '请严格返回 JSON，不要输出解释文字：',
    '```json',
    '{ "title": "分卷标题", "summary": "分卷摘要（详细描述本卷从开始到结束的完整故事线）", "goal": "分卷目标（本卷要达成的核心目标）", "mainConflict": "主要冲突（本卷的核心矛盾）" }',
    '```',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    taskType: 'volume_outline_generate',
    messages: [systemPrompt(system), userPrompt('请生成分卷大纲。')],
    maxTokens: 4000,
  };
}

/** 构建章节大纲请求 */
export function buildChapterOutlineGeneratePrompt(
  ctx: ChapterOutlineGeneratePromptContext,
): AiGenerateRequest {
  const system = [
    '你是长篇小说章节大纲策划。请严格基于当前分卷大纲和总纲，为当前分卷生成多个可执行章节大纲。',
    `作品：${ctx.novelTitle}`,
    ctx.novelGenre ? `题材：${ctx.novelGenre}` : '',
    '',
    // v1.0.35: 总纲优先
    ctx.activeMasterOutline
      ? ['【当前采用总纲】', ctx.activeMasterOutline.slice(0, 3000), ''].join('\n')
      : '⚠️ 当前作品尚未设置采用总纲，章节大纲可能与主线脱节。',
    '',
    // v1.0.35: 分卷大纲其次
    ctx.activeVolumeOutline
      ? [
          '【当前采用分卷大纲】',
          ctx.activeVolumeOutline.slice(0, 3000),
          '',
          '请严格基于上述分卷大纲生成本章大纲。',
          '本章必须服务于当前分卷的核心冲突、事件链和阶段目标，不得脱离分卷大纲另开新线。',
        ].join('\n')
      : ctx.volumeSummary
        ? [
            '【分卷摘要（降级使用）】',
            ctx.volumeSummary.slice(0, 2000),
            '',
            '⚠️ 当前分卷尚未设置采用分卷大纲，使用分卷摘要替代。',
            '建议先完善分卷大纲后再生成章节大纲。',
          ].join('\n')
        : [
            '⚠️ 当前分卷尚未设置采用分卷大纲，也没有分卷摘要。',
            '请尽量结合总纲和作品背景生成合理章节大纲。',
          ].join('\n'),
    '',
    ctx.description ? `简介：${ctx.description}` : '',
    ctx.worldBackground ? `世界背景：${ctx.worldBackground}` : '',
    ctx.protagonist ? `主角：${ctx.protagonist}` : '',
    ctx.specialAbility ? `主角特殊能力：${ctx.specialAbility}` : '',
    ctx.volumeTitle ? `分卷：${ctx.volumeTitle}` : '',
    ctx.currentChapterTitle ? `当前章节：${ctx.currentChapterTitle}` : '',
    ctx.currentChapterGoal
      ? [
          '【用户设定的本章目标】',
          ctx.currentChapterGoal,
          '章节大纲必须围绕该目标设计；如果该目标与上级大纲存在细节冲突，以用户最新设置的本章目标为优先，同时保持主线连贯。',
        ].join('\n')
      : '',
    ctx.existingChapters ? `已有章节：\n${ctx.existingChapters}` : '',
    ctx.styleSummary ? `风格方案：\n${ctx.styleSummary}` : '',
    '',
    `请生成 ${ctx.chapterCount || 6} 个章节候选。`,
    '输出时请体现：',
    '1. 本章在分卷中的作用',
    '2. 本章推进分卷中的哪个关键事件',
    '3. 本章如何体现主角目标和冲突',
    '4. 本章结尾如何推动下一章',
    '',
    '严格返回 JSON，不要输出解释文字：',
    '```json',
    '{',
    '  "chapters": [',
    '    { "title": "章节标题", "outline": "章节大纲（详细描述本章的情节推进）", "goal": "本章目标（本章要达成的创作目标）", "targetWordCount": 4000 }',
    '  ]',
    '}',
    '```',
  ]
    .filter(Boolean)
    .join('\n');

  return {
    taskType: 'chapter_outline_generate',
    messages: [systemPrompt(system), userPrompt('请生成章节大纲。')],
    maxTokens: 7000,
  };
}

/** 构建连接测试请求 */
export function buildConnectionTestPrompt(): AiGenerateRequest {
  return {
    taskType: 'connection_test',
    messages: [systemPrompt('You are an AI assistant. Reply with "OK" only.'), userPrompt('hi')],
    maxTokens: CONNECTION_TEST_MAX_OUTPUT_TOKENS,
  };
}
