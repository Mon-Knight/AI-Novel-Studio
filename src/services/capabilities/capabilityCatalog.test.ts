import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPABILITY_CATALOG,
  CAPABILITY_CATALOG_VERSION,
  getCapability,
  listAgentExposedCapabilities,
  listCapabilitiesByDomain,
} from './capabilityCatalog';

test('capability catalog has unique canonical ids and explicit evidence', () => {
  assert.equal(CAPABILITY_CATALOG_VERSION, 'capability_catalog_v1');
  const ids = CAPABILITY_CATALOG.map((capability) => capability.id);
  assert.equal(new Set(ids).size, ids.length);

  for (const capability of CAPABILITY_CATALOG) {
    assert.match(capability.id, /^[a-z][a-z0-9_]+\.[a-z][a-z0-9_]+$/);
    assert.equal(capability.version, '1');
    assert.ok(capability.description.length > 0);
    assert.ok(capability.executor.length > 0);
    assert.ok(capability.evidence.callChain.length > 0);
    assert.ok(capability.evidence.implementationEntrypoints.length > 0);
    assert.ok(capability.evidence.sourceOfTruth.length > 0);
    assert.ok(capability.evidence.references.length > 0);
    assert.equal(capability.exposure, 'catalog_only');
  }

  for (const id of [
    'novel.read',
    'structure.read',
    'memory.search',
    'artifact.review',
    'artifact.apply_approved',
  ]) {
    assert.ok(
      (getCapability(id)?.evidence.dynamicTests.length ?? 0) > 0,
      `${id} lacks a runtime test`,
    );
  }
});

test('catalog preserves the distinction between capability health and agent exposure', () => {
  const writing = getCapability('writing.generate');
  assert.ok(writing);
  assert.equal(writing.kind, 'subagent');
  assert.equal(writing.evidence.health, 'partial');
  assert.equal(writing.exposure, 'catalog_only');

  const adopt = getCapability('artifact.apply_approved');
  assert.ok(adopt);
  assert.equal(adopt.kind, 'host_protocol');
  assert.equal(adopt.confirmationPolicy, 'user_required');
  assert.equal(adopt.sideEffect, 'write');
  assert.deepEqual(listAgentExposedCapabilities(), []);
});

test('catalog selectors return canonical domain groupings without aliases', () => {
  const writing = listCapabilitiesByDomain('writing');
  assert.deepEqual(
    writing.map((capability) => capability.id),
    ['draft.read', 'writing.generate', 'writing.continue', 'writing.rewrite'],
  );
  assert.ok(getCapability('novel.read')?.legacyAliases.includes('novel.read_context'));
  assert.equal(getCapability('missing.capability'), undefined);
});

test('Phase 1A-B facade metadata is recorded without opening model exposure', () => {
  assert.equal(getCapability('novel.read')?.facade, 'projectCapability.readCurrentProject');
  assert.equal(getCapability('structure.read')?.facade, 'projectCapability.readChapterPosition');
  assert.equal(getCapability('context.read')?.facade, 'contextCapability.readCurrentStoryContext');
  assert.equal(getCapability('memory.search')?.facade, 'contextCapability.searchMemory');
  assert.equal(getCapability('writing.generate')?.facade, 'writingCapability.generateCandidate');
  assert.equal(getCapability('artifact.review')?.facade, 'artifactCapability.requestReview');
  assert.deepEqual(listAgentExposedCapabilities(), []);
});
