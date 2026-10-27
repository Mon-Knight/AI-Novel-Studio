import type {
  WorldParameterKey,
  WorldRuleChange,
  WorldRuleChangeImpact,
  WorldRuleDocument,
} from '../../types/worldRules';
import {
  parseWorldRuleDocument,
  WORLD_PARAMETER_DIRECTORY,
  WORLD_RULE_KIND_LABELS,
} from '../../services/worldRules/worldRuleSchema';

export const WORLD_PARAMETER_EXAMPLES: Record<WorldParameterKey, string> = {
  time_history: '例如：铁路通车前十年的秋收；王朝纪年与章号分开写',
  space_environment: '例如：港口到内陆驿站通常两昼夜；雨季土路会断',
  institutions_power: '例如：谁有权封港；议会决议能否越过总督；章程是否约束雇佣兵',
  economy_resources: '例如：淡水按户配额；军粮只够三日；夜航要另购灯油',
  technology_infrastructure: '例如：岸上有线电报，船上只有旗语；没有即时远距通信',
  culture_daily_life: '例如：丧事不过夜；学徒满三年才能独立接活',
  information_knowledge: '例如：码头工人只见到封港告示，不知道真正原因',
  conflict_boundaries: '例如：不得无铺垫地让角色瞬间抵达对岸',
};

export const CHARACTER_BELIEF_HINT =
  '这条写角色相信或误认的内容，不等于世界已经成立的事实。认知状态可以保持未定；未知或 N/A 可留。';

const CODE_LABELS: Record<string, string> = {
  RULE_DEPENDENCY_MISSING: '缺少当前作品中的显式依赖',
  RULE_DELETE_DEPENDENCY: '其他规则显式依赖本条，不能直接删除',
};

const CERTAINTY_LABELS: Record<string, string> = {
  potential_impact: '可能受影响，尚未证明矛盾',
  verified_reference: '已核对的引用冲突，确认不能覆盖',
  potentially_stale: '候选可能因规则集变化而失效',
};

const EPISTEMIC_LABELS: Record<WorldRuleDocument['epistemic']['status'], string> = {
  uncertain: '未定',
  established: '已知',
  disputed: '争议',
  belief: '角色相信',
};

export function isFilledText(value: string | undefined | null): boolean {
  return Boolean(value?.trim());
}

export function isFilledList(values: string[] | undefined): boolean {
  return Boolean(values?.some((item) => item.trim()));
}

