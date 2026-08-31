export type CandidateToolName =
  | 'generate_chapter'
  | 'generate_outline'
  | 'generate_characters'
  | 'suggest_events'
  | 'expand_settings'
  | 'polish_chapter'
  | 'check_quality'
  | 'summarize_chapter';

export type ContextReadToolName =
  'novel.read_context' | 'chapter.read_outline' | 'get_character_states' | 'search_memory';

export type DshTaskKind =
  | 'read'
  | 'story_plan_generate'
  | 'outline_generate'
  | 'setting_expand'
  | 'character_generate'
  | 'event_suggest'
  | 'quality_check'
  | 'chapter_summary';

export interface CandidateToolChoice {
  name: CandidateToolName;
  artifactType: string;
}

export interface DshTurnContract {
  taskKind: DshTaskKind;
  expectedTool?: CandidateToolName;
  expectedArtifactType?: string;
  requiredReadTools: ContextReadToolName[];
}

export type TaskIntent = 'chapter_write' | 'structured_write' | 'audit' | 'read';

export interface TaskConflictPeer {
  conversationId: string;
  novelId: string;
  title: string;
  chapterId?: string;
  latestGoal?: string;
}

export interface TaskTargetConflict {
  code: 'TASK_TARGET_OVERLAP';
  peerTitle: string;
  message: string;
}

const WRITE_INTENTS = new Set<TaskIntent>(['chapter_write', 'structured_write']);

const CONVERSATIONAL_GOAL =
  /^(你好|您好|哈喽|嗨+|hi+|hello|hey|早上好|下午好|晚上好|谢谢|感谢|thanks|thank you|你能做什么|你能干什么|你会什么|你是谁|在吗|喂|帮助|怎么用|如何使用|介绍一下自己?)[\s!！。.?？~～]*$/i;

const DOMAIN_GOAL =
  /生成|大纲|角色|人物|设定|事件|润色|质量|审计|检查|总结|候选|章节|下一章|正文|续写|创作|outline|generate|polish|audit|character|setting|event|summar/i;

const READ_OR_SEARCH_GOAL =
  /读取|查看|检索|查询|搜索|阅读|浏览|分析|解读|讨论|评价|评估|复盘|解释|为什么|是什么|怎么样|怎么看|上下文|记忆|设定库|角色表|大纲结构|历史|read|search|query|fetch|inspect|analy[sz]e|review|context|history/i;

const WRITE_OR_GENERATE_GOAL =
  /生成|创作|续写|润色|修改|改写|重写|草稿|正文|下一章|继续(?:写)?|接着写|往下写|再写一章|扩写|(?:^|[，。；：:、\s])(?:(?:请|请帮我|帮我|我想|我要)\s*)?写(?:出|一|这|本|第|篇|章|完整|正文)|generate|write|compose|continue|draft|polish|rewrite/i;
const CANDIDATE_ACTION_GOAL =
  /生成|候选|扩展|建议|润色|质量|审计|检查|总结|摘要|generate|expand|suggest|polish|quality|audit|summar/i;

const CHAPTER_REFERENCE_GOAL = /第\s*[\d一二两三四五六七八九十百千万零〇]+\s*章/i;
const CHAPTER_ADVANCE_GOAL =
  /^(?:(?:请|请帮我|帮我)\s*)?(?:继续(?:写(?:下一章)?)?|接着写|往下写|再写一章|下一章|生成下一章(?:正文)?|写下一章(?:正文)?|续写下一章)(?:[，,:：。；;！？!?].*)?$/i;
const ANALYSIS_REQUEST_GOAL =
  /分析|解读|讨论|评价|评估|复盘|解释|为什么|是什么|怎么样|怎么看|有什么问题|是否|需不需要|能否|可否|哪些|怎么|如何|可行|analy[sz]e|review/i;
const LEADING_MUTATION_REQUEST_GOAL =
  /^(?:(?:请|请帮我|帮我|我想|我要|我想请你)\s*)?(?:生成|创作|续写|继续(?:写)?|接着写|往下写|再写一章|下一章|撰写|润色|修改|改写|重写|扩写|写(?:出|一|这|本|第|篇|章|完整|正文|下一章))/i;
