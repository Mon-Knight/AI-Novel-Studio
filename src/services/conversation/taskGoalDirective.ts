// Routing sees directives, not quoted prose. The original goal remains untouched
// in the conversation, Provider request and immutable execution snapshot.
const QUOTED_MATERIAL =
  /```[\s\S]*?(?:```|$)|“[^”]*(?:”|$)|「[^」]*(?:」|$)|『[^』]*(?:』|$)|"[^"\r\n]*"|(?<![A-Za-z])'[^'\r\n]*'(?![A-Za-z])/gu;
const MATERIAL_HEADING =
  /^\s*(?:引用|原文|待分析文本|参考文本|故事内容|以下正文|以下原文|quoted text|source text)\s*[：:]/iu;
const ACTION =
  '(?:生成|创作|续写|继续写|润色|改写|重写|修改|修订|扩写|写|总结|摘要|检查|审计|分析|读取|查看|检索|generate|write|compose|continue|polish|rewrite|summarize|summarise|audit|check|analy[sz]e|read|search)';
const NEGATION_PREFIX =
  /^(?:不要|不必|不用|别|禁止|不允许|不准|无需|暂不|不能|不是|不|do not|don't|never)\s*(?:再|先)?\s*/iu;
const NEGATED_ACTION = new RegExp(`(?:${NEGATION_PREFIX.source})${ACTION}`, 'iu');
const POSITIVE_ACTION = new RegExp(`^${ACTION}`, 'iu');
const ALTERNATIVE_ACTIONS = new RegExp(
  `${ACTION}[^。！？\\r\\n]{0,80}(?:还是|或者|或是|\\bor\\b)[^。！？\\r\\n]{0,40}${ACTION}`,
  'iu',
);

export function stripTaskCourtesy(value: string): string {
  let text = value.trimStart();
  for (;;) {
    const match = text.match(
      /^(?:请帮我|请|帮我|我想|我要|但是|但|而是|然而|先|暂时|现在|本次|这次|只需要|只要|只|仅|根据以下要求|为本作品|please\b|only\b|but\b)\s*/iu,
    );
    if (!match) return text;
    text = text.slice(match[0].length);
  }
}

type RevisionIdentity = 'outline' | 'settings';

function actionIdentity(clause: string, revisionScope?: RevisionIdentity): string | undefined {
  const text = stripTaskCourtesy(clause);
  if (!POSITIVE_ACTION.test(text)) return undefined;
  if (/^(?:检查|审计|audit|check)/iu.test(text)) return 'audit';
  if (/^(?:总结|摘要|summari[sz]e)/iu.test(text)) return 'summary';
  if (/^(?:读取|查看|检索|分析|read|search|analy[sz]e)/iu.test(text)) return 'read';
  if (revisionScope) {
    // The first explicit asset identifies the operation; later chapter references
    // can be details inside that asset. Bare edits such as “写深秋” retain its scope.
    const asset =
      /全书规划|故事规划|大纲|outline|story\s+plan|book\s+plan|设定|规则|settings?|world_setting|角色|人物|主角|character|正文|prose/iu.exec(
        text,
      );
    if (asset) {
      if (/规划|大纲|outline|plan/iu.test(asset[0])) return 'outline';
      if (/设定|规则|setting/iu.test(asset[0])) return 'settings';
      if (/角色|人物|主角|character/iu.test(asset[0])) return 'characters';
      return 'chapter';
    }
    if (
      /^(?:生成|创作|续写|继续写|写)\s*(?:第\s*[\d一二两三四五六七八九十百]+\s*章|本章|当前章|下一章)\s*$/u.test(
        text,
      )
    )
      return 'chapter';
    return revisionScope;
  }
  const planning = /全书规划|故事规划|^(?:生成|创作)规划|story\s+plan|book\s+plan/iu.exec(text);
  const prose = /正文/iu.exec(text);
  if (planning && (!prose || planning.index < prose.index)) return 'outline';
  if (/角色|人物|主角|character/iu.test(text) && !/正文|章节|本章|下一章|chapter/iu.test(text))
    return 'characters';
  if (/大纲|outline/iu.test(text)) return 'outline';
  if (/设定|规则|setting/iu.test(text) && !/正文|章节|本章|chapter/iu.test(text)) return 'settings';
  return /^(?:润色|改写|重写|修改|修订|polish|rewrite)/iu.test(text) ? 'revision' : 'chapter';
}

export function taskGoalDirective(
  goal: string,
  revisionScope?: RevisionIdentity,
): { text: string; needsClarification: boolean } {
  const unquoted = goal.replace(QUOTED_MATERIAL, ' ');
  const lines: string[] = [];
  for (const line of unquoted.split(/\r?\n/u)) {
    if (MATERIAL_HEADING.test(line)) break;
    if (/^\s*>/u.test(line)) continue;
    lines.push(line);
  }
  const materialFree = revisionScope
    ? lines
        .join('\n')
        .replace(
          new RegExp(
            `(?:同时|并且|并|还要|然后|且|另外|以及)(?=(?:不要|暂不|不)?${ACTION})`,
            'giu',
          ),
          '，',
        )
    : lines.join('\n');
  let negated = false;
  const forbidden = new Set<string>();
  const clauses = materialFree.split(/([，,；;。！？!?\n])/u);
  const kept = clauses.map((clause) => {
    if (!NEGATED_ACTION.test(stripTaskCourtesy(clause))) return clause;
    negated = true;
    const identity = actionIdentity(
      stripTaskCourtesy(clause).replace(NEGATION_PREFIX, ''),
      revisionScope,
    );
    if (identity) forbidden.add(identity);
    return '';
  });
  const text = kept
    .join('')
    .replace(/^[，,；;。！？!?\s]+/u, '')
    .trim();
  const hasPositiveAction = text
    .split(/[，,；;。！？!?\n]/u)
    .some((part) => POSITIVE_ACTION.test(stripTaskCourtesy(part)));
  const contradictory = text.split(/[，,；;。！？!?\n]/u).some((part) => {
    const identity = actionIdentity(part, revisionScope);
    return (
      identity !== undefined &&
      (forbidden.has(identity) ||
        (revisionScope !== undefined && identity !== revisionScope && identity !== 'read'))
    );
  });
  return {
    text,
    needsClarification:
      contradictory || ALTERNATIVE_ACTIONS.test(text) || (negated && !hasPositiveAction),
  };
}
