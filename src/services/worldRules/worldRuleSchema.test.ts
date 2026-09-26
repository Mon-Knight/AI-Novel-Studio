import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createWorldRuleDocument,
  parseWorldRuleDocument,
  proposeConfirmedWorldRule,
  serializeWorldRuleDocument,
  WORLD_PARAMETER_DIRECTORY,
} from './worldRuleSchema';
import { formatWorldRuleMetadata } from './worldRuleFormatting';
import { validateWorldRuleMutation } from './worldRuleMutation';

test('world metadata round-trips all eight progressive parameter groups without confirming a draft', () => {
  const document = createWorldRuleDocument('rule-1', '城市停水后须先恢复医院供水。', 'social_norm');
  document.strength = 'hard';
  document.epistemic.status = 'belief';
  for (const item of WORLD_PARAMETER_DIRECTORY)
    document.worldParameters[item.key] = item.key === 'technology_infrastructure' ? 'N/A' : '未定';
  document.scope.groups = ['供水机构'];
  document.conditions = ['断水'];
  document.chronology = { effectiveFrom: '故事第三日', effectiveUntil: 'N/A', revealAt: '第六章' };
  document.boundaries = { limitations: '须有维修人员', cost: '停工一天', ceiling: '每日三处' };
  const parsed = parseWorldRuleDocument(serializeWorldRuleDocument(document));
  assert.equal(parsed.status, 'valid');
  if (parsed.status !== 'valid') return;
  assert.deepEqual(parsed.document, document);
  assert.equal(parsed.document.authority, 'draft');
  assert.match(
    formatWorldRuleMetadata(serializeWorldRuleDocument(document)),
    /社会规范可被人物违反/,
  );
  assert.match(formatWorldRuleMetadata(serializeWorldRuleDocument(document)), /认知状态：belief/);
});

test('legacy unknown and invalid JSON remain readable verbatim and are not silently upgraded', () => {
  for (const raw of [
    '{"legacy":{"weather":"寒冬"}}',
    '{"contract":"world_rules_v1","schemaVersion":9}',
    '{broken',
  ]) {
    const parsed = parseWorldRuleDocument(raw);
    assert.notEqual(parsed.status, 'valid');
    assert.ok(formatWorldRuleMetadata(raw).includes(raw));
    assert.match(formatWorldRuleMetadata(raw), /不代表作者已确认/);
    assert.doesNotThrow(() => validateWorldRuleMutation(raw, raw, 'confirm_change'));
    assert.throws(
      () => validateWorldRuleMutation(raw, undefined, 'confirm_change'),
      /WORLD_RULE_SCHEMA_INVALID/,
    );
  }
});

test('schema rejects invalid strength and revision and preserves unknown extension fields', () => {
  const document = createWorldRuleDocument('rule-1');
  assert.equal(
    parseWorldRuleDocument(JSON.stringify({ ...document, strength: 'law_is_physics' })).status,
    'invalid',
  );
  assert.equal(
    parseWorldRuleDocument(JSON.stringify({ ...document, identity: { id: 'rule-1', revision: 0 } }))
      .status,
    'invalid',
  );
  const extended = { ...document, extensionForFuture: { keep: 'verbatim' } };
  const parsed = parseWorldRuleDocument(JSON.stringify(extended));
  assert.equal(parsed.status, 'valid');
  if (parsed.status === 'valid')
    assert.deepEqual(
      JSON.parse(serializeWorldRuleDocument(parsed.document)).extensionForFuture,
      extended.extensionForFuture,
    );
});

test('author confirmation cannot be inferred from knowledge and new exception approvals need separate intent', () => {
  const old = createWorldRuleDocument('rule-1', '工厂不得夜间排水');
  old.authority = 'confirmed';
  const next = proposeConfirmedWorldRule(old, old);
  next.exceptions = [
    {
      condition: '仅消防抢险期间',
      effect: '允许受控排水',
      approval: 'author_approved',
      reason: '保护居民生命',
    },
  ];
  const before = serializeWorldRuleDocument(old),
    after = serializeWorldRuleDocument(next);
  assert.throws(
    () => validateWorldRuleMutation(after, before, 'confirm_change'),
    /RULE_EXCEPTION_CONFIRMATION_REQUIRED/,
  );
  assert.doesNotThrow(() => validateWorldRuleMutation(after, before, 'approve_exception'));
  assert.throws(
    () => validateWorldRuleMutation(after, before),
    /RULE_CHANGE_CONFIRMATION_REQUIRED/,
  );
  const stale = { ...next, identity: old.identity };
  assert.throws(
    () => validateWorldRuleMutation(serializeWorldRuleDocument(stale), before, 'approve_exception'),
    /WORLD_RULE_REVISION_CONFLICT/,
  );
});