function clip(value: string, max = 48): string {
  const text = value.trim();
  if (Array.from(text).length <= max) return text;
  return Array.from(text).slice(0, max).join('') + '…';
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export interface StructureAspect {
  key: 'kind' | 'scope' | 'boundaries' | 'epistemic' | 'parameters';
  label: string;
  determined: boolean;
  value: string;
}

export interface WorldRuleStructureSummary {
  status: 'absent' | 'valid' | 'retained';
  notice: string;
  aspects: StructureAspect[];
  parameterFilled: number;
  parameterTotal: number;
  filledParameterLabels: string[];
  gaps: string[];
}

function parameterState(document: WorldRuleDocument): {
  filled: number;
  labels: string[];
} {
  const labels = WORLD_PARAMETER_DIRECTORY.filter((item) =>
    isFilledText(document.worldParameters[item.key]),
  ).map((item) => item.label);
  return { filled: labels.length, labels };
}

function scopeDetermined(document: WorldRuleDocument): boolean {
  return (
    isFilledText(document.scope.summary) ||
    isFilledList(document.scope.chapterIds) ||
    isFilledList(document.scope.places) ||
    isFilledList(document.scope.groups) ||
    isFilledList(document.scope.characters)
  );
}

function boundariesDetermined(document: WorldRuleDocument): boolean {
  return (
    isFilledText(document.boundaries.limitations) ||
    isFilledText(document.boundaries.cost) ||
    isFilledText(document.boundaries.ceiling)
  );
}

function epistemicDetermined(document: WorldRuleDocument): boolean {
  return (
    document.epistemic.status !== 'uncertain' ||
    isFilledList(document.epistemic.knownBy) ||
    isFilledText(document.epistemic.learnedAt) ||
    isFilledText(document.epistemic.evidence)
  );
}

export function summarizeWorldRule(structuredJson?: string | null): WorldRuleStructureSummary {
  const parsed = parseWorldRuleDocument(structuredJson);
  if (parsed.status === 'absent') {
    return {
      status: 'absent',
      notice: '尚未补充结构化说明，可按当前情节逐步填写。',
      aspects: [
        { key: 'kind', label: '性质', determined: false, value: '未定' },
        { key: 'scope', label: '范围', determined: false, value: '未定' },
        { key: 'boundaries', label: '限制/代价', determined: false, value: '未定' },
        { key: 'epistemic', label: '认知', determined: false, value: '未定' },
        { key: 'parameters', label: '八类参数', determined: false, value: '未填 0/8' },
      ],
      parameterFilled: 0,
      parameterTotal: WORLD_PARAMETER_DIRECTORY.length,
      filledParameterLabels: [],
      gaps: [
        '范围、限制/代价和角色知情情况可按当前情节再补；未知可留空或填 N/A。',
        '八类世界参数可按制度权力、路线时间、资源代价、谁知道等按需展开，不是必填百科。',
      ],
    };
  }
  if (parsed.status !== 'valid') {
    return {
      status: 'retained',
      notice: '既有结构化材料已原样保留，当前不按新格式拆开展示。',
      aspects: [],
      parameterFilled: 0,
      parameterTotal: WORLD_PARAMETER_DIRECTORY.length,
      filledParameterLabels: [],
      gaps: ['如需按当前格式整理，请在编辑时逐步填写；原文不会被覆盖。'],
    };
  }
  const document = parsed.document;
  const parameters = parameterState(document);
  const kindLabel = WORLD_RULE_KIND_LABELS[document.kind] ?? document.kind;
  const aspects: StructureAspect[] = [
    { key: 'kind', label: '性质', determined: true, value: kindLabel },
    {
      key: 'scope',
      label: '范围',
      determined: scopeDetermined(document),
      value: scopeDetermined(document) ? clip(document.scope.summary || '已填写范围条目') : '未定',
    },
    {
      key: 'boundaries',
      label: '限制/代价',
      determined: boundariesDetermined(document),
      value: boundariesDetermined(document)
        ? clip(
            [document.boundaries.limitations, document.boundaries.cost, document.boundaries.ceiling]
              .filter((item) => item.trim())
              .join('；'),
          )
        : '未定',
    },
    {
      key: 'epistemic',
      label: '认知',
      determined: epistemicDetermined(document),
      value: epistemicDetermined(document)
        ? [
            EPISTEMIC_LABELS[document.epistemic.status],
            document.epistemic.knownBy.filter((item) => item.trim()).length
              ? '知情 ' + document.epistemic.knownBy.filter((item) => item.trim()).join('、')
              : '',
          ]
            .filter(Boolean)
            .join(' · ')
        : '未定',
    },
    {
      key: 'parameters',
      label: '八类参数',
      determined: parameters.filled > 0,
      value:
        parameters.filled > 0
          ? '已填 ' + parameters.filled + '/8（' + parameters.labels.join('、') + '）'
          : '未填 0/8',
    },
  ];
  const gaps: string[] = [];
  if (!scopeDetermined(document)) gaps.push('范围尚未写明，可按当前情节再补；未知可留空或填 N/A。');
  if (!boundariesDetermined(document)) gaps.push('限制或代价尚未写明，需要时再补，不当作错误。');
  if (!epistemicDetermined(document))
    gaps.push('角色知情情况尚未写明，可保持未定，不表示世界事实缺失。');
  if (parameters.filled === 0)
    gaps.push('八类世界参数尚未填写，可按制度权力、路线时间、资源代价、谁知道等按需展开。');
  else if (parameters.filled < WORLD_PARAMETER_DIRECTORY.length)
    gaps.push('其余世界参数可按需补充，不必一次填完。');
  return {
    status: 'valid',
    notice: '结构化说明按已填项摘要如下；未定项是待补缺口，不是校验失败。',
    aspects,
    parameterFilled: parameters.filled,
    parameterTotal: WORLD_PARAMETER_DIRECTORY.length,
    filledParameterLabels: parameters.labels,
    gaps,
  };
}

export function describeProposedChange(change: WorldRuleChange): { action: string; body: string } {
  const action =
    change.operation === 'delete'
      ? '永久删除此条（不自动改写已采用正文）'
      : change.isActive
        ? '保存并启用此条'
        : '保存并停用此条（保留历史来源）';
  const body = [
    change.title,
    change.content,
    change.forbiddenRules ? '禁止项：' + change.forbiddenRules : '',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { action, body };
}

export function describeImpactFact(item: Record<string, unknown>): string {
  const code = textOf(item.code);
  const title = textOf(item.title);
  const evidence = textOf(item.evidence) || textOf(item.reason);
  const ruleId = textOf(item.ruleId);
  const chapterId = textOf(item.chapterId);
  const certainty = textOf(item.certainty);
  const parts = [
    CODE_LABELS[code] || (code ? '事项 ' + code : ''),
    title ? '「' + title + '」' : '',
    ruleId ? '对象 ' + ruleId : '',
    chapterId ? '章节 ' + chapterId : '',
    evidence,
    CERTAINTY_LABELS[certainty] || '',
  ].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return '一项影响记录缺少可展示说明，请核对预览身份后由作者判断。';
}

function factKey(item: Record<string, unknown>): string {
  return [item.code, item.ruleId, item.chapterId, item.evidence, item.reason].map(String).join('|');
}

export function listPotentialImpact(impact: WorldRuleChangeImpact): string[] {
  const blockingKeys = new Set(impact.blockingConflicts.map(factKey));
  const chapters = impact.affectedChapters.map((chapter) => {
    const evidence = chapter.evidence.trim() || '已有采用稿，变更可能影响正史。';
    return (
      '采用章「' +
      chapter.title +
      '」（采用稿 ' +
      chapter.adoptedDraftId +
      '）：' +
      evidence +
      ' 这是潜在影响，不是已证明的矛盾。'
    );
  });
  const dependents = impact.dependentRules
    .filter((item) => !blockingKeys.has(factKey(item)))
    .map(describeImpactFact);
  return [
    ...chapters,
    ...dependents,
    ...impact.uncertainty.map((note) => note.trim()).filter(Boolean),
  ];
}

export function listBlockingImpact(impact: WorldRuleChangeImpact): string[] {
  return impact.blockingConflicts.map((item) => {
    const fact = describeImpactFact(item);
    return /不能|禁止|阻断/.test(fact) ? fact : fact + ' 此项会阻断保存，确认无法覆盖。';
  });
}