const COMMON_FICTION_GENRE_GOAL =
  /悬疑|推理|科幻|玄幻|奇幻|仙侠|武侠|都市|言情|历史|军事|惊悚|恐怖|冒险|青春|校园|现实|职场|末世|废土|赛博朋克|蒸汽朋克/i;
const EXPLICIT_WORD_COUNT_GOAL =
  /(?:(?:\d+(?:\.\d+)?|[一二两三四五六七八九十百]+)\s*(?:万|千)\s*字|\d{4,}\s*字)/i;
const FICTION_FORM_GOAL = /小说|故事/;
const SPARSE_PREMISE_READ_OR_QUESTION_GOAL =
  /读取|查看|检索|查询|搜索|阅读|浏览|分析|解读|讨论|评价|评估|复盘|解释|为什么|是什么|怎么样|怎么看|有什么问题|是否|是不是|需不需要|要不要|能否|可否|哪些|怎么|如何|可行|够不够|多少|几(?:页|章|字)|[?？]|(?:吗|呢|么)[！!。.\s]*$/i;
const SPARSE_PREMISE_SUBJECT_GOAL =
  /一个|一位|一名|某个|某位|最后一个|唯一的|所有人|全城|全世界|主角|少年|少女|孩子|老人|侦探|记者|医生|警察|作家|学生|钟表匠|旅馆|城市|村庄|学校|人类|机器人|记忆|时间|名字|影子|秘密/;
const SPARSE_PREMISE_EVENT_GOAL =
  /醒来|发现|追查|调查|寻找|逃离|逃亡|被困|失去|忘记|消失|复活|穿越|重生|收留|收到|遇见|爱上|背叛|继承|阻止|拯救|破解|揭开|夺回|偷走|改变|循环|倒流|每(?:天|晚|次)|突然/;
const CHAPTER_GENERATION_DIRECTIVE =
  /生成|创作|续写|继续写|接着写|往下写|再写一章|撰写|写作|(?:^|[，。；：:、\s])(?:(?:请|请帮我|帮我|我想|我要)\s*)?写(?:出|一|这|本|第|篇|章|完整|正文)|\bgenerate\b|\bwrite\b|\bcompose\b|\bcontinue\b/i;
const CHAPTER_REVISION_DIRECTIVE =
  /润色|修改|改写|重写|\bpolish\b|\brewrite\b|\brevise\b|\bedit\b/i;
const BOOK_CREATION_GOAL =
  /(?:(?:我想|我要|请|请帮我|帮我|给我|请给我)\s*)?(?:写|创作|构思|设计|做|来)\s*(?:一部|一本|一篇|一个|个|部|篇)?[^。！？!?\r\n]{0,180}(?:小说|故事|长篇|短篇)|(?:我想要|我要|给我|请给我)\s*(?:一部|一本|一篇|一个|个|部|篇)?[^。！？!?\r\n]{0,180}(?:小说|故事|长篇|短篇)|^(?:一个|一位|关于|以)[^。！？!?\r\n]{1,160}(?:故事|小说)[\s。！？!?]*$/i;
const STORY_PLAN_ACTION_GOAL =
  /(?:规划|构思|设计)(?:一下)?[^。！？!?\r\n]{0,32}(?:全书|整本|整部)|(?:生成|完善|扩展|补全|制定)(?:一下)?[^。！？!?\r\n]{0,32}(?:全书|整本|整部)[^。！？!?\r\n]{0,32}(?:故事规划|整体规划|规划|大纲)/i;
const CHAPTER_OUTLINE_SCOPE_GOAL =
  /(?:(?:本章|当前章(?:节)?|第\s*[\d一二两三四五六七八九十百千万零〇]+\s*章)[^。！？!?\r\n]{0,12}(?:大纲|规划)|章节(?:大纲|规划))/i;
