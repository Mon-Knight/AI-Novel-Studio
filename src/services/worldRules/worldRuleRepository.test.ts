import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { webcrypto } from 'node:crypto';
// @ts-expect-error jsdom declarations are not bundled.
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';
import {
  createWorldRuleDocument,
  proposeConfirmedWorldRule,
  serializeWorldRuleDocument,
} from './worldRuleSchema';
import type { RuleSystem } from '../../types/setting';
import type { WorldRuleChange } from '../../types/worldRules';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  localStorage: dom.window.localStorage,
  crypto: webcrypto,
})) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, value });
}
const vite = await createServer({
  appType: 'custom',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, hmr: false, watch: null },
});
const { settingRepository } = (await vite.ssrLoadModule(
  '/src/services/database/settingRepository.ts',
)) as typeof import('../database/settingRepository');
beforeEach(() => localStorage.clear());
after(async () => {
  await vite.close();
  dom.window.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function seedRule(): RuleSystem {
  const document = createWorldRuleDocument('rule-1', '医院供电优先', 'social_norm');
  document.authority = 'confirmed';
  const rule: RuleSystem = {
    id: 'rule-1',
    novelId: 'novel-1',
    title: '供电条例',
    category: 'social',
    content: '医院供电优先',
    forbiddenRules: '不得省略违规后的社会代价',
    structuredJson: serializeWorldRuleDocument(document),
    isActive: true,
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T00:00:00Z',
  };
  localStorage.setItem('ai_novel_studio_rule_systems', JSON.stringify([rule]));
  return rule;
}

test('browser rule save round-trips structured metadata and expires only same-book issued reviews', async () => {
  const rule = seedRule();
  const previous = JSON.parse(rule.structuredJson!);
  const next = proposeConfirmedWorldRule(previous, previous);
  next.boundaries.cost = '停工半日';
  const structuredJson = serializeWorldRuleDocument(next);
  localStorage.setItem(
    'ai_novel_studio_task_conversations',
    JSON.stringify({
      bundles: [
        {
          conversation: { novelId: 'novel-1' },
          authorizations: [
            { authorizationId: 'issued', status: 'issued' },
            { authorizationId: 'history', status: 'consumed' },
          ],
        },
        {
          conversation: { novelId: 'other-book' },
          authorizations: [{ authorizationId: 'other', status: 'issued' }],
        },
      ],
    }),
  );
  const prose = JSON.stringify([
    { id: 'draft-1', content: '已采用正文必须保留。', isAdopted: true },
  ]);
  localStorage.setItem('ai_novel_studio_drafts_list_chapter-1', prose);
  const change: WorldRuleChange = {
    targetType: 'rule_system',
    targetId: rule.id,
    title: rule.title,
    content: rule.content,
    category: rule.category,
    forbiddenRules: rule.forbiddenRules,
    structuredJson,
    isActive: true,
  };
  const preview = await settingRepository.previewWorldRuleChange(rule.novelId, [change]);
  const saved = await settingRepository.saveRuleSystem(rule.id, {
    novelId: rule.novelId,
    title: rule.title,
    content: rule.content,
    category: rule.category,
    forbiddenRules: rule.forbiddenRules,
    structuredJson,
    isActive: true,
    expectedUpdatedAt: rule.updatedAt,
    expectedRuleSetFingerprint: preview.ruleSetFingerprint,
    changeAuthorization: { previewHash: preview.previewHash, intent: 'confirm_change' },
  });
  assert.equal(JSON.parse(saved.structuredJson!).boundaries.cost, '停工半日');
  assert.equal(JSON.parse(saved.structuredJson!).identity.revision, 2);
  const state = JSON.parse(localStorage.getItem('ai_novel_studio_task_conversations')!);
  assert.equal(state.bundles[0].authorizations[0].status, 'expired');
  assert.equal(state.bundles[0].authorizations[1].status, 'consumed');
  assert.equal(state.bundles[1].authorizations[0].status, 'issued');
  assert.equal(localStorage.getItem('ai_novel_studio_drafts_list_chapter-1'), prose);
});

test('browser rule deletion requires a guard and rejects cross-book ids', async () => {
  const rule = seedRule();
  const beforeDelete = localStorage.getItem('ai_novel_studio_rule_systems');
  await assert.rejects(
    settingRepository.deleteRuleSystem(rule.id),
    /RULE_CHANGE_CONFIRMATION_REQUIRED/,
  );
  assert.equal(localStorage.getItem('ai_novel_studio_rule_systems'), beforeDelete);
  await assert.rejects(
    settingRepository.saveRuleSystem(rule.id, {
      novelId: 'other-book',
      title: rule.title,
      content: rule.content,
    }),
    /RULE_SET_SCOPE_MISMATCH/,
  );
  const change: WorldRuleChange = {
    operation: 'delete',
    targetType: 'rule_system',
    targetId: rule.id,
    title: rule.title,
    content: rule.content,
    category: rule.category,
    forbiddenRules: rule.forbiddenRules,
    structuredJson: rule.structuredJson,
    isActive: rule.isActive,
  };
  const preview = await settingRepository.previewWorldRuleChange(rule.novelId, [change]);
  await settingRepository.deleteRuleSystem(rule.id, {
    novelId: rule.novelId,
    expectedUpdatedAt: rule.updatedAt,
    expectedRuleSetFingerprint: preview.ruleSetFingerprint,
    changeAuthorization: { previewHash: preview.previewHash, intent: 'confirm_change' },
  });
  assert.deepEqual(await settingRepository.getRuleSystems(rule.novelId), []);
});

test('browser world-rule saves and activation changes reject missing guards without writing', async () => {
  const rule = seedRule();
  const beforeRules = localStorage.getItem('ai_novel_studio_rule_systems');
  await assert.rejects(
    settingRepository.saveRuleSystem(rule.id, {
      novelId: rule.novelId,
      title: rule.title,
      content: '未经预览的改写',
      isActive: false,
      expectedUpdatedAt: rule.updatedAt,
    }),
    /RULE_CHANGE_CONFIRMATION_REQUIRED/,
  );
  assert.equal(localStorage.getItem('ai_novel_studio_rule_systems'), beforeRules);
  await assert.rejects(
    settingRepository.saveWorldSetting(null, {
      novelId: rule.novelId,
      title: '新的世界背景',
      content: '未经预览的背景',
    }),
    /RULE_CHANGE_CONFIRMATION_REQUIRED/,
  );
  assert.equal(localStorage.getItem('ai_novel_studio_world_settings'), null);
});
