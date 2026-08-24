export interface CandidateToolChoice {
  name: string;
  artifactType: string;
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
  /读取|查看|检索|查询|搜索|阅读|浏览|上下文|记忆|设定库|角色表|大纲结构|历史|read|search|query|fetch|inspect|context|history/i;

const WRITE_OR_GENERATE_GOAL =
  /生成|写|创作|续写|润色|修改|改写|草稿|正文|下一章|继续写|扩写|第[\d一二三四五六七八九十百千万]+章|generate|write|compose|continue|draft|polish|rewrite/i;

export function isConversationalGoal(goal: string): boolean {
  const text = goal.trim();
  if (!text || Array.from(text).length > 40) return false;
  if (DOMAIN_GOAL.test(text)) return false;
  return CONVERSATIONAL_GOAL.test(text);
}

function matchCandidateTool(goal: string): CandidateToolChoice | undefined {
  const text = goal.toLowerCase();
  const generating = /生成|候选|扩展|建议|generate|expand|suggest/.test(text);
  if (
    /正文|第[\d一二三四五六七八九十百千万]+章/.test(text) ||
    (generating && /章节|下一章/.test(text))
  ) {
    if (/润色|修改|改写|polish|rewrite/.test(text)) {
      return { name: 'polish_chapter', artifactType: 'chapter_text' };
    }
    return { name: 'generate_chapter', artifactType: 'chapter_text' };
  }
  if (/大纲|outline/.test(text)) return { name: 'generate_outline', artifactType: 'outline' };
  if (/风格分析|style analysis/.test(text)) {
    return { name: 'check_quality', artifactType: 'quality_report' };
  }
  if (/润色|风格|polish/.test(text))
    return { name: 'polish_chapter', artifactType: 'chapter_text' };
  if (/伏笔|foreshadow/.test(text) && generating) {
    return { name: 'suggest_events', artifactType: 'event_candidates' };
  }
  if (/质量|审计|检查|一致|伏笔|quality/.test(text) && !generating) {
    return { name: 'check_quality', artifactType: 'quality_report' };
  }
  if (/角色|人物|character/.test(text)) {
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
  if (WRITE_OR_GENERATE_GOAL.test(text)) {
    return { name: 'generate_chapter', artifactType: 'chapter_text' };
  }
  return undefined;
}

export function selectCandidateTool(
  goal: string,
  chapterId?: string,
): CandidateToolChoice | undefined {
  if (!chapterId || isConversationalGoal(goal)) return undefined;
  return matchCandidateTool(goal);
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
