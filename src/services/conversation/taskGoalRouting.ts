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

function matchCandidateTool(goal: string): CandidateToolChoice {
  const text = goal.toLowerCase();
  const generating = /生成|候选|扩展|建议|generate|expand|suggest/.test(text);
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
  return { name: 'generate_chapter', artifactType: 'chapter_text' };
}

export function selectCandidateTool(
  goal: string,
  chapterId?: string,
): CandidateToolChoice | undefined {
  if (!chapterId) return undefined;
  return matchCandidateTool(goal);
}

export function classifyTaskIntent(goal: string): TaskIntent {
  const tool = matchCandidateTool(goal);
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
