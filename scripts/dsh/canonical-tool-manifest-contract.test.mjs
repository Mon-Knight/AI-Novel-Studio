import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const manifestPath = fileURLToPath(
  new URL('../../contracts/agent/canonical-tool-manifest.v1.json', import.meta.url),
);
const taskServerTemplatePath = fileURLToPath(
  new URL('./ans-task-server-template.mjs', import.meta.url),
);

const EXPECTED_TOOL_IDS = Object.freeze([
  'context.read',
  'memory.search',
  'novel.read',
  'structure.read',
]);

const LEGACY_TOOL_NAMES = Object.freeze([
  'novel.read_context',
  'chapter.read_outline',
  'search_memory',
  'generate_chapter',
  'generate_outline',
  'generate_characters',
  'suggest_events',
  'expand_settings',
  'polish_chapter',
  'check_quality',
  'summarize_chapter',
]);

function assertRecord(value, label) {
  assert.equal(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    true,
    `${label} must be a JSON object`,
  );
  return value;
}

/**
 * Independent ANS canonical JSON implementation for the DSH/Node contract
 * gate. Inputs must already be JSON values; unsupported JavaScript values and
 * non-portable numbers fail closed instead of being coerced.
 */
function canonicalJson(value, path = '$') {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    assert.equal(Number.isSafeInteger(value), true, `${path} must be a safe JSON integer`);
    assert.equal(Object.is(value, -0), false, `${path} must not contain negative zero`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry, index) => canonicalJson(entry, `${path}[${index}]`)).join(',')}]`;
  }
  assertRecord(value, path);
  const keys = Object.keys(value).sort((left, right) =>
    left === right ? 0 : left < right ? -1 : 1,
  );
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], `${path}.${key}`)}`)
    .join(',')}}`;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function readManifest() {
  assert.equal(
    existsSync(manifestPath),
    true,
    `shared canonical Tool manifest is missing: ${manifestPath}`,
  );
  return assertRecord(JSON.parse(readFileSync(manifestPath, 'utf8')), 'manifest');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

test('shared canonical Tool manifest has a stable independent DSH hash and zero exposure', () => {
  const manifest = readManifest();
  assert.deepEqual(Object.keys(manifest).sort(), [
    'canonicalization',
    'contractVersion',
    'modelVisibleToolIdentities',
    'projectionHash',
    'projectionVersion',
    'tools',
  ]);
  assert.equal(manifest.contractVersion, 'canonical_tool_manifest_v1');
  assert.equal(manifest.projectionVersion, '1');
  assert.equal(manifest.canonicalization, 'ans_canonical_json_v1');
  assert.match(manifest.projectionHash, /^[0-9a-f]{64}$/u);

  const { projectionHash, ...hashPayload } = manifest;
  assert.equal(sha256(canonicalJson(hashPayload)), projectionHash);

  assert.deepEqual(manifest.modelVisibleToolIdentities, []);
  assert.equal(Array.isArray(manifest.tools), true);
  assert.deepEqual(
    manifest.tools.map((tool) => assertRecord(tool, 'manifest.tools[]').id),
    EXPECTED_TOOL_IDS,
  );
  assert.equal(new Set(manifest.tools.map((tool) => tool.id)).size, EXPECTED_TOOL_IDS.length);

  for (const tool of manifest.tools) {
    assert.equal(tool.name, tool.id);
    assert.equal(tool.version, '1');
    assert.equal(tool.exposure, 'catalog_only');
    assert.equal(tool.sideEffect, 'none');
    assert.equal(tool.confirmationPolicy, 'never');
    const inputSchema = assertRecord(tool.inputSchema, `${tool.id}.inputSchema`);
    const outputSchema = assertRecord(tool.outputSchema, `${tool.id}.outputSchema`);
    assert.equal(inputSchema.type, 'object');
    assert.equal(inputSchema.additionalProperties, false);
    assert.equal(outputSchema.type, 'object');
    assert.equal(outputSchema.additionalProperties, false);
  }
});

test('shared manifest and existing DSH template do not auto-connect legacy aliases', () => {
  const manifest = readManifest();
  const serializedManifest = canonicalJson(manifest);
  for (const legacyName of LEGACY_TOOL_NAMES) {
    assert.equal(
      serializedManifest.includes(legacyName),
      false,
      `legacy Tool name leaked into canonical manifest: ${legacyName}`,
    );
  }
  assert.equal(serializedManifest.includes('mcp__novel__'), false);

  const taskServerTemplate = readFileSync(taskServerTemplatePath, 'utf8');
  for (const canonicalId of EXPECTED_TOOL_IDS) {
    assert.doesNotMatch(
      taskServerTemplate,
      new RegExp(`['\"]${escapeRegex(canonicalId)}['\"]`, 'u'),
      `DSH template must not register catalog-only canonical Tool ${canonicalId}`,
    );
  }
});
