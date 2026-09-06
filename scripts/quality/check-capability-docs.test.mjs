import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkCapabilityDeclarations,
  CURRENT_CAPABILITY_DOCUMENTS,
} from './check-capability-docs.mjs';

const identities = ['context.read@1', 'memory.search@1', 'novel.read@1', 'structure.read@1'];
const facts = `<!-- ans-current-canonical:start -->\n${identities.map((identity) => `\`${identity}\``).join('、')}\n\`canonical-only\`；\`deterministic-writer\`；\`NOT_VERIFIED\`\n<!-- ans-current-canonical:end -->`;
function fixture() {
  return {
    manifest: {
      modelVisibleToolIdentities: identities,
      tools: identities.map((identity) => ({
        id: identity.split('@')[0],
        version: '1',
        exposure: 'stable',
        health: 'working',
        sideEffect: 'none',
      })),
    },
    hostSource:
      'const CANONICAL_ALLOWED_TOOLS: &str = "novel.read,structure.read,context.read,memory.search";\nfn is_canonical_only_turn(input: &Input) -> bool { input.task_kind == "read" }\nfn turn_allowed_tools(input: &Input) -> &str { if is_canonical_only_turn(input) { CANONICAL_ALLOWED_TOOLS } else { ALLOWED_TOOLS } }',
    documents: Object.fromEntries(
      Object.entries(CURRENT_CAPABILITY_DOCUMENTS).map(([file, numbers]) => [
        file,
        numbers
          .map(
            (number, index) =>
              `## ${number} Current capability\n${index === 0 ? facts : 'Current section.'}`,
          )
          .join('\n'),
      ]),
    ),
  };
}

test('accepts matching current declarations and clearly labeled historical zero', () => {
  const input = fixture();
  input.documents['docs/data-model.md'] +=
    '\n历史基线：当时 modelVisibleToolIdentities=[]，不是当前状态。';
  assert.equal(checkCapabilityDeclarations(input), 4);
});

test('detects identity, exposure, health and host read-allowlist drift independently', () => {
  for (const mutate of [
    (input) => {
      input.manifest.modelVisibleToolIdentities = [];
    },
    (input) => {
      input.manifest.tools[0].exposure = 'catalog_only';
    },
    (input) => {
      input.manifest.tools[0].health = 'partial';
    },
    (input) => {
      input.hostSource = input.hostSource.replace('novel.read,', 'novel.read_context,');
    },
    (input) => {
      input.hostSource = input.hostSource.replace(
        'if is_canonical_only_turn(input) { CANONICAL_ALLOWED_TOOLS }',
        'if is_canonical_only_turn(input) { ALLOWED_TOOLS }',
      );
    },
  ]) {
    const input = fixture();
    mutate(input);
    assert.throws(() => checkCapabilityDeclarations(input));
  }
});

test('detects missing or repeated blocks and false live-verified statements in the fact block', () => {
  for (const replacement of [
    '',
    `${facts}\n${facts}`,
    facts.replace('NOT_VERIFIED', 'VERIFIED'),
    facts.replace('memory.search@1', 'memory.other@1'),
  ]) {
    const input = fixture();
    input.documents['docs/data-model.md'] = `## 40.10 Current\n${replacement}`;
    assert.throws(() => checkCapabilityDeclarations(input));
  }
});

test('a correct fact block does not hide contradictory prose in the same current chapter', () => {
  for (const prose of [
    'modelVisibleToolIdentities=[]。',
    'modelVisibleToolIdentities 长度为 0。',
    '全部仍是 catalog_only + partial。',
    '宿主 task_runtime 仍注入 legacy ALLOWED_TOOLS。',
    '生产 tools/list 尚未切到 Canonical。',
    'live 云端 Provider 已 VERIFIED。',
  ]) {
    const input = fixture();
    input.documents['docs/data-model.md'] += `\n${prose}`;
    assert.throws(() => checkCapabilityDeclarations(input), /Contradictory/u);
  }
});