const VOLUME_OUTLINE_SCOPE_GOAL =
  /(?:分卷(?:的)?(?:大纲|规划)|卷纲|(?:本卷|当前卷|第\s*[\d一二两三四五六七八九十百千万零〇]+\s*卷)[^。！？!?\r\n]{0,12}(?:大纲|规划))/i;
const CHAPTER_OUTLINE_ACTION_GOAL =
  /^(?:(?:请|请帮我|帮我|我想|我要)\s*)*(?:生成|完善|扩展|补全|细化|整理|制定)(?:一下)?\s*(?:(?:一份|一个|新的?)\s*)*(?:(?:本章|当前章(?:节)?|第\s*[\d一二三四五六七八九十百千万]+\s*章)(?:的)?(?:章节)?|章节)\s*(?:大纲|规划)/i;
const RULE_SETTING_ACTION_GOAL =
  /^(?:(?:请|请帮我|帮我|我想|我要|为本作品|为这个作品)\s*)*(?:生成|扩展|整理)(?:一下)?\s*(?:(?:当前|现有|已有|本作品|全书|新的?|更多|一批|一组)\s*)*(?:世界观?规则|规则)(?:候选|体系|设定)?/i;
const FORMAL_NOVEL_ASSET_SCOPE_GOAL =
  /当前|现有|已有|本(?:作品|书|小说|项目)|这(?:个作品|本书|部小说|本小说)|该(?:作品|书|小说|项目)|所选(?:作品|小说)|全书|整本|整部|项目/i;
const NOVEL_ASSET_READ_GOAL =
  /世界(?:观|背景|设定|规则)?|规则体系|大纲(?:结构)?|总纲|卷纲|章纲|主角|角色|人物|动机|关系|风格|伏笔|线索|正文|章节|本章|前文|上下文|记忆|已采用|事件|设定库|角色表/i;
const EXPLICIT_PROJECT_READ_SCOPE_GOAL =
  /当前|现有|已有|本(?:章|章节|作品|书|小说|项目)|这(?:一章|个作品|本书|部小说|本小说)|该(?:章|章节|作品|书|小说|项目)|所选(?:章节|作品|小说)|全书|整本|整部|项目|已采用|前文/i;
const GENERIC_CREATIVE_ADVICE_GOAL =
  /常见|套路|一般|通常|有哪些(?:写法|类型|方法)|如何(?:写|设计|安排)|怎么(?:写|设计|安排)|适合怎样|是否可行/i;
const CHAPTER_CONTEXT_READ_GOAL =
  /本章|当前章(?:节)?|第\s*[\d一二两三四五六七八九十百千万零〇]+\s*章|章节|正文|章纲|风格|伏笔|线索|动机|节奏/i;
const CHARACTER_STATE_READ_GOAL = /主角|角色|人物|动机|关系|一致性/i;
const CONTINUITY_MEMORY_READ_GOAL =
  /连续|承接|历史|前文|记忆|伏笔|线索|一致性|因果|时间线|上下文|回收/i;

function routingDirectiveText(text: string): string {
  const sections = text
    .split(/\r?\n+/)
    .map((section) => section.trim())
    .filter(Boolean);
  if (sections.length === 0) return '';
  const first = sections[0];
  const last = sections[sections.length - 1] ?? first;
  if (sections.length === 1) {
    return first.length <= 480 ? first : `${first.slice(0, 240)}\n${first.slice(-240)}`;
  }
  return `${first.slice(0, 320)}\n${last.slice(-320)}`;
}

function isStoryPlanGoal(goal: string): boolean {
  const directive = routingDirectiveText(goal.toLowerCase());
  return STORY_PLAN_ACTION_GOAL.test(directive) && !CHAPTER_OUTLINE_SCOPE_GOAL.test(directive);
}

