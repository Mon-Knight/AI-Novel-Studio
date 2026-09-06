// Routing sees directives, not quoted prose. The original goal remains untouched
// in the conversation, Provider request and immutable execution snapshot.
const QUOTED_MATERIAL =
  /```[\s\S]*?(?:```|$)|“[^”]*(?:”|$)|「[^」]*(?:」|$)|『[^』]*(?:』|$)|"[^"\r\n]*"|(?<![A-Za-z])'[^'\r\n]*'(?![A-Za-z])/gu;
const MATERIAL_HEADING =
  /^\s*(?:引用|原文|待分析文本|参考文本|故事内容|以下正文|以下原文|quoted text|source text)\s*[：:]/iu;
const ACTION =
  '(?:生成|创作|续写|继续写|润色|改写|重写|修改|扩写|写|总结|摘要|检查|审计|分析|读取|查看|检索|generate|write|compose|continue|polish|rewrite|summarize|summarise|audit|check|analy[sz]e|read|search)';
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
      /^(?:请帮我|请|帮我|我想|我要|但是|但|而是|然而|先|暂时|现在|本次|这次|只需要|只要|只|仅|为本作品|please\b|only\b|but\b)\s*/iu,
    );
    if (!match) return text;
    text = text.slice(match[0].length);
  }
}

function actionIdentity(clause: string): string | undefined {
  const text = stripTaskCourtesy(clause);
  if (!POSITIVE_ACTION.test(text)) return undefined;
  if (/^(?:检查|审计|audit|check)/iu.test(text)) return 'audit';
  if (/^(?:总结|摘要|summari[sz]e)/iu.test(text)) return 'summary';
  if (/^(?:读取|查看|检索|分析|read|search|analy[sz]e)/iu.test(text)) return 'read';
  if (/角色|人物|主角|character/iu.test(text) && !/正文|章节|本章|下一章|chapter/iu.test(text))
    return 'characters';
  if (/大纲|outline/iu.test(text)) return 'outline';
  if (/设定|规则|setting/iu.test(text) && !/正文|章节|本章|chapter/iu.test(text)) return 'settings';
  return /^(?:润色|改写|重写|修改|polish|rewrite)/iu.test(text) ? 'revision' : 'chapter';
}

export function taskGoalDirective(goal: string): { text: string; needsClarification: boolean } {
  const unquoted = goal.replace(QUOTED_MATERIAL, ' ');
  const lines: string[] = [];
  for (const line of unquoted.split(/\r?\n/u)) {
    if (MATERIAL_HEADING.test(line)) break;
    if (/^\s*>/u.test(line)) continue;
    lines.push(line);
  }
  const materialFree = lines.join('\n');
  let negated = false;
  const forbidden = new Set<string>();
  const clauses = materialFree.split(/([，,；;。！？!?\n])/u);
  const kept = clauses.map((clause) => {
    if (!NEGATED_ACTION.test(stripTaskCourtesy(clause))) return clause;
    negated = true;
    const identity = actionIdentity(stripTaskCourtesy(clause).replace(NEGATION_PREFIX, ''));
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
    const identity = actionIdentity(part);
    return identity !== undefined && forbidden.has(identity);
  });
  return {
    text,
    needsClarification:
      contradictory || ALTERNATIVE_ACTIONS.test(text) || (negated && !hasPositiveAction),
  };
}
