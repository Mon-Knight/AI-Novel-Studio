import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { webcrypto } from 'node:crypto';
import { authorizeLocalRuleChange, previewLocalRuleChange } from './localRuleGovernance';
import { createWorldRuleDocument, serializeWorldRuleDocument } from './worldRuleSchema';
import type { WorldRuleChange, WorldRuleSaveGuard } from '../../types/worldRules';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});
Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
beforeEach(() => storage.clear());
after(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
  else Reflect.deleteProperty(globalThis, 'crypto');
});
const change: WorldRuleChange = {
  targetType: 'rule_system',
  title: '医院供电',
  content: '急救区域优先供电。',
  isActive: true,
};
const guard = (p: Awaited<ReturnType<typeof previewLocalRuleChange>>) => ({
  expectedRuleSetFingerprint: p.ruleSetFingerprint,
  changeAuthorization: { previewHash: p.previewHash, intent: 'confirm_change' as const },
});

test('browser authorization binds full content and returns a synchronous final CAS check', async () => {
  const preview = await previewLocalRuleChange('novel-1', [change]);
  await assert.rejects(
    authorizeLocalRuleChange('novel-1', [{ ...change, content: '预览后改写' }], guard(preview)),
    /RULE_CHANGE_CONFIRMATION_REQUIRED/,
  );
  const recheck = await authorizeLocalRuleChange('novel-1', [change], guard(preview));
  storage.set(
    'ai_novel_studio_world_settings',
    JSON.stringify([
      { id: 'new-rule', novelId: 'novel-1', content: '另一回合改动', isActive: true },
    ]),
  );
  assert.throws(recheck, /RULE_SET_BASE_CONFLICT/);
});

test('browser reports explicit deletion dependencies without claiming semantic contradictions', async () => {
  const dependent = createWorldRuleDocument('dependent');
  dependent.dependencies = ['base'];
  storage.set(
    'ai_novel_studio_rule_systems',
    JSON.stringify([
      {
        id: 'base',
        novelId: 'novel-1',
        title: change.title,
        content: change.content,
        isActive: true,
      },
      {
        id: 'dependent',
        novelId: 'novel-1',
        title: '急救供水',
        content: '泵依赖供电',
        structuredJson: serializeWorldRuleDocument(dependent),
        isActive: true,
      },
    ]),
  );
  const deletion = { ...change, targetId: 'base', operation: 'delete' as const };
  const preview = await previewLocalRuleChange('novel-1', [deletion]);
  assert.equal(preview.blockingConflicts[0].code, 'RULE_DELETE_DEPENDENCY');
  const before = storage.get('ai_novel_studio_rule_systems');
  await assert.rejects(
    authorizeLocalRuleChange('novel-1', [deletion], guard(preview)),
    /RULE_CHANGE_BLOCKED/,
  );
  assert.equal(storage.get('ai_novel_studio_rule_systems'), before);
});

test('browser rejects a malformed recognized schema even with a matching preview guard', async () => {
  const malformed = {
    ...change,
    structuredJson: '{"contract":"world_rules_v1","schemaVersion":1,"authority":"confirmed"}',
  };
  const preview = await previewLocalRuleChange('novel-1', [malformed]);
  await assert.rejects(
    authorizeLocalRuleChange('novel-1', [malformed], guard(preview)),
    /WORLD_RULE_SCHEMA_INVALID/,
  );
});

test('browser rejects a missing or partial author guard before self-authorization', async () => {
  const preview = await previewLocalRuleChange('novel-1', [change]);
  await assert.rejects(
    authorizeLocalRuleChange('novel-1', [change], undefined as unknown as WorldRuleSaveGuard),
    /RULE_CHANGE_CONFIRMATION_REQUIRED: 请先预览影响并明确确认本次变更/,
  );
  await assert.rejects(
    authorizeLocalRuleChange('novel-1', [change], {
      changeAuthorization: { previewHash: preview.previewHash, intent: 'confirm_change' },
    }),
    /RULE_CHANGE_CONFIRMATION_REQUIRED/,
  );
  await assert.rejects(
    authorizeLocalRuleChange('novel-1', [change], {
      expectedRuleSetFingerprint: preview.ruleSetFingerprint,
    }),
    /RULE_CHANGE_CONFIRMATION_REQUIRED/,
  );
  await assert.rejects(
    authorizeLocalRuleChange('novel-1', [change], {
      expectedRuleSetFingerprint: preview.ruleSetFingerprint,
      changeAuthorization: {
        previewHash: preview.previewHash,
        intent: undefined as never,
      },
    }),
    /RULE_CHANGE_CONFIRMATION_REQUIRED/,
  );
});

test('browser rejects mismatched rule-set fingerprints and preview hashes', async () => {
  const preview = await previewLocalRuleChange('novel-1', [change]);
  const valid = guard(preview);
  await assert.rejects(
    authorizeLocalRuleChange('novel-1', [change], {
      ...valid,
      expectedRuleSetFingerprint: 'wrong-rule-set-fingerprint',
    }),
    /RULE_SET_BASE_CONFLICT: 请重新预览并确认本次变更/,
  );
  await assert.rejects(
    authorizeLocalRuleChange('novel-1', [change], {
      ...valid,
      changeAuthorization: { ...valid.changeAuthorization, previewHash: 'wrong-preview-hash' },
    }),
    /RULE_CHANGE_CONFIRMATION_REQUIRED: 请先预览影响并明确确认本次变更/,
  );
});

test('browser requires notes for exception approval and accepts a complete guarded exception', async () => {
  const document = createWorldRuleDocument('rule-1', '工厂不得夜间排水');
  document.authority = 'confirmed';
  document.exceptions = [
    {
      condition: '仅消防抢险期间',
      effect: '允许受控排水',
      approval: 'author_approved',
      reason: '保护居民生命',
    },
  ];
  const exceptionChange = {
    ...change,
    structuredJson: serializeWorldRuleDocument(document),
  };
  const preview = await previewLocalRuleChange('novel-1', [exceptionChange]);
  const authorization = {
    previewHash: preview.previewHash,
    intent: 'approve_exception' as const,
  };
  await assert.rejects(
    authorizeLocalRuleChange('novel-1', [exceptionChange], {
      expectedRuleSetFingerprint: preview.ruleSetFingerprint,
      changeAuthorization: authorization,
    }),
    /RULE_CHANGE_NOTES_REQUIRED/,
  );
  const recheck = await authorizeLocalRuleChange('novel-1', [exceptionChange], {
    expectedRuleSetFingerprint: preview.ruleSetFingerprint,
    changeAuthorization: { ...authorization, notes: '仅限消防抢险，保留制度代价。' },
  });
  assert.doesNotThrow(recheck);
});
