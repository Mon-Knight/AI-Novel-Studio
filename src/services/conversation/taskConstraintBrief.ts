import type { ConversationTurn } from '../../types/conversation';
import type {
  TaskConstraintBrief,
  TaskConstraintBriefReceipt,
  TaskConstraintEntry,
} from '../../types/taskConstraintBrief';
import { decodeWorkbenchTurnContent } from './workbenchTurnOrigin';

const PERSISTENT_SCOPE =
  /(?:全书|整本|整部|全篇|全程|整个故事|所有章节|每(?:一)?章|后续(?:所有|每个|各个)?章节|以后(?:都|一直)|始终|一直保持|固定(?:使用|采用|为)|统一(?:使用|采用|保持)|永久(?:保持|不要)|除非(?:我|用户)(?:另行)?(?:说明|要求|修改))/i;
const LOCAL_CHAPTER_SCOPE =
  /(?:本章|这一章|此章|当前章|下一章|上(?:一)?章|第\s*[\d一二三四五六七八九十百千万]+\s*章)/i;
const STORY_ASSET_HEADING =
  /^(?:全书|整本|整部)(?:大纲|简介|梗概|剧情|故事|世界观|背景|设定|章节安排)\s*[：:]/i;
const MAX_CONSTRAINTS = 8;
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
  return deriveTaskConstraintBrief(turns, currentTurnId).constraints;
}

function constraintDimension(text: string): string | undefined {
  // Only independently identifiable dimensions can safely supersede old values.
  // Arbitrary semantic conflicts are not guessed from shared entity words.
  if (
    /^(?:全程|全书|整本|整部|始终|所有章节|每一?章)(?:都)?(?:统一)?(?:使用|采用|改用|保持)(?:第[一二三]人称)(?:限知|全知|叙述|视角|写作)*[。！!]?$/u.test(
      text,
    )
  ) {
    return 'narrative_person';
  }
  const named = text.match(
    /^(?:全书|全程|所有章节)(?:的)?(人称|叙事视角|文风|语气|节奏)[：:]/u,
  )?.[1];
  return named
    ? (
        {
          人称: 'narrative_person',
          叙事视角: 'narrative_person',
          文风: 'style',
          语气: 'tone',
          节奏: 'pace',
        } as Record<string, string>
      )[named]
    : undefined;
}

export function deriveTaskConstraintBrief(
  turns: readonly ConversationTurn[],
  currentTurnId?: string,
): TaskConstraintBrief {
  const seen = new Set<string>();
  const dimensions = new Set<string>();
  const constraints: string[] = [];
  const entries: TaskConstraintEntry[] = [];
  let totalLength = 0;

  for (const turn of [...turns].sort((left, right) => right.sequence - left.sequence)) {
    if (turn.role !== 'user' || turn.turnId === currentTurnId || !turn.content?.trim()) continue;
    const decoded = decodeWorkbenchTurnContent(turn.content);
    if (decoded.origin) continue;
    const segments = constraintSegments(decoded.content);
    for (let segmentIndex = segments.length - 1; segmentIndex >= 0; segmentIndex -= 1) {
      const segment = segments[segmentIndex];
      if (
        !PERSISTENT_SCOPE.test(segment) ||
        LOCAL_CHAPTER_SCOPE.test(segment) ||
        STORY_ASSET_HEADING.test(segment)
      ) {
        continue;
      }
      const key = segment.toLocaleLowerCase('zh-CN');
      const dimension = constraintDimension(segment);
      const characterCount = Array.from(segment).length;
      const entry: TaskConstraintEntry = {
        turnId: turn.turnId,
        sequence: turn.sequence,
        segmentIndex,
        characterCount,
        ...(dimension ? { dimension } : {}),
        status: 'included',
      };
      entries.push(entry);
      if (seen.has(key) || (dimension && dimensions.has(dimension))) {
        entry.status = 'superseded';
        continue;
      }
      seen.add(key);
      if (dimension) dimensions.add(dimension);
      if (
        constraints.length >= MAX_CONSTRAINTS ||
        totalLength + characterCount > MAX_BRIEF_LENGTH
      ) {
        entry.status = 'omitted_budget';
        continue;
      }
      constraints.push(segment);
      totalLength += characterCount;
    }
  }
  return { constraints, entries };
}

export function summarizeTaskConstraintBrief(
  brief: TaskConstraintBrief,
): TaskConstraintBriefReceipt {
  const count = (status: TaskConstraintEntry['status']) =>
    brief.entries.filter((entry) => entry.status === status).length;
  return {
    included: count('included'),
    superseded: count('superseded'),
    omittedBudget: count('omitted_budget'),
    entries: brief.entries.slice(0, 64).map((entry) => ({
      sequence: entry.sequence,
      segmentIndex: entry.segmentIndex,
      characterCount: entry.characterCount,
      ...(entry.dimension ? { dimension: entry.dimension } : {}),
      status: entry.status,
    })),
    omittedEntryCount: Math.max(0, brief.entries.length - 64),
  };
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
    '以下约束来自本任务此前用户回合，按较新优先排列。同类约束冲突时以较新项为准；若与当前指令或正式小说资产冲突，以当前指令和正式小说资产为准：',
    ...persistentConstraints.map((constraint) => `- ${constraint}`),
  ].join('\n');
}
