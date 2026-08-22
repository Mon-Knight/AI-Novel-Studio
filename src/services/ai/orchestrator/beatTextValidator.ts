import {
  type OrchestratedScene,
  MAX_CONTINUATION_REUSED_RATIO,
  MIN_CONTINUATION_REUSED_CHARS,
  narrativeCharacterCount,
} from './types';

export function meaningfulTerms(value: string, chineseWindow = 3): string[] {
  const terms: string[] = [];
  for (const segment of value.match(/[\u4e00-\u9fff]+|[A-Za-z0-9]{3,}/g) ?? []) {
    if (/^[\u4e00-\u9fff]+$/.test(segment)) {
      if (segment.length <= chineseWindow) {
        terms.push(segment);
      } else {
        for (let index = 0; index <= segment.length - chineseWindow; index += 1) {
          terms.push(segment.slice(index, index + chineseWindow));
        }
      }
    } else {
      terms.push(segment);
    }
  }
  return [...new Set(terms)];
}

export function semanticBeatClauses(beatText: string): string[] {
  return beatText
    .split(/[，,；;。！？!?]+/u)
    .map((clause) => clause.replace(/[“”‘’"']/g, '').trim())
    .filter((clause) => narrativeCharacterCount(clause) >= 4);
}

export type CoverageActionStatus = 'actual' | 'prospective' | 'negated';

export interface CoverageActionFamily {
  id: string;
  terms: readonly string[];
}

export interface CoverageActionSignature {
  family: CoverageActionFamily;
  status: CoverageActionStatus;
  index: number;
}

/**
 * These are domain-neutral narrative actions. Objects, roles, places and lore
 * are deliberately learned from each Beat instead of being encoded here.
 */
export const GENERIC_COVERAGE_ACTIONS: readonly CoverageActionFamily[] = [
  { id: 'arrive', terms: ['抵达', '到达', '赶到', '来到'] },
  {
    id: 'enter',
    terms: ['进入', '走进', '踏入', '跨入', '潜入', '混进', '闯进', '钻进', '进去', '入内'],
  },
  {
    id: 'leave',
    terms: [
      '推门而出',
      '迈出去',
      '转身走',
      '快步走',
      '穿过',
      '走远',
      '下楼',
      '离开',
      '走出',
      '退出',
      '撤离',
      '逃离',
      '脱身',
      '冲出',
      '出去',
    ],
  },
  { id: 'visit', terms: ['走访', '探访', '拜访', '登门', '造访', '上门'] },
  {
    id: 'record',
    terms: [
      '补录',
      '记下',
      '写下',
      '写入',
      '记入',
      '记进',
      '录入',
      '输入',
      '登记',
      '保存',
      '抄下',
      '默记',
      '记住',
      '录下',
    ],
  },
  {
    id: 'touch',
    terms: [
      '摸到',
      '摸向',
      '摸索',
      '触碰',
      '接触',
      '按住',
      '按在',
      '探向',
      '探到',
      '接入',
      '插入',
      '拔开',
    ],
  },
  {
    id: 'inspect',
    terms: ['接受检查', '进行检查', '开始检查', '完成检查', '扫描', '检验', '测试', '启动'],
  },
  {
    id: 'notice',
    terms: [
      '发现',
      '留意',
      '注意到',
      '盯着',
      '注视',
      '望见',
      '认出',
      '察觉',
      '看见',
      '看到',
      '听见',
      '捕捉',
      '确认',
      '指向',
      '显示',
      '表明',
      '意识到',
      '交汇',
      '汇聚',
      '收束',
      '归拢',
      '串起',
      '串联',
    ],
  },
  {
    id: 'alert',
    terms: [
      '警觉',
      '起疑',
      '怀疑',
      '戒备',
      '警惕',
      '察觉',
      '审视',
      '皱眉',
      '盯住',
      '拦住',
      '挡住',
      '目光',
      '视线',
      '打量',
      '追上',
      '追来',
      '逼近',
      '忽然站起',
      '猛地站起',
    ],
  },
  { id: 'restrict', terms: ['封存', '封锁', '锁定', '归档', '禁止', '拦截', '无权限', '无法修改'] },
  {
    id: 'compare',
    terms: [
      '比对',
      '比较',
      '核对',
      '对照',
      '并表',
      '并成',
      '合并',
      '并排',
      '并列',
      '摊开',
      '摊在',
      '列成',
      '列在',
      '共同点',
      '一致',
      '相同',
      '重合',
      '交汇',
      '汇聚',
      '逐行',
      '逐项',
      '对齐',
      '串起',
      '串联',
    ],
  },
  {
    id: 'disguise',
    terms: [
      '伪装',
      '假扮',
      '冒充',
      '假称',
      '乔装',
      '化装',
      '改扮',
      '假名',
      '装作',
      '便装',
      '借口',
      '为由',
    ],
  },
  {
    id: 'announce',
    terms: [
      '告知',
      '通知',
      '宣布',
      '提醒',
      '表示',
      '通告',
      '口径',
      '回答',
      '回应',
      '回复',
      '建议',
      '要求',
      '强调',
      '研判',
      '说明',
      '称',
      '说',
    ],
  },
] as const;

export const COVERAGE_NEGATION =
  /(?:没有|没能|并未|未曾|不曾|从未|不会|不能|无法|未能|拒绝|放弃|停止|取消|并不|不是|没|未|无)[^，,；;。！？!?\n]{0,8}$/u;
export const COVERAGE_PROSPECTIVE =
  /(?:可能|也许|或许|似乎|仿佛|假如|如果|以免|避免|防止|差点|险些|准备|打算|计划|决定|尝试|试图|正要|即将|将要|想要|要去)[^；;。！？!?\n]{0,80}$/u;
export const COVERAGE_NEGATED_SUFFIX = /^(?:失败|未果|被取消|被中止|没有成功|并未发生)/u;
export const COVERAGE_BOUNDARY = /[，,；;。！？!?\n]/u;
export const COVERAGE_SENTENCE_BOUNDARY = /[；;。！？!?\n]/u;
export const COVERAGE_FUNCTION_BIGRAMS = new Set([
  '他的',
  '她的',
  '他们',
  '她们',
  '这个',
  '那个',
  '一个',
  '已经',
  '随后',
  '然后',
  '同时',
  '开始',
  '出现',
]);

export function normalizeBeatCoverageText(value: string): string {
  return value
    .replace(/\s+/gu, '')
    .replace(/[“”‘’"']/gu, '')
    .toLowerCase();
}

export function occurrenceContext(
  value: string,
  index: number,
): { prefix: string; suffix: string } {
  let start = index;
  while (start > 0 && !COVERAGE_SENTENCE_BOUNDARY.test(value[start - 1])) start -= 1;
  return {
    prefix: value.slice(Math.max(start, index - 96), index),
    suffix: value.slice(index, index + 16),
  };
}

export function actionStatusAt(value: string, index: number): CoverageActionStatus {
  const context = occurrenceContext(value, index);
  if (COVERAGE_NEGATION.test(context.prefix) || COVERAGE_NEGATED_SUFFIX.test(context.suffix)) {
    return 'negated';
  }
  return COVERAGE_PROSPECTIVE.test(context.prefix) ? 'prospective' : 'actual';
}

export function actionOccurrences(
  value: string,
  family: CoverageActionFamily,
): Array<{ index: number; end: number; status: CoverageActionStatus }> {
  const occurrences: Array<{ index: number; end: number; status: CoverageActionStatus }> = [];
  for (const term of [...family.terms].sort((left, right) => right.length - left.length)) {
    let cursor = 0;
    while (cursor < value.length) {
      const index = value.indexOf(term, cursor);
      if (index < 0) break;
      occurrences.push({ index, end: index + term.length, status: actionStatusAt(value, index) });
      cursor = index + Math.max(1, term.length);
    }
  }
  if (family.id === 'enter') {
    const singleCharacterEntry =
      /(?:本人|人物|主角|他|她|我|你|者|便|就|要|想|将|再|径直|直接)进(?!行|度|展|程|阶|取|攻|步|化|修|一)(?=[\u4e00-\u9fffA-Za-z0-9])/gu;
    for (const match of value.matchAll(singleCharacterEntry)) {
      const index = match.index + match[0].lastIndexOf('进');
      occurrences.push({ index, end: index + 1, status: actionStatusAt(value, index) });
    }
  }
  if (family.id === 'disguise') {
    const contextualDisguise =
      /(?:以|用)[^，,；;。！？!?\n]{0,16}(?:身份|名义)|(?:假|化)[^，,；;。！？!?\n]{0,8}(?:名字|身份|证件)|换(?:下|上|了)?[^，,；;。！？!?\n]{0,16}(?:衣|衫|裙|袍|褂|甲|帽|发|妆|装束)|看起来像/gu;
    for (const match of value.matchAll(contextualDisguise)) {
      const index = match.index;
      occurrences.push({
        index,
        end: index + match[0].length,
        status: actionStatusAt(value, index),
      });
    }
  }
  return occurrences.sort((left, right) => left.index - right.index || right.end - left.end);
}

export function actionSignatures(value: string): CoverageActionSignature[] {
  const normalized = normalizeBeatCoverageText(value);
  return GENERIC_COVERAGE_ACTIONS.flatMap((family) => {
    const first = actionOccurrences(normalized, family)[0];
    return first ? [{ family, status: first.status, index: first.index }] : [];
  }).sort((left, right) => left.index - right.index);
}

export function requiredCompletedActions(beatText: string): CoverageActionFamily[] {
  const excluded = new Set(['notice', 'alert', 'announce', 'compare', 'arrive']);
  const planned = actionSignatures(beatText).filter(
    (signature) => signature.status === 'prospective' && !excluded.has(signature.family.id),
  );
  const terminal = planned[planned.length - 1];
  return terminal ? [terminal.family] : [];
}

export function beatRequiresCompletedAction(beatText: string): boolean {
  return requiredCompletedActions(beatText).length > 0;
}

export function statusSatisfies(
  required: CoverageActionStatus,
  actual: CoverageActionStatus,
): boolean {
  if (required === 'negated') return actual === 'negated';
  if (required === 'prospective') return actual !== 'negated';
  return actual === 'actual';
}

export const CONTRADICTION_SENSITIVE_ACTION_IDS = new Set(['enter', 'record', 'touch', 'alert']);

export const STRONG_ALERT_TERMS = new Set([
  '起疑',
  '警觉',
  '怀疑',
  '戒备',
  '警惕',
  '察觉',
  '审视',
  '皱眉',
  '拦住',
  '挡住',
  '追上',
  '追来',
  '逼近',
]);

export function alertEvidenceSatisfies(
  occurrence: { index: number; end: number; status: CoverageActionStatus },
  candidate: string,
): boolean {
  const term = candidate.slice(occurrence.index, occurrence.end);
  if (occurrence.status !== 'actual') return false;
  if (STRONG_ALERT_TERMS.has(term)) return true;
  if (!/^(?:目光|视线|盯住|打量)$/u.test(term)) return false;
  const context = candidate.slice(
    Math.max(0, occurrence.index - 32),
    Math.min(candidate.length, occurrence.end + 72),
  );
  return /(?:移到|落在|扫过|停在|盯住|打量|查看|检查|接口|通道|痕迹|手上|缩回|异样|波动|干扰|起身|走近|靠近|拦|挡|追)/u.test(
    context,
  );
}

export function flexibleObservationSatisfies(
  signature: CoverageActionSignature,
  occurrence: { index: number; end: number; status: CoverageActionStatus },
  candidate: string,
): boolean {
  if (signature.status !== 'actual' || occurrence.status !== 'prospective') {
    return false;
  }
  const context = candidate.slice(
    Math.max(0, occurrence.index - 72),
    Math.min(candidate.length, occurrence.end + 96),
  );
  if (['notice', 'alert'].includes(signature.family.id)) {
    return /(?:异样|变化|反应|目光|视线|眉|皱|屏幕|波形|频率|节奏|信号|声音|脚步|门口|走廊|离开|走出|冲出)/u.test(
      context,
    );
  }
  return (
    signature.family.id === 'restrict' &&
    /(?:弹出|显示|屏幕|灰|锁|无法|提示|归档|封存|封锁)/u.test(context)
  );
}

export function implicitCoverageSatisfies(
  signature: CoverageActionSignature,
  clause: string,
  candidate: string,
): boolean {
  if (signature.status === 'negated') return false;
  if (signature.family.id === 'compare') {
    return /(?:并排|并列|并成|摊开|摊在|铺开|摆在|列在|列成|排成|逐行|逐项|一一(?:核对|比对|对齐)|对齐|交汇|汇聚|收束|共同点|唯一(?:的)?共同|放在一起|合在一起|串起|串联|归拢|整理成)[^，,；;。！？!?\n]{0,32}(?:表|记录|证词|案例|名字|地址|时间|症状|共同|交集|同一|诊所|地点|线索|一处|一起|纸|桌)/u.test(
      candidate,
    );
  }
  if (signature.family.id === 'disguise') {
    const contradicted =
      /(?:没有|未|并未|始终没有)[^，,；;。！？!?\n]{0,16}(?:进入|检查|扫描|检测|启用|启动|戴|贴)/u.test(
        candidate,
      );
    return (
      !contradicted &&
      /(?:患者|病人|病历|挂号|失眠|症状|就诊|检查室|检查床|检测椅|躺椅|电极)/u.test(candidate) &&
      /(?:配合|坐下|坐进|躺|贴|戴|接受|检查|扫描|仪器|启动)/u.test(candidate)
    );
  }
  if (signature.family.id === 'notice') {
    const terms = lexicalTerms(clause);
    const matchedTerms = terms.filter((term) => candidate.includes(term)).length;
    const contradicted =
      /(?:没有|未|并未|没能)[^，,；;。！？!?\n]{0,16}(?:发现|留意|注意|看见|看到|听见|捕捉|确认|察觉)/u.test(
        candidate,
      );
    const discoveryCue =
      /(?:唯一|共同|交集|重合|归纳|得出|交汇|汇聚|收束|指向|串起|串联|同一|一致|相同)/u.test(
        candidate,
      );
    return (
      !contradicted &&
      matchedTerms >= (discoveryCue ? 1 : Math.min(2, terms.length)) &&
      /(?:目光|视线|眼|瞳孔|耳|屏幕|波形|频率|节奏|信号|声音|灯|变化|一样|相同|吻合|唯一|共同|交集|重合|归纳|得出)/u.test(
        candidate,
      )
    );
  }
  if (signature.family.id === 'leave') {
    const contradicted =
      /(?:没有|未|并未|始终没有)[^，,；;。！？!?\n]{0,16}(?:离开|走出|出去|下楼|冲出|迈出|推开|拉开)/u.test(
        candidate,
      );
    return (
      !contradicted &&
      /(?:推|拉|打开)[^，,；;。！？!?\n]{0,10}门[^，,；;。！？!?\n]{0,24}(?:走|冲|迈|踏|进入)[^，,；;。！？!?\n]{0,20}(?:夜风|室外|户外|街|巷|人群|阳光|雨|雪)/u.test(
        candidate,
      )
    );
  }
  if (signature.family.id === 'record') {
    return (
      !/(?:没有|未|并未|始终没有)[^，,；;。！？!?\n]{0,16}(?:录进|录到|存进|保存到|写进)/u.test(
        candidate,
      ) && /(?:录进|录到|存进|保存到|写进)/u.test(candidate)
    );
  }
  if (signature.family.id === 'compare') {
    return /(?:并成|列成|整理成|汇成|排成|做成)[^，,；;。！？!?\n]{0,16}(?:表|清单|列表)|逐项(?:核对|对齐|比对)/u.test(
      candidate,
    );
  }
  return false;
}

export const POSITIVE_POLICY_CUE =
  /(?:维稳|涉稳|影响稳定|稳定(?:工作|需要|要求)|理性看待|不要(?:过度)?恐慌|避免(?:引起)?恐慌|统一(?:口径|说法|表述|回复|处理)|同样(?:说法|回复)|反复强调|按流程处理|不用操心|不要乱传|禁止外传|正常现象|官方口径)/gu;

export function hasPositivePolicyCue(candidate: string): boolean {
  for (const match of candidate.matchAll(POSITIVE_POLICY_CUE)) {
    const index = match.index ?? 0;
    let sentenceStart = index;
    while (sentenceStart > 0 && !COVERAGE_SENTENCE_BOUNDARY.test(candidate[sentenceStart - 1])) {
      sentenceStart -= 1;
    }
    const prefix = candidate.slice(sentenceStart, index);
    if (/(?:想起|回想|记起|那句|提到|曾经|听说|转述)/u.test(prefix)) continue;
    if (/(?:没有|未|并未|不曾|无)[^，,；;。！？!?\n]{0,20}$/u.test(prefix)) continue;
    return true;
  }
  return false;
}

export function requiredSemanticAnchorsCovered(clause: string, candidate: string): boolean {
  if (/(?:口径|统一说法|统一表述)/u.test(clause)) {
    if (!hasPositivePolicyCue(candidate)) return false;
    if (
      /(?:没有|未|并未|不曾|无)[^，,；;。！？!?\n]{0,20}(?:提出|出现|提供|形成|统一)?[^，,；;。！？!?\n]{0,12}(?:口径|维稳|涉稳|稳定|恐慌|说法|表述)/u.test(
        candidate,
      ) &&
      !hasPositivePolicyCue(
        candidate.replace(
          /(?:没有|未|并未|不曾|无)[^，,；;。！？!?\n]{0,20}(?:提出|出现|提供|形成|统一)?[^，,；;。！？!?\n]{0,12}(?:口径|维稳|涉稳|稳定|恐慌|说法|表述)/gu,
          '',
        ),
      )
    ) {
      return false;
    }
  }
  return true;
}

export function lexicalTerms(value: string): string[] {
  return meaningfulTerms(normalizeBeatCoverageText(value), 2).filter(
    (term) => !COVERAGE_FUNCTION_BIGRAMS.has(term),
  );
}

export function lexicalEvidenceCount(clause: string, candidate: string): number {
  const terms = lexicalTerms(clause);
  return terms.filter((term) => candidate.includes(term)).length;
}

export function visitEstablishedByPresence(clause: string, candidate: string): boolean {
  if (lexicalEvidenceCount(clause, candidate) < 1) return false;
  const contradicted = ['visit', 'arrive', 'enter'].some((id) => {
    const family = GENERIC_COVERAGE_ACTIONS.find((action) => action.id === id);
    return family
      ? actionOccurrences(candidate, family).some((occurrence) => occurrence.status === 'negated')
      : false;
  });
  if (
    contradicted ||
    /(?:门外|屋外|室外|场外|远处|远远|隔着)/u.test(candidate) ||
    /(?:没有|未|并未|只)[^，,；;。！？!?\n]{0,12}(?:走近|靠近|接近|交谈|说话|询问|拜访|走访|见面)/u.test(
      candidate,
    ) ||
    /(?:没有|未|并未)[^，,；;。！？!?\n]{0,20}(?:见到|见面|上楼|敲门)/u.test(candidate)
  ) {
    return false;
  }
  if (
    !/(?:家(?:中|里)?|住处|住所|屋里|屋内|房间|现场|营地|办公室|店内|舱内|门槛)/u.test(candidate)
  ) {
    return false;
  }
  const arrive = GENERIC_COVERAGE_ACTIONS.find((action) => action.id === 'arrive');
  return (
    /(?:见我来了|我来了|我来|来到|迎接|招呼|交谈|询问|问|递给|让座|走近|靠近|蹲下|坐下|给[^，,；;。！？!?\n]{0,12}(?:倒|递|拿|端))/u.test(
      candidate,
    ) ||
    Boolean(
      arrive &&
      actionOccurrences(candidate, arrive).some((occurrence) => occurrence.status === 'actual'),
    )
  );
}

export function clauseCoveredByCandidate(clause: string, candidate: string): boolean {
  const normalizedClause = normalizeBeatCoverageText(clause);
  const normalizedCandidate = normalizeBeatCoverageText(candidate);
  const signatures = actionSignatures(normalizedClause);

  for (const signature of signatures) {
    const occurrences = actionOccurrences(normalizedCandidate, signature.family);
    if (
      signature.family.id === 'alert' &&
      signature.status === 'actual' &&
      !occurrences.some(
        (occurrence) =>
          alertEvidenceSatisfies(occurrence, normalizedCandidate) ||
          flexibleObservationSatisfies(signature, occurrence, normalizedCandidate),
      )
    ) {
      return false;
    }
    if (
      occurrences.some(
        (occurrence) =>
          statusSatisfies(signature.status, occurrence.status) ||
          flexibleObservationSatisfies(signature, occurrence, normalizedCandidate),
      )
    ) {
      continue;
    }
    if (
      signature.family.id === 'visit' &&
      signature.status !== 'negated' &&
      !occurrences.some((occurrence) => occurrence.status === 'negated') &&
      visitEstablishedByPresence(normalizedClause, normalizedCandidate)
    ) {
      continue;
    }
    if (
      !occurrences.some((occurrence) => occurrence.status === 'negated') &&
      implicitCoverageSatisfies(signature, normalizedClause, normalizedCandidate)
    ) {
      continue;
    }
    return false;
  }

  const terms = lexicalTerms(normalizedClause);
  if (!terms.length) return signatures.length > 0;
  const matchedTerms = terms.filter((term) => normalizedCandidate.includes(term)).length;
  const requiredMatches =
    signatures.length >= 2
      ? 0
      : signatures.length === 1
        ? Math.min(1, terms.length)
        : Math.min(2, terms.length);
  if (matchedTerms < requiredMatches) return false;

  if (
    signatures.length === 0 &&
    !COVERAGE_NEGATION.test(normalizedClause) &&
    /(?:没有|并未|未曾|不曾|从未|未能|无法)/u.test(normalizedCandidate) &&
    matchedTerms < Math.min(3, terms.length)
  ) {
    return false;
  }
  return requiredSemanticAnchorsCovered(normalizedClause, normalizedCandidate);
}

export function clauseCoverageEnd(
  normalizedText: string,
  clause: string,
  fromIndex: number,
  minimumEnd = fromIndex,
): number | undefined {
  const boundaries: number[] = [];
  for (let index = fromIndex; index < normalizedText.length; index += 1) {
    if (COVERAGE_BOUNDARY.test(normalizedText[index])) boundaries.push(index + 1);
  }
  if (boundaries[boundaries.length - 1] !== normalizedText.length)
    boundaries.push(normalizedText.length);
  return boundaries.find(
    (end) =>
      end > minimumEnd && clauseCoveredByCandidate(clause, normalizedText.slice(fromIndex, end)),
  );
}

export function previousCoverageBoundary(value: string, beforeIndex: number): number {
  let index = Math.max(0, beforeIndex - 1);
  while (index > 0 && !COVERAGE_SENTENCE_BOUNDARY.test(value[index - 1])) index -= 1;
  return index;
}

export function clauseCoverageEnds(
  normalizedText: string,
  clause: string,
  fromIndex: number,
  minimumEnd: number,
): number[] {
  const endSet = new Set<number>();
  for (let index = fromIndex; index < normalizedText.length; index += 1) {
    if (COVERAGE_BOUNDARY.test(normalizedText[index])) endSet.add(index + 1);
  }
  const normalizedClause = normalizeBeatCoverageText(clause);
  const terms = [
    ...lexicalTerms(normalizedClause),
    ...actionSignatures(normalizedClause).flatMap((signature) => signature.family.terms),
  ];
  for (const term of terms) {
    let cursor = fromIndex;
    while (cursor < normalizedText.length) {
      const index = normalizedText.indexOf(term, cursor);
      if (index < 0) break;
      endSet.add(index + term.length);
      cursor = index + Math.max(1, term.length);
    }
  }
  endSet.add(normalizedText.length);
  return [...endSet]
    .sort((left, right) => left - right)
    .filter(
      (end) =>
        end > minimumEnd && clauseCoveredByCandidate(clause, normalizedText.slice(fromIndex, end)),
    );
}

export function hasCompleteOrderedCoverage(
  normalizedText: string,
  clauses: readonly string[],
  clauseIndex: number,
  cursor: number,
  memo: Map<string, boolean>,
): boolean {
  if (clauseIndex >= clauses.length) return true;
  const key = `${clauseIndex}:${cursor}`;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  const clause = clauses[clauseIndex];
  if (clauseHasUnresolvedContradiction(clause, normalizedText)) {
    memo.set(key, false);
    return false;
  }
  const searchStart = previousCoverageBoundary(normalizedText, cursor);
  for (const end of clauseCoverageEnds(normalizedText, clause, searchStart, cursor)) {
    if (hasCompleteOrderedCoverage(normalizedText, clauses, clauseIndex + 1, end, memo)) {
      memo.set(key, true);
      return true;
    }
  }
  memo.set(key, false);
  return false;
}

export function clauseHasUnresolvedContradiction(clause: string, fullText: string): boolean {
  const terms = lexicalTerms(clause);
  return actionSignatures(clause).some((signature) => {
    if (
      signature.status === 'negated' ||
      !CONTRADICTION_SENSITIVE_ACTION_IDS.has(signature.family.id)
    ) {
      return false;
    }
    const occurrences = actionOccurrences(fullText, signature.family);
    if (signature.family.id === 'alert') {
      const strong = occurrences.filter((occurrence) =>
        /^(?:起疑|警觉|怀疑|戒备|警惕|察觉|审视|皱眉|拦住|挡住|追上|追来|逼近|忽然站起|猛地站起)$/u.test(
          fullText.slice(occurrence.index, occurrence.end),
        ),
      );
      if (strong.length > 0 && strong[strong.length - 1]?.status === 'negated') return true;
    }
    const relevant = occurrences.filter((occurrence) => {
      const context = fullText.slice(
        Math.max(0, occurrence.index - 64),
        Math.min(fullText.length, occurrence.end + 64),
      );
      const matched = terms.filter((term) => context.includes(term)).length;
      return matched >= Math.min(1, terms.length);
    });
    if (signature.family.id === 'enter' && relevant.some((item) => item.status === 'negated')) {
      return true;
    }
    return relevant.length > 0 && relevant[relevant.length - 1]?.status === 'negated';
  });
}

export function missingBeatClauses(normalized: string, beatText: string): string[] {
  const normalizedText = normalizeBeatCoverageText(normalized);
  const clauses = semanticBeatClauses(beatText);
  if (!clauses.length) return [];
  if (hasCompleteOrderedCoverage(normalizedText, clauses, 0, 0, new Map())) return [];

  const missing: string[] = [];
  let cursor = 0;
  for (const clause of clauses) {
    const searchStart = previousCoverageBoundary(normalizedText, cursor);
    const end = clauseCoverageEnd(normalizedText, clause, searchStart, cursor);
    if (end === undefined) {
      missing.push(clause);
      continue;
    }
    if (clauseHasUnresolvedContradiction(clause, normalizedText)) {
      missing.push(clause);
    }
    cursor = end;
  }
  return missing;
}

export function beatCovered(normalized: string, beatText: string): boolean {
  return missingBeatClauses(normalized, beatText).length === 0;
}

export function externalRepairBeatCovered(normalized: string, beatText: string): boolean {
  if (!beatCovered(normalized, beatText)) return false;
  const text = normalizeBeatCoverageText(normalized);
  return requiredCompletedActions(beatText).every((family) =>
    actionOccurrences(text, family).some((occurrence) => occurrence.status === 'actual'),
  );
}

export function normalizedParagraphs(text: string): Array<{ raw: string; normalized: string }> {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((raw) => ({ raw: raw.trim(), normalized: raw.replace(/\s+/g, '') }))
    .filter((paragraph) => paragraph.normalized.length > 0);
}

export function normalizedTextWithRawEnds(text: string): { normalized: string; rawEnds: number[] } {
  let normalized = '';
  const rawEnds: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (/\s/.test(character)) continue;
    normalized += character;
    rawEnds.push(index + 1);
  }
  return { normalized, rawEnds };
}

export function trimNormalizedBoundaryOverlap(
  existingText: string,
  continuationText: string,
): { text: string; overlap: number } {
  const existing = normalizedTextWithRawEnds(existingText);
  const continuation = normalizedTextWithRawEnds(continuationText);
  let overlap = Math.min(existing.normalized.length, continuation.normalized.length);
  while (overlap >= 12) {
    if (existing.normalized.slice(-overlap) === continuation.normalized.slice(0, overlap)) {
      return {
        text: continuationText.slice(continuation.rawEnds[overlap - 1]).trimEnd(),
        overlap,
      };
    }
    overlap -= 1;
  }
  return { text: continuationText.trim(), overlap: 0 };
}

export function validateSceneRepetition(text: string, sceneNo: number): void {
  const normalizedText = text.replace(/\s+/g, '');
  const paragraphs = normalizedParagraphs(text).filter(
    (paragraph) => paragraph.normalized.length >= 12,
  );
  const counts = new Map<string, number>();
  for (const paragraph of paragraphs) {
    counts.set(paragraph.normalized, (counts.get(paragraph.normalized) ?? 0) + 1);
  }
  let duplicateChars = 0;
  let maxLongRepeat = 1;
  for (const [paragraph, count] of counts) {
    if (count <= 1) continue;
    duplicateChars += paragraph.length * (count - 1);
    if (paragraph.length >= 24) maxLongRepeat = Math.max(maxLongRepeat, count);
  }
  const duplicateRatio = duplicateChars / Math.max(1, normalizedText.length);
  if (maxLongRepeat >= 3 || (duplicateChars >= 160 && duplicateRatio >= 0.18)) {
    throw new Error('Scene ' + sceneNo + ' 出现大段循环重复，未采纳。');
  }
}

export function validateBeatNovelty(
  acceptedChapterPrefix: string,
  currentText: string,
  sceneNo: number,
  beatOrder: number,
): void {
  const acceptedNormalized = acceptedChapterPrefix.replace(/\s+/g, '');
  if (!acceptedNormalized) return;
  const paragraphs = normalizedParagraphs(currentText).filter(
    (paragraph) => paragraph.normalized.length >= 12,
  );
  const totalChars = paragraphs.reduce((sum, paragraph) => sum + paragraph.normalized.length, 0);
  const reusedChars = paragraphs.reduce(
    (sum, paragraph) =>
      sum + (acceptedNormalized.includes(paragraph.normalized) ? paragraph.normalized.length : 0),
    0,
  );
  if (
    reusedChars >= MIN_CONTINUATION_REUSED_CHARS &&
    reusedChars / Math.max(1, totalChars) >= MAX_CONTINUATION_REUSED_RATIO
  ) {
    throw new Error(`Scene ${sceneNo} / Beat ${beatOrder} 大面积重复已接受的前文，未采纳。`);
  }
}

export function validateSceneText(
  text: string,
  scene: {
    sceneNo: number;
    beats: ReadonlyArray<{ text: string; required: boolean }>;
  },
  finishReason?: string,
  minimumCharacters?: number,
  maximumCharacters?: number,
): void {
  const normalized = text.trim();
  if (!normalized) throw new Error('Scene ' + scene.sceneNo + ' 返回空正文。');
  if (normalized.includes('<think>') || normalized.includes('</think>')) {
    throw new Error('Scene ' + scene.sceneNo + ' 返回了思考过程，未采纳。');
  }
  if (finishReason === 'length') {
    throw new Error('Scene ' + scene.sceneNo + ' 在输出上限处截断，未采纳。');
  }
  const metaLeakage = normalizedParagraphs(normalized).find((paragraph) =>
    /(?:互动基调|短期目标|为后续.{0,12}铺垫|本章目标|场景目标|写作要求|提纲)/.test(
      paragraph.normalized,
    ),
  );
  if (metaLeakage) {
    throw new Error('Scene ' + scene.sceneNo + ' 混入了提纲或写作指令，未采纳。');
  }
  const copiedBeatInstruction = scene.beats.find((beat) => {
    const instruction = beat.text.replace(/\s+/g, '');
    return (
      instruction.length >= 12 &&
      normalizedParagraphs(normalized).some((paragraph) => paragraph.normalized === instruction)
    );
  });
  if (copiedBeatInstruction) {
    throw new Error('Scene ' + scene.sceneNo + ' 原样输出了 Beat 规划句，未采纳。');
  }
  if (/(?:（?本章完）?|（?全文完）?)/.test(normalized)) {
    throw new Error('Scene ' + scene.sceneNo + ' 提前输出章节结束标记，未采纳。');
  }
  const characterCount = narrativeCharacterCount(normalized);
  if (minimumCharacters && minimumCharacters > 0 && characterCount < minimumCharacters) {
    throw new Error(
      'Scene ' + scene.sceneNo + ' 正文不足最低篇幅 ' + minimumCharacters + ' 字，未采纳。',
    );
  }
  if (maximumCharacters && maximumCharacters > 0 && characterCount > maximumCharacters) {
    throw new Error(
      'Scene ' + scene.sceneNo + ' 正文超过最高篇幅 ' + maximumCharacters + ' 字，未采纳。',
    );
  }
  validateSceneRepetition(normalized, scene.sceneNo);
  const required = scene.beats.filter((beat) => beat.required);
  const missing = required
    .map((beat) => ({ beat, clauses: missingBeatClauses(normalized, beat.text) }))
    .filter((item) => item.clauses.length > 0);
  if (missing.length > 0) {
    throw new Error(
      'Scene ' +
        scene.sceneNo +
        ' 未覆盖必需 Beat：' +
        missing
          .map(
            ({ beat, clauses }) =>
              beat.text + (clauses.length ? `（缺少分句：${clauses.join(' / ')}）` : ''),
          )
          .join('；') +
        '，未采纳。',
    );
  }
}

export function stateAnchorTerms(
  scene: Pick<OrchestratedScene, 'result' | 'transition' | 'expectedEndState'>,
): string[] {
  return meaningfulTerms(
    [scene.result, scene.transition, scene.expectedEndState].filter(Boolean).join(' '),
  );
}

export function validateSceneContinuity(
  previous: Pick<OrchestratedScene, 'result' | 'transition' | 'expectedEndState'>,
  currentText: string,
): void {
  const anchors = stateAnchorTerms(previous);
  if (!anchors.length) return;
  const normalized = currentText.trim();
  if (!anchors.some((anchor) => normalized.includes(anchor))) {
    throw new Error('当前 Scene 未承接上一 Scene 的结果、转场或预期结束状态，未采纳。');
  }
}

export function mergeSceneContinuation(
  existingText: string,
  continuationText: string,
  sceneNo: number,
): string {
  const existing = normalizedParagraphs(existingText);
  const boundary = trimNormalizedBoundaryOverlap(existingText, continuationText);
  let continuation = normalizedParagraphs(boundary.text);
  if (!continuation.length) throw new Error('Scene ' + sceneNo + ' 续写返回空正文。');

  let boundaryOverlap = Math.min(existing.length, continuation.length);
  while (boundaryOverlap > 0) {
    const existingStart = existing.length - boundaryOverlap;
    const matches = continuation
      .slice(0, boundaryOverlap)
      .every(
        (paragraph, index) => paragraph.normalized === existing[existingStart + index]?.normalized,
      );
    if (matches) break;
    boundaryOverlap -= 1;
  }
  if (boundaryOverlap > 0) continuation = continuation.slice(boundaryOverlap);
  if (!continuation.length) {
    throw new Error('Scene ' + sceneNo + ' 续写只重复了已有正文，未采纳。');
  }

  const existingNormalized = existingText.replace(/\s+/g, '');
  const eligible = continuation.filter((paragraph) => paragraph.normalized.length >= 8);
  const totalChars = eligible.reduce((sum, paragraph) => sum + paragraph.normalized.length, 0);
  const reusedChars = eligible.reduce(
    (sum, paragraph) =>
      sum + (existingNormalized.includes(paragraph.normalized) ? paragraph.normalized.length : 0),
    0,
  );
  if (
    reusedChars >= MIN_CONTINUATION_REUSED_CHARS &&
    reusedChars / Math.max(1, totalChars) >= MAX_CONTINUATION_REUSED_RATIO
  ) {
    throw new Error('Scene ' + sceneNo + ' 续写大面积重复已有正文，未采纳。');
  }

  const addition = continuation.map((paragraph) => paragraph.raw).join('\n\n');
  return boundary.overlap > 0
    ? existingText.trimEnd() + boundary.text
    : existingText.trim() + '\n\n' + addition;
}

export function pendingSceneBeats(sceneText: string, scene: OrchestratedScene): string[] {
  return scene.beats
    .filter((beat) => beat.required && !beatCovered(sceneText, beat.text))
    .map((beat) => beat.text);
}
