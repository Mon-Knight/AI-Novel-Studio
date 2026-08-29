import assert from 'node:assert/strict';
import test from 'node:test';

import { chapterRepository } from '../../database/chapterRepository';
import { novelRepository } from '../../database/novelRepository';
import { volumeRepository } from '../../database/volumeRepository';
import { putLocalMemoryDocument } from '../../memory/adoptedDraftMemory';
import { productionToolRegistry } from '../../agent-tools/productionToolRegistry';
import { toolRegistryPrivate } from '../../agent-tools/toolRegistry';
import {
  getCanonicalAgentManifest,
  getCanonicalProjectionDiagnostics,
  getCanonicalToolDescriptor,
  getCanonicalToolManifest,
  listCanonicalToolsForAgent,
  listCanonicalToolDescriptors,
} from './canonicalToolProjection';
import { executeCanonicalToolForHostValidation } from './canonicalToolRuntime';
import type { CanonicalToolInvocationContext } from './canonicalToolTypes';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function installStorage(): void {
  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  for (const key of [
    'ai_novel_studio_novels',
    'ai_novel_studio_volumes',
    'ai_novel_studio_chapters',
    'ai_novel_studio_world_settings',
    'ai_novel_studio_rule_systems',
    'ai_novel_studio_protagonists',
    'ai_novel_studio_memory_documents',
  ]) {
    storage.setItem(key, '[]');
  }
}

function restoreStorage(): void {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  } else {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

function storageSnapshot(): string {
  const values: Array<[string, string | null]> = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key) values.push([key, localStorage.getItem(key)]);
  }
  values.sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(values);
}

async function invokeForHost(
  name: string,
  argumentsJson: unknown,
  context: CanonicalToolInvocationContext,
) {
  const manifest = await getCanonicalToolManifest();
  return executeCanonicalToolForHostValidation(
    {
      name,
      version: '1',
      argumentsJson,
      expectedProjectionHash: manifest.projectionHash,
    },
    {
      invocationId: `test-${name}`,
      allowedTools: [`${name}@1`],
      novelId: context.novelId,
      chapterId: context.chapterId,
      grantedPermissions: context.grantedPermissions ?? [],
      signal: context.signal,
    },
  );
}

async function fixture() {
  const novelA = await novelRepository.create({ title: 'Canonical A', genre: '测试' });
  const novelB = await novelRepository.create({ title: 'Canonical B', genre: '测试' });
  const volume = await volumeRepository.create({ novelId: novelA.id, title: '第一卷' });
  const chapter = await chapterRepository.create({
    novelId: novelA.id,
    volumeId: volume.id,
    title: '第一章',
    outline: 'Canonical projection fixture',
    goal: '验证固定 adapter',
  });
  putLocalMemoryDocument({
    documentId: `memory-${novelA.id}`,
    novelId: novelA.id,
    sourceType: 'adopted_draft',
    sourceId: `draft-${chapter.id}`,
    sourceVersion: 1,
    sourceHash: 'a'.repeat(64),
    adoptedDraftId: `draft-${chapter.id}`,
    chapterId: chapter.id,
    metadata: { fixture: true },
    chunks: [
      {
        id: `chunk-${chapter.id}`,
        ordinal: 0,
        text: 'Canonical memory fact',
        tokenCount: 4,
        importance: 0.8,
        entityKeys: [],
        metadata: { fixture: true },
        contentHash: 'b'.repeat(64),
      },
    ],
  });
  return { novelA, novelB, chapter };
}

test.beforeEach(installStorage);
test.afterEach(restoreStorage);

test('projection contains only fixed low-risk facade candidates', async () => {
  const descriptors = listCanonicalToolDescriptors();
  assert.deepEqual(
    descriptors.map((descriptor) => descriptor.id),
    ['novel.read', 'structure.read', 'context.read', 'memory.search'],
  );
  for (const descriptor of descriptors) {
    assert.equal(descriptor.name, descriptor.id);
    assert.equal(descriptor.version, '1');
    assert.equal(descriptor.executor, 'domain_facade');
    assert.equal(descriptor.sideEffect, 'none');
    assert.equal(descriptor.confirmationPolicy, 'never');
    assert.equal(descriptor.exposure, 'catalog_only');
    assert.equal(descriptor.projectionState, 'catalog_only');
    assert.equal(descriptor.id.includes('chapter.read_outline'), false);
    assert.ok(descriptor.facade.includes('Capability'));
    assert.equal(descriptor.evidence.capabilityId, descriptor.id);
    assert.ok(descriptor.timeoutMs >= 100);
  }
  const serialized = JSON.stringify(descriptors.map(({ evidence: _evidence, ...rest }) => rest));
  for (const forbidden of [
    'novel.read_context',
    'chapter.read_outline',
    'generate_chapter',
    'mcp__novel__',
    'Repository',
    'LocalStorage',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `model contract leaked ${forbidden}`);
  }
  for (const excluded of [
    'writing.generate',
    'artifact.review',
    'characters.read',
    'conversation.read',
  ]) {
    assert.equal(getCanonicalToolDescriptor(excluded), undefined);
  }
  assert.deepEqual(
    getCanonicalProjectionDiagnostics().map((diagnostic) => diagnostic.included),
    [true, true, true, true],
  );
  assert.deepEqual(await listCanonicalToolsForAgent(), []);

  const agentManifest = await getCanonicalAgentManifest();
  assert.deepEqual(agentManifest.tools, []);
});

