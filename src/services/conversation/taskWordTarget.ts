import type { ConversationTurn } from '../../types/conversation';
import { taskGoalDirective } from './taskGoalDirective';
import { decodeWorkbenchTurnContent } from './workbenchTurnOrigin';

export interface TaskWordTargetDirective {
  target: number;
  scope: 'task' | 'turn';
  settingOnly: boolean;
}

const AMOUNT = '(\\d+(?:\\.\\d+)?\\s*[千万]?)';
const TARGET = new RegExp(
  '^\\s*(?:(?:请|把|将)\\s*)*(?:(?:本任务|当前任务|这个任务)(?:的)?(?:每章)?|每(?:一)?章|本章|这一章|当前章|下一章)?' +
    '(?:的)?目标(?:字数)?\\s*(?:(?:设置|设|调整|改)(?:为|成)|为|是|[:：=])?\\s*' +
    AMOUNT +
    '\\s*字?\\s*(?:左右)?\\s*$',
  'gu',
);
const SETTING_ONLY =
  /^(?:(?:请|把|将)\s*)*(?:(?:本任务|当前任务|这个任务)(?:的)?(?:每章)?|每(?:一)?章)?(?:的)?目标(?:字数)?\s*(?:(?:设置|设|调整|改)(?:为|成)|为|是|[:：=])?\s*\d+(?:\.\d+)?\s*[千万]?\s*字?[。！!\s]*$/u;

function targetError(): Error {
  return Object.assign(
    new Error(
      '请明确一个正整数章节目标字数，例如“本任务目标字数设为3200字”；不要同时给出多个目标或范围。',
    ),
    {
      code: 'WORKBENCH_WORD_TARGET_INVALID',
    },
  );
}

/** Only explicit directives, never numbers in quoted prose, total-book targets or negations. */
export function parseTaskWordTarget(goal: string): TaskWordTargetDirective | undefined {
  const text = taskGoalDirective(goal).text;
  if (/[?？]|(?:吗|呢)[。！!\s]*$/u.test(text)) return undefined;
  const clauses = text
    .split(/[，,；;。！？!?\n]/u)
    .filter(
      (clause) =>
        !/不要|不必|不用|别|禁止|不允许|不准|无需|暂不|不能|不是|保持|不改|是否|能否|怎么|如何|建议|例如|比如|全书|整本|整部|总字数/u.test(
          clause,
        ),
    );
  const matches = clauses.flatMap((clause) => [...clause.matchAll(TARGET)]);
  if (!matches.length) {
    if (
      clauses.some((clause) =>
        /^\s*(?:(?:请|把|将)\s*)*(?:(?:本任务|当前任务|这个任务|每章|本章)(?:的)?)?目标(?:字数|\s*\d)/u.test(
          clause,
        ),
      )
    )
      throw targetError();
    return undefined;
  }
  const values = matches.map((match) => {
    const value = match[1].replace(/\s/gu, '');
    return (
      Number(value.replace(/[千万]/u, '')) *
      (value.endsWith('万') ? 10000 : value.endsWith('千') ? 1000 : 1)
    );
  });
  if (
    values.some((value) => !Number.isSafeInteger(value) || value <= 0) ||
    new Set(values).size !== 1 ||
    clauses.some((clause) => /\d\s*字?\s*[-—~～至到]\s*\d/u.test(clause))
  )
    throw targetError();
  const settingOnly = SETTING_ONLY.test(text);
  // A chapter-local setting without a writing action has no durable task scope.
  if (!settingOnly && matches.length === clauses.filter((clause) => clause.trim()).length) {
    throw targetError();
  }
  return {
    target: values[0],
    scope:
      settingOnly || matches.some((match) => /本任务|当前任务|这个任务|每(?:一)?章/u.test(match[0]))
        ? 'task'
        : 'turn',
    settingOnly,
  };
}

export function isTaskWordTargetSetting(goal: string): boolean {
  try {
    return parseTaskWordTarget(goal)?.settingOnly === true;
  } catch {
    return false;
  }
}

/** User turns are the durable task authority. Local chapter targets never leak to later chapters. */
export function resolveTaskWordTarget(
  goal: string,
  turns: readonly ConversationTurn[],
  currentTurnId?: string,
): number | undefined {
  const current = parseTaskWordTarget(goal);
  if (current) return current.target;
  const currentSequence = turns.find((turn) => turn.turnId === currentTurnId)?.sequence ?? Infinity;
  for (const turn of [...turns].sort((a, b) => b.sequence - a.sequence)) {
    if (turn.role !== 'user' || turn.turnId === currentTurnId || turn.sequence >= currentSequence)
      continue;
    const decoded = decodeWorkbenchTurnContent(turn.content);
    if (decoded.origin) continue;
    try {
      const parsed = parseTaskWordTarget(decoded.content);
      if (parsed?.scope === 'task') return parsed.target;
    } catch {
      /* An unaccepted ambiguous turn cannot replace a valid task target. */
    }
  }
  return undefined;
}
