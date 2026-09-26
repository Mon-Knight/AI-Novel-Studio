import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createWorldRuleDocument,
  serializeWorldRuleDocument,
} from '../../services/worldRules/worldRuleSchema';
import type { WorldRuleChange, WorldRuleChangeImpact } from '../../types/worldRules';
import {
  CHARACTER_BELIEF_HINT,
  WORLD_PARAMETER_EXAMPLES,
  describeImpactFact,
  describeProposedChange,
  listBlockingImpact,
  listPotentialImpact,
  summarizeWorldRule,
} from './worldRulePresentation';

test('empty structured json yields undetermined aspects and neutral gaps, not errors', () => {
  const summary = summarizeWorldRule(undefined);
  assert.equal(summary.status, 'absent');
  assert.match(summary.notice, /逐步填写/);
  assert.equal(
    summary.aspects.every((aspect) => !aspect.determined),
    true,
  );
  assert.ok(summary.gaps.length >= 2);
  assert.equal(
    summary.gaps.every((gap) => !/错误|失败|校验/.test(gap)),
    true,
  );
  assert.equal(summary.parameterFilled, 0);
});

test('valid document reports determined nature/scope/boundary/cognition and eight-parameter fill', () => {
  const document = createWorldRuleDocument('rule-1', '渡船须等待可通航潮位。', 'social_norm');
  document.scope.summary = '普通民船';
  document.boundaries.cost = '赔偿并接受调查';
  document.epistemic.status = 'belief';
  document.epistemic.knownBy = ['当值船长'];
  document.worldParameters.institutions_power = '港务可封港，人物仍可违令';
  document.worldParameters.economy_resources = 'N/A';
  const summary = summarizeWorldRule(serializeWorldRuleDocument(document));
  assert.equal(summary.status, 'valid');
  const byKey = Object.fromEntries(summary.aspects.map((aspect) => [aspect.key, aspect]));
  assert.equal(byKey.kind.determined, true);
  assert.equal(byKey.kind.value, '社会规范');
  assert.equal(byKey.scope.determined, true);
  assert.equal(byKey.boundaries.determined, true);
  assert.equal(byKey.epistemic.determined, true);
  assert.match(byKey.epistemic.value, /角色相信/);
  assert.equal(byKey.parameters.determined, true);
  assert.equal(summary.parameterFilled, 2);
  assert.deepEqual(summary.filledParameterLabels, ['制度与权力', '经济与资源']);
  assert.ok(summary.gaps.some((gap) => /按需补充/.test(gap)));
  assert.equal(
    summary.gaps.some((gap) => /错误/.test(gap)),
    false,
  );
});

test('legacy json is retained verbatim in the summary and not treated as a validation error', () => {
  const summary = summarizeWorldRule('{"legacy":{"weather":"寒冬"}}');
  assert.equal(summary.status, 'retained');
  assert.match(summary.notice, /原样保留/);
  assert.equal(summary.aspects.length, 0);
  assert.match(summary.gaps[0] ?? '', /不会被覆盖/);
});

test('eight parameter examples cover institution, route/time, cost and knowledge without famous-work proper nouns', () => {
  assert.match(WORLD_PARAMETER_EXAMPLES.institutions_power, /封港|议会|章程/);
  assert.match(WORLD_PARAMETER_EXAMPLES.time_history, /铁路|纪年/);
  assert.match(WORLD_PARAMETER_EXAMPLES.economy_resources, /配额|军粮/);
  assert.match(WORLD_PARAMETER_EXAMPLES.information_knowledge, /告示|不知道/);
  const joined = Object.values(WORLD_PARAMETER_EXAMPLES).join(' ');
  assert.doesNotMatch(joined, /霍格沃茨|魔法部|纳尼亚|中土|阿拉贡/);
  assert.match(CHARACTER_BELIEF_HINT, /不等于世界已经成立的事实/);
});

test('proposed change names enable, disable and delete without rewriting user prose', () => {
  const base: WorldRuleChange = {
    targetType: 'rule_system',
    title: '渡航规则',
    content: '普通渡船必须等待可通航的潮位。',
    isActive: true,
  };
  assert.equal(describeProposedChange(base).action, '保存并启用此条');
  assert.equal(
    describeProposedChange({ ...base, isActive: false }).action,
    '保存并停用此条（保留历史来源）',
  );
  assert.equal(
    describeProposedChange({ ...base, operation: 'delete' }).action,
    '永久删除此条（不自动改写已采用正文）',
  );
  assert.equal(describeProposedChange(base).body.includes(base.content), true);
});

test('impact lists potential chapters in human language and blocking codes without JSON dumps', () => {
  const impact: WorldRuleChangeImpact = {
    novelId: 'novel-1',
    ruleSetFingerprint: 'fp-abc',
    previewHash: 'hash-xyz',
    sources: [{ sourceId: 's1' }],
    affectedChapters: [
      {
        chapterId: 'c1',
        title: '第一章 渡口',
        adoptedDraftId: 'd1',
        evidence: '该章已有采用稿；世界规则变更可能影响正史，需要作者核对，不代表已证明矛盾',
        certainty: 'potential_impact',
      },
    ],
    dependentRules: [
      {
        code: 'RULE_DELETE_DEPENDENCY',
        ruleId: 'rule-2',
        certainty: 'verified_reference',
        evidence: '此规则显式依赖待删除资产，请先修订依赖或选择停用。',
      },
    ],
    blockingConflicts: [
      {
        code: 'RULE_DEPENDENCY_MISSING',
        ruleId: 'missing-1',
        certainty: 'verified_reference',
        reason: '依赖规则不属于当前作品；请先修订依赖，不可用作者确认覆盖',
      },
    ],
    uncertainty: ['影响范围采用保守估计'],
    requiresConfirmation: true,
  };
  const potential = listPotentialImpact(impact);
  const blocking = listBlockingImpact(impact);
  assert.ok(
    potential.some((item) => item.includes('第一章 渡口') && item.includes('不是已证明的矛盾')),
  );
  assert.ok(potential.some((item) => item.includes('保守估计')));
  assert.equal(
    potential.some((item) => item.includes('RULE_DELETE_DEPENDENCY')),
    false,
  );
  assert.ok(blocking[0]?.includes('缺少当前作品中的显式依赖'));
  assert.ok(blocking[0]?.includes('missing-1'));
  assert.equal(blocking.join('').includes('{'), false);
  assert.equal(JSON.stringify(impact.blockingConflicts) === blocking[0], false);
  assert.match(describeImpactFact(impact.blockingConflicts[0]!), /确认不能覆盖/);
});