function requiresFormalNovelContextRead(goal: string): boolean {
  const directive = routingDirectiveText(goal.toLowerCase());
  if (!READ_OR_SEARCH_GOAL.test(directive) || !NOVEL_ASSET_READ_GOAL.test(directive)) {
    return false;
  }
  const explicitScope =
    FORMAL_NOVEL_ASSET_SCOPE_GOAL.test(directive) ||
    EXPLICIT_PROJECT_READ_SCOPE_GOAL.test(directive) ||
    CHAPTER_REFERENCE_GOAL.test(directive);
  return explicitScope || !GENERIC_CREATIVE_ADVICE_GOAL.test(directive);
}

function buildRequiredReadTools(goal: string, chapterId?: string): ContextReadToolName[] {
  if (!requiresFormalNovelContextRead(goal)) return [];
  const directive = routingDirectiveText(goal.toLowerCase());
  const tools: ContextReadToolName[] = ['novel.read_context'];
  if (chapterId && CHAPTER_CONTEXT_READ_GOAL.test(directive)) {
    tools.push('chapter.read_outline');
  }
  if (chapterId && CHARACTER_STATE_READ_GOAL.test(directive)) {
    tools.push('get_character_states');
  }
  if (CONTINUITY_MEMORY_READ_GOAL.test(directive)) {
    tools.push('search_memory');
  }
  return [...new Set(tools)];
}

function isShortCreativeBrief(goal: string): boolean {
  const text = goal.trim();
  if (!text || Array.from(text).length > 80) {
    return false;
  }
  const hasGenre = COMMON_FICTION_GENRE_GOAL.test(text);
  const hasWordCount = EXPLICIT_WORD_COUNT_GOAL.test(text);
  const hasFictionForm = FICTION_FORM_GOAL.test(text);
  const hasCreativeLead = /^(?:(?:我)?想(?:要)?|我要)(?:写|创作|构思|做)/.test(text);
  const hasConceptShape =
    /[，,、:：]/.test(text) ||
    /(?:上|下|中|里|内|外|之上|之下|之中)(?:的)?[\u3400-\u9fffA-Za-z0-9]{2,}$/.test(text);
  const hasNarrativePremise =
    Array.from(text).length >= 6 &&
    !SPARSE_PREMISE_READ_OR_QUESTION_GOAL.test(text) &&
    SPARSE_PREMISE_SUBJECT_GOAL.test(text) &&
    SPARSE_PREMISE_EVENT_GOAL.test(text);

  return (
    (hasWordCount && hasFictionForm) ||
    (hasGenre && (hasWordCount || hasFictionForm || hasCreativeLead || hasConceptShape)) ||
    hasNarrativePremise
  );
}

export function isConversationalGoal(goal: string): boolean {
  const text = goal.trim();
  if (!text || Array.from(text).length > 40) return false;
  if (DOMAIN_GOAL.test(text)) return false;
  return CONVERSATIONAL_GOAL.test(text);
}