test('manifest hash is deterministic and projection does not replace the legacy registry', async () => {
  const first = await getCanonicalToolManifest();
  const second = await getCanonicalToolManifest();
  assert.deepEqual(first, second);
  assert.match(first.projectionHash, /^[0-9a-f]{64}$/);
  assert.equal(first.contractVersion, 'canonical_tool_manifest_v1');
  assert.equal(first.projectionVersion, '1');
  assert.ok(first.tools.every((tool) => tool.inputSchema.additionalProperties === false));

  const legacyManifest = await productionToolRegistry.getManifest();
  assert.ok(legacyManifest.tools.some((tool) => tool.name === 'novel.read_context'));
  assert.equal(
    legacyManifest.tools.some((tool) => tool.name === 'novel.read'),
    false,
  );
  const originalDescription = second.tools[0].description;
  first.tools[0].description = 'tampered by caller';
  const third = await getCanonicalToolManifest();
  assert.equal(third.tools[0].description, originalDescription);
  assert.equal(third.projectionHash, second.projectionHash);
});

test('canonical adapters execute real facade chains and preserve source/hash contracts', async () => {
  const { novelA, novelB, chapter } = await fixture();
  const beforeRead = storageSnapshot();
  const context = {
    novelId: novelA.id,
    chapterId: chapter.id,
    grantedPermissions: ['novel.read', 'chapter.read'],
  };

  const project = await invokeForHost('novel.read', { novelId: novelA.id }, context);
  assert.equal(project.ok, true, project.error?.message);
  assert.equal(project.source, 'localstorage');
  assert.equal(project.storageMode, 'browser_fallback');
  assert.equal(
    project.data !== undefined &&
      project.data !== null &&
      typeof project.data === 'object' &&
      !Array.isArray(project.data) &&
      'project' in project.data,
    true,
  );
  assert.equal((project.data as { project: { id: string } }).project.id, novelA.id);
  assert.match(project.contentHash ?? '', /^[0-9a-f]{64}$/);
  assert.deepEqual(
    toolRegistryPrivate.validateSchema(
      project,
      getCanonicalToolDescriptor('novel.read')!.outputSchema,
    ),
    [],
  );

  const structure = await invokeForHost(
    'structure.read',
    { novelId: novelA.id, chapterId: chapter.id },
    context,
  );
  assert.equal(structure.ok, true, structure.error?.message);
  assert.equal((structure.data as { chapter: { id: string } }).chapter.id, chapter.id);

  const story = await invokeForHost(
    'context.read',
    { novelId: novelA.id, chapterId: chapter.id, query: 'memory' },
    context,
  );
  assert.equal(story.ok, true, story.error?.message);
  assert.equal((story.data as { chapter: { novelId: string } }).chapter.novelId, novelA.id);

  const memory = await invokeForHost(
    'memory.search',
    { novelId: novelA.id, query: 'Canonical memory' },
    context,
  );
  assert.equal(memory.ok, true, memory.error?.message);
  assert.equal((memory.data as { items: unknown[] }).items.length, 1);
  assert.equal(memory.source, 'localstorage');

  const crossScope = await invokeForHost(
    'structure.read',
    {
      novelId: novelB.id,
      chapterId: chapter.id,
    },
    {
      novelId: novelB.id,
      chapterId: chapter.id,
      grantedPermissions: ['novel.read', 'chapter.read'],
    },
  );
  assert.equal(crossScope.ok, false);
  assert.equal(crossScope.error?.code, 'SCOPE_MISMATCH');
  assert.deepEqual(
    toolRegistryPrivate.validateSchema(
      crossScope,
      getCanonicalToolDescriptor('structure.read')!.outputSchema,
    ),
    [],
  );
  assert.equal(storageSnapshot(), beforeRead, 'canonical read adapters must not mutate storage');
});

test('canonical adapters reject technical aliases, unknown fields and missing host scope', async () => {
  assert.equal(getCanonicalToolDescriptor('chapter.read_outline'), undefined);
  const legacy = await invokeForHost(
    'chapter.read_outline',
    {
      novelId: 'novel',
      chapterId: 'chapter',
      grantedPermissions: ['novel.read', 'chapter.read'],
    },
    { novelId: 'novel', chapterId: 'chapter' },
  );
  assert.equal(legacy.ok, false);
  assert.equal(legacy.error?.code, 'NOT_FOUND');

  const unknownField = await invokeForHost(
    'novel.read',
    { novelId: 'novel', repository: 'forbidden' },
    { novelId: 'novel', grantedPermissions: ['novel.read'] },
  );
  assert.equal(unknownField.ok, false);
  assert.equal(unknownField.error?.code, 'INVALID_ARGUMENT');

  const missingHostScope = await invokeForHost(
    'novel.read',
    { novelId: 'novel' },
    { grantedPermissions: ['novel.read'] },
  );
  assert.equal(missingHostScope.ok, false);
  assert.equal(missingHostScope.error?.code, 'INVALID_SCOPE');

  const missingPermission = await invokeForHost(
    'novel.read',
    { novelId: 'novel' },
    { novelId: 'novel', grantedPermissions: [] },
  );
  assert.equal(missingPermission.ok, false);
  assert.equal(missingPermission.error?.code, 'PERMISSION_DENIED');
});

test('canonical descriptor contracts match facade input requirements', () => {
  const novel = getCanonicalToolDescriptor('novel.read');
  const structure = getCanonicalToolDescriptor('structure.read');
  const context = getCanonicalToolDescriptor('context.read');
  const memory = getCanonicalToolDescriptor('memory.search');
  assert.deepEqual(novel?.inputSchema.required, ['novelId']);
  assert.deepEqual(structure?.inputSchema.required, ['novelId', 'chapterId']);
  assert.deepEqual(context?.inputSchema.required, ['novelId', 'chapterId']);
  assert.ok(context?.inputSchema.properties?.query);
  assert.deepEqual(memory?.inputSchema.required, ['novelId', 'query']);
});
