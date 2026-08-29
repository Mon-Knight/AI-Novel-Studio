import assert from 'node:assert/strict';
import test from 'node:test';

import rawCanonicalToolManifest from '../../../../contracts/agent/canonical-tool-manifest.v1.json';
import { canonicalHash } from '../../ai/compilation/canonical';
import {
  getCanonicalAgentManifest,
  getCanonicalToolManifest,
  listCanonicalToolDescriptors,
  listCanonicalToolsForAgent,
} from './canonicalToolProjection';
import {
  CANONICAL_TOOL_MANIFEST_CANONICALIZATION,
  loadCanonicalToolManifest,
  validateCanonicalToolManifestArtifact,
} from './canonicalToolManifest';

interface MutableManifest extends Record<string, unknown> {
  projectionHash: string;
  modelVisibleToolIdentities: string[];
  tools: Array<Record<string, unknown>>;
}

function mutableArtifact(): MutableManifest {
  return JSON.parse(JSON.stringify(rawCanonicalToolManifest)) as MutableManifest;
}

async function refreshHash(manifest: MutableManifest): Promise<void> {
  const withoutHash: Record<string, unknown> = { ...manifest };
  delete withoutHash.projectionHash;
  manifest.projectionHash = await canonicalHash(withoutHash);
}

test('shared artifact is the portable, immutable source for both manifest projections', async () => {
  const descriptors = listCanonicalToolDescriptors();
  const first = await loadCanonicalToolManifest(descriptors);
  const second = await getCanonicalToolManifest();

  assert.deepEqual(first, second);
  assert.equal(first.contractVersion, 'canonical_tool_manifest_v1');
  assert.equal(first.projectionVersion, '1');
  assert.equal(first.canonicalization, CANONICAL_TOOL_MANIFEST_CANONICALIZATION);
  assert.match(first.projectionHash, /^[0-9a-f]{64}$/);
  assert.deepEqual(first.modelVisibleToolIdentities, []);
  assert.deepEqual(
    first.tools.map((tool) => tool.id),
    ['context.read', 'memory.search', 'novel.read', 'structure.read'],
  );

  const expectedToolKeys = [
    'confirmationPolicy',
    'description',
    'exposure',
    'health',
    'id',
    'inputSchema',
    'name',
    'outputSchema',
    'permissions',
    'projectionState',
    'scope',
    'sideEffect',
    'timeoutMs',
    'version',
  ];
  for (const tool of first.tools) {
    assert.deepEqual(Object.keys(tool).sort(), expectedToolKeys);
    assert.equal(tool.id, tool.name);
    assert.equal(tool.exposure, 'catalog_only');
    assert.equal(tool.projectionState, 'catalog_only');
    assert.equal(tool.health, 'partial');
    for (const forbidden of ['facade', 'executor', 'evidence', 'legacyAliases']) {
      assert.equal(forbidden in tool, false, `${tool.id} leaked ${forbidden}`);
    }
  }

  const withoutHash: Record<string, unknown> = { ...first };
  delete withoutHash.projectionHash;
  assert.equal(await canonicalHash(withoutHash), first.projectionHash);

  first.tools[0].description = 'caller mutation';
  const reread = await getCanonicalToolManifest();
  assert.notEqual(reread.tools[0].description, 'caller mutation');

  const agentManifest = await getCanonicalAgentManifest();
  assert.equal(agentManifest.projectionHash, reread.projectionHash);
  assert.equal(agentManifest.canonicalization, reread.canonicalization);
  assert.deepEqual(agentManifest.tools, []);
  assert.deepEqual(await listCanonicalToolsForAgent(), []);
});

test('shared artifact rejects shape, hash, ordering and safe-integer violations', async (t) => {
  const descriptors = listCanonicalToolDescriptors();

  await t.test('unknown portable field', async () => {
    const artifact = mutableArtifact();
    artifact.tools[0].facade = 'forbidden.reflection';
    await assert.rejects(
      validateCanonicalToolManifestArtifact(artifact, descriptors),
      /facade 是未知字段/,
    );
  });

  await t.test('content hash mismatch', async () => {
    const artifact = mutableArtifact();
    artifact.tools[0].description = 'tampered';
    await assert.rejects(
      validateCanonicalToolManifestArtifact(artifact, descriptors),
      /projectionHash 与 artifact 内容不一致/,
    );
  });

  await t.test('non-ordinal tool order', async () => {
    const artifact = mutableArtifact();
    [artifact.tools[0], artifact.tools[1]] = [artifact.tools[1], artifact.tools[0]];
    await assert.rejects(
      validateCanonicalToolManifestArtifact(artifact, descriptors),
      /tools 必须按 id ordinal 排序/,
    );
  });

  await t.test('unsafe timeout', async () => {
    const artifact = mutableArtifact();
    artifact.tools[0].timeoutMs = Number.MAX_SAFE_INTEGER + 1;
    await assert.rejects(
      validateCanonicalToolManifestArtifact(artifact, descriptors),
      /timeoutMs 必须是安全整数/,
    );
  });
});

test('shared artifact rejects catalog, binding and explicit visibility drift', async (t) => {
  const descriptors = listCanonicalToolDescriptors();

  await t.test('portable contract no longer matches dynamic projection', async () => {
    const artifact = mutableArtifact();
    artifact.tools[0].timeoutMs = 30_001;
    await refreshHash(artifact);
    await assert.rejects(
      validateCanonicalToolManifestArtifact(artifact, descriptors),
      /dynamic projection 漂移/,
    );
  });

  await t.test('visible identities do not match stable stable working derivation', async () => {
    const artifact = mutableArtifact();
    artifact.tools[0].exposure = 'stable';
    artifact.tools[0].projectionState = 'stable';
    artifact.tools[0].health = 'working';
    await refreshHash(artifact);
    await assert.rejects(
      validateCanonicalToolManifestArtifact(artifact, descriptors),
      /modelVisibleToolIdentities 与 stable\/stable\/working 只读派生集合不一致/,
    );
  });
});