function matchCandidateTool(goal: string): CandidateToolChoice | undefined {
  const text = goal.toLowerCase();
  const directive = routingDirectiveText(text);
  const primaryDirective = text.split(/[\r\n。！？!?]/, 1)[0]?.trim() ?? '';
  const generationDirective = directive.match(CHAPTER_GENERATION_DIRECTIVE);
  const revisionDirective = directive.match(CHAPTER_REVISION_DIRECTIVE);
  if (
    ANALYSIS_REQUEST_GOAL.test(text) &&
    !/审计|检查|质量|总结|摘要|audit|quality|summar/i.test(text) &&
    !LEADING_MUTATION_REQUEST_GOAL.test(primaryDirective)
  ) {
    return undefined;
  }
  if (
    READ_OR_SEARCH_GOAL.test(text) &&
    !WRITE_OR_GENERATE_GOAL.test(text) &&
    !CANDIDATE_ACTION_GOAL.test(text)
  ) {
    return undefined;
  }
  if (CHAPTER_ADVANCE_GOAL.test(primaryDirective)) {
    return { name: 'generate_chapter', artifactType: 'chapter_text' };
  }
  if (/^(?:请)?生成全书规划候选$/.test(primaryDirective)) {
    return { name: 'generate_outline', artifactType: 'outline' };
  }
  if (/^(?:请)?生成(?:世界与规则设定|世界设定|规则设定)候选$/.test(primaryDirective)) {
    return { name: 'expand_settings', artifactType: 'setting_candidates' };
  }
  if (/^(?:请)?生成主角候选$/.test(primaryDirective)) {
    return { name: 'generate_characters', artifactType: 'character_candidates' };
  }
  if (/^(?:请)?生成本章大纲候选$/.test(primaryDirective)) {
    return { name: 'generate_outline', artifactType: 'outline' };
  }
  if (isStoryPlanGoal(text)) {
    return { name: 'generate_outline', artifactType: 'outline' };
  }
  if (
    CHAPTER_OUTLINE_SCOPE_GOAL.test(primaryDirective) &&
    /生成|完善|扩展|补全|细化|整理|制定/.test(primaryDirective)
  ) {
    return { name: 'generate_outline', artifactType: 'outline' };
  }
  if (CHAPTER_OUTLINE_ACTION_GOAL.test(primaryDirective)) {
    return { name: 'generate_outline', artifactType: 'outline' };
  }
  if (BOOK_CREATION_GOAL.test(directive)) {
    return { name: 'generate_chapter', artifactType: 'chapter_text' };
  }
  if (RULE_SETTING_ACTION_GOAL.test(primaryDirective)) {
    return { name: 'expand_settings', artifactType: 'setting_candidates' };
  }
  const generating = /生成|候选|扩展|建议|generate|expand|suggest/.test(text);
  if (/质量|审计|检查|一致|伏笔|quality/.test(text) && !generating && !revisionDirective) {
    return { name: 'check_quality', artifactType: 'quality_report' };
  }
  if (
    ((/正文/.test(text) || CHAPTER_REFERENCE_GOAL.test(text)) &&
      Boolean(generationDirective || revisionDirective)) ||
    (generating && /章节|下一章/.test(text))
  ) {
    if (
      revisionDirective &&
      (!generationDirective || revisionDirective.index! < generationDirective.index!)
    ) {
      return { name: 'polish_chapter', artifactType: 'chapter_text' };
    }
    return { name: 'generate_chapter', artifactType: 'chapter_text' };
  }
  if (/大纲|outline/.test(text)) return { name: 'generate_outline', artifactType: 'outline' };
  if (/风格分析|style analysis/.test(text)) {
    return undefined;
  }
  if (/润色|风格|polish/.test(text))
    return { name: 'polish_chapter', artifactType: 'chapter_text' };
  if (/伏笔|foreshadow/.test(text) && generating) {
    return { name: 'suggest_events', artifactType: 'event_candidates' };
  }
  if (/角色|人物|主角|character/.test(text)) {
    return { name: 'generate_characters', artifactType: 'character_candidates' };
  }
  if (/设定|世界|setting/.test(text)) {
    return { name: 'expand_settings', artifactType: 'setting_candidates' };
  }
  if (/事件|剧情|event/.test(text)) {
    return { name: 'suggest_events', artifactType: 'event_candidates' };
  }
  if (/质量|审计|检查|一致|伏笔|quality/.test(text)) {
    return { name: 'check_quality', artifactType: 'quality_report' };
  }
  if (/总结|摘要|summar/.test(text)) {
    return { name: 'summarize_chapter', artifactType: 'chapter_summary' };
  }
  if (isShortCreativeBrief(directive)) {
    return { name: 'generate_chapter', artifactType: 'chapter_text' };
  }
  if (WRITE_OR_GENERATE_GOAL.test(text)) {
    return { name: 'generate_chapter', artifactType: 'chapter_text' };
  }
  return undefined;
}

