import type { ConversationTurn } from '../../types/conversation';
import { decodeWorkbenchTurnContent } from './workbenchTurnOrigin';

const PERSISTENT_SCOPE =
  /(?:全书|整本|整部|全篇|全程|整个故事|所有章节|每(?:一)?章|后续(?:所有|每个|各个)?章节|以后(?:都|一直)|始终|一直保持|固定(?:使用|采用|为)|统一(?:使用|采用|保持)|永久(?:保持|不要)|除非(?:我|用户)(?:另行)?(?:说明|要求|修改))/i;
const LOCAL_CHAPTER_SCOPE =
  /(?:本章|这一章|此章|当前章|下一章|上(?:一)?章|第\s*[\d一二三四五六七八九十百千万]+\s*章)/i;
const STORY_ASSET_HEADING =
  /^(?:全书|整本|整部)(?:大纲|简介|梗概|剧情|故事|世界观|背景|设定|章节安排)\s*[：:]/i;
const MAX_CONSTRAINTS = 8;
const MAX_CONSTRAINT_LENGTH = 320;
const MAX_BRIEF_LENGTH = 1_600;

function normalizeConstraint(value: string): string {
  return value
    .replace(/^[-*•\d.、)）\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function constraintSegments(content: string): string[] {
  return content
    .split(/\r?\n|(?<=[。！？!?；;])/u)
    .map(normalizeConstraint)
    .filter(Boolean);
}

/**
 * Carries only explicitly task-wide user constraints across turns. Chapter-local
 * beats and Story Bible sections stay in the novel assets instead of leaking into
 * a later chapter through conversation history.
 */
export function derivePersistentTaskConstraints(
  turns: readonly ConversationTurn[],
  currentTurnId?: string,
): string[] {
  const seen = new Set<string>();
  const constraints: string[] = [];
  let totalLength = 0;

  for (const turn of turns) {
    if (turn.role !== 'user' || turn.turnId === currentTurnId || !turn.content?.trim()) continue;
    const decoded = decodeWorkbenchTurnContent(turn.content);
    if (decoded.origin) continue;
    for (const segment of constraintSegments(decoded.content)) {
      if (
        segment.length > MAX_CONSTRAINT_LENGTH ||
        !PERSISTENT_SCOPE.test(segment) ||
        LOCAL_CHAPTER_SCOPE.test(segment) ||
        STORY_ASSET_HEADING.test(segment)
      ) {
        continue;
      }
      const key = segment.toLocaleLowerCase('zh-CN');
      if (seen.has(key)) continue;
      if (totalLength + segment.length > MAX_BRIEF_LENGTH) return constraints;
      seen.add(key);
      constraints.push(segment);
      totalLength += segment.length;
      if (constraints.length >= MAX_CONSTRAINTS) return constraints;
    }
  }
  return constraints;
}

export function composeWorkbenchInstruction(
  currentGoal: string,
  persistentConstraints: readonly string[],
): string {
  const goal = currentGoal.trim();
  if (persistentConstraints.length === 0) return goal;
  return [
    '【当前用户指令】',
    goal,
    '',
    '【任务持续约束】',
    '以下约束来自本任务此前用户回合。若与当前指令或正式小说资产冲突，以当前指令和正式小说资产为准：',
    ...persistentConstraints.map((constraint) => `- ${constraint}`),
  ].join('\n');
}
