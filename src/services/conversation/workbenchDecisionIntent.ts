export type WorkbenchDecisionTarget = 'asset' | 'summary' | 'chapter';

export type WorkbenchDecisionIntent =
  | {
      kind: 'apply_current';
      target: 'asset' | 'summary';
      continueAfter: boolean;
    }
  | {
      kind: 'adopt_chapter';
      target: 'chapter';
      continueAfter: boolean;
    }
  | {
      kind: 'reject_current';
      target: WorkbenchDecisionTarget;
      continueAfter: false;
    }
  | {
      kind: 'request_revision';
      target: WorkbenchDecisionTarget;
      continueAfter: false;
      revisionInstruction?: string;
    };

const MAX_COMMAND_LENGTH = 240;
const INVISIBLE_CHARACTER = /[\u200b-\u200d\u2060\ufeff]/u;
const AFFIRMATIVE_TRAILING_PUNCTUATION = /[。.!！]+$/u;

const TARGET_PATTERNS: ReadonlyArray<{
  target: WorkbenchDecisionTarget;
  pattern: string;
}> = [
  {
    target: 'summary',
    pattern: '(?:本章总结候选|章节总结候选|总结候选)',
  },
  {
    target: 'chapter',
    pattern: '(?:本章正文候选|章节正文候选|本章候选|章节候选)',
  },
  {
    target: 'asset',
    pattern:
      '(?:当前资产候选|资产候选|世界与规则设定候选|世界规则设定候选|世界设定候选|规则设定候选|主角候选|角色候选|全书规划候选|故事规划候选|章节大纲候选|大纲候选)',
  },
];

const CONTINUATION_SUFFIX =
  /(?:并|然后)(?:继续|继续写|继续生成|继续创作|继续写下一章|继续生成下一章(?:正文)?|继续创作下一章|进入下一章)$/u;

function containsControlOrInvisibleCharacter(value: string): boolean {
  return (
    INVISIBLE_CHARACTER.test(value) ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || (code >= 127 && code <= 159);
    })
  );
}

function normalizeCommand(text: string): string | null {
  if (typeof text !== 'string') return null;
  const normalized = text.normalize('NFKC').trim();
  if (
    !normalized ||
    Array.from(normalized).length > MAX_COMMAND_LENGTH ||
    containsControlOrInvisibleCharacter(normalized)
  ) {
    return null;
  }
  return normalized.replace(AFFIRMATIVE_TRAILING_PUNCTUATION, '').trim();
}

function compactCommand(input: string): string {
  return input.replace(/\s+/gu, '');
}

function splitContinuation(command: string): {
  command: string;
  continueAfter: boolean;
} {
  const match = command.match(CONTINUATION_SUFFIX);
  if (!match || match.index === undefined) {
    return { command, continueAfter: false };
  }
  return {
    command: command.slice(0, match.index).replace(/[，,]$/u, ''),
    continueAfter: true,
  };
}

function matchesApply(command: string, targetPattern: string): boolean {
  return [
    new RegExp(`^(?:请)?(?:确认(?:并)?应用|应用)${targetPattern}(?:到作品)?$`, 'u'),
    new RegExp(`^(?:请)?将${targetPattern}应用(?:到作品)?$`, 'u'),
    new RegExp(`^(?:请)?确认${targetPattern}(?:并)?应用(?:到作品)?$`, 'u'),
  ].some((pattern) => pattern.test(command));
}

function matchesChapterAdoption(command: string, targetPattern: string): boolean {
  return [
    new RegExp(`^(?:请)?(?:确认(?:并)?采用|采用)${targetPattern}(?:作为正式正文)?$`, 'u'),
    new RegExp(`^(?:请)?将${targetPattern}采用为正式正文$`, 'u'),
    new RegExp(`^(?:请)?确认${targetPattern}(?:并)?采用(?:为|作为)?正式正文$`, 'u'),
  ].some((pattern) => pattern.test(command));
}

function matchesRejection(command: string, targetPattern: string): boolean {
  return [
    new RegExp(`^(?:请)?拒绝${targetPattern}$`, 'u'),
    new RegExp(`^(?:请)?(?:不采用|不应用)${targetPattern}$`, 'u'),
  ].some((pattern) => pattern.test(command));
}

function parseRevision(command: string): WorkbenchDecisionIntent | null {
  const separatorIndex = command.indexOf(':');
  const head = compactCommand(separatorIndex >= 0 ? command.slice(0, separatorIndex) : command);
  const revisionInstruction =
    separatorIndex >= 0 ? command.slice(separatorIndex + 1).trim() : undefined;
  if (separatorIndex >= 0 && !revisionInstruction) return null;

  for (const target of TARGET_PATTERNS) {
    const pattern = new RegExp(`^(?:请)?(?:要求修改|修改)${target.pattern}$`, 'u');
    if (!pattern.test(head)) continue;
    return {
      kind: 'request_revision',
      target: target.target,
      continueAfter: false,
      ...(revisionInstruction ? { revisionInstruction } : {}),
    };
  }
  return null;
}

/**
 * Parses only explicit, single-target workbench decisions. Ambiguous or compound
 * instructions deliberately return null so callers can fail closed.
 */
export function parseWorkbenchDecisionIntent(text: string): WorkbenchDecisionIntent | null {
  const normalized = normalizeCommand(text);
  if (!normalized) return null;

  const revision = parseRevision(normalized);
  if (revision) return revision;
  if (normalized.includes(':')) return null;

  const compact = compactCommand(normalized);
  const continuation = splitContinuation(compact);

  for (const target of TARGET_PATTERNS) {
    if (matchesRejection(continuation.command, target.pattern)) {
      if (continuation.continueAfter) return null;
      return {
        kind: 'reject_current',
        target: target.target,
        continueAfter: false,
      };
    }
    if (target.target === 'chapter') {
      if (!matchesChapterAdoption(continuation.command, target.pattern)) continue;
      return {
        kind: 'adopt_chapter',
        target: 'chapter',
        continueAfter: continuation.continueAfter,
      };
    }
    if (!matchesApply(continuation.command, target.pattern)) continue;
    return {
      kind: 'apply_current',
      target: target.target,
      continueAfter: continuation.continueAfter,
    };
  }

  return null;
}