export function selectCandidateTool(
  goal: string,
  chapterId?: string,
): CandidateToolChoice | undefined {
  if (isConversationalGoal(goal)) return undefined;
  const selected = matchCandidateTool(goal);
  const primaryDirective =
    goal
      .toLowerCase()
      .split(/[\r\n。！？!?]/, 1)[0]
      ?.trim() ?? '';
  if (VOLUME_OUTLINE_SCOPE_GOAL.test(primaryDirective)) {
    return undefined;
  }
  if (
    !chapterId &&
    selected?.name === 'generate_outline' &&
    CHAPTER_OUTLINE_SCOPE_GOAL.test(primaryDirective)
  ) {
    return undefined;
  }
  if (
    !chapterId &&
    selected &&
    !['generate_outline', 'generate_characters', 'expand_settings'].includes(selected.name)
  ) {
    return undefined;
  }
  return selected;
}

const TASK_KIND_BY_TOOL: Partial<Record<CandidateToolName, DshTaskKind>> = {
  generate_outline: 'outline_generate',
  generate_characters: 'character_generate',
  suggest_events: 'event_suggest',
  expand_settings: 'setting_expand',
  check_quality: 'quality_check',
  summarize_chapter: 'chapter_summary',
};

const CHARACTER_CONTEXT_TOOLS = new Set<CandidateToolName>([
  'generate_characters',
  'suggest_events',
  'check_quality',
]);

const CONTINUITY_CONTEXT_TOOLS = new Set<CandidateToolName>(['suggest_events', 'check_quality']);

export function buildDshTurnContract(goal: string, chapterId?: string): DshTurnContract {
  const selected = selectCandidateTool(goal, chapterId);
  if (!selected || selected.name === 'generate_chapter' || selected.name === 'polish_chapter') {
    return {
      taskKind: 'read',
      requiredReadTools: buildRequiredReadTools(goal, chapterId),
    };
  }

  const requiredReadTools: ContextReadToolName[] = ['novel.read_context'];
  if (chapterId) requiredReadTools.push('chapter.read_outline');
  if (chapterId && CHARACTER_CONTEXT_TOOLS.has(selected.name)) {
    requiredReadTools.push('get_character_states');
  }
  if (CONTINUITY_CONTEXT_TOOLS.has(selected.name)) {
    requiredReadTools.push('search_memory');
  }

  const taskKind =
    selected.name === 'generate_outline' && !chapterId && isStoryPlanGoal(goal)
      ? 'story_plan_generate'
      : (TASK_KIND_BY_TOOL[selected.name] ?? 'read');

  return {
    taskKind,
    expectedTool: selected.name,
    expectedArtifactType: selected.artifactType,
    requiredReadTools: [...new Set(requiredReadTools)],
  };
}

export function classifyTaskIntent(goal: string): TaskIntent {
  if (isConversationalGoal(goal)) return 'read';
  const tool = matchCandidateTool(goal);
  if (!tool) {
    if (READ_OR_SEARCH_GOAL.test(goal) || !WRITE_OR_GENERATE_GOAL.test(goal)) {
      return 'read';
    }
    return 'chapter_write';
  }
  if (tool.name === 'check_quality') return 'audit';
  if (tool.name === 'generate_chapter' || tool.name === 'polish_chapter') return 'chapter_write';
  return 'structured_write';
}

export function findTaskTargetConflict(input: {
  novelId: string;
  chapterId?: string;
  conversationId: string;
  goal: string;
  peers: TaskConflictPeer[];
}): TaskTargetConflict | undefined {
  if (!input.goal.trim()) return undefined;
  const intent = classifyTaskIntent(input.goal);
  if (!WRITE_INTENTS.has(intent)) return undefined;
  const peer = input.peers.find((item) => {
    if (item.conversationId === input.conversationId) return false;
    if (item.novelId !== input.novelId) return false;
    if (input.chapterId && item.chapterId && item.chapterId !== input.chapterId) return false;
    const peerIntent = classifyTaskIntent(item.latestGoal || item.title);
    return WRITE_INTENTS.has(peerIntent) || !item.latestGoal;
  });
  if (!peer) return undefined;
  return {
    code: 'TASK_TARGET_OVERLAP',
    peerTitle: peer.title,
    message: `同一小说已有任务「${peer.title}」正在运行。可以继续并发；若双方都对同一章节生成或应用候选，确认时可能出现基线冲突。`,
  };
}
