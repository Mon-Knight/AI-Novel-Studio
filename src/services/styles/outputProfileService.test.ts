import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';
import { createServer } from 'vite';
import type { CreateOutputProfileInput, OutputProfile } from '../../types/output';

const OUTPUT_KEY = 'ai_novel_studio_output_profiles';

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

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
});

const vite = await createServer({
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
});
const outputProfileModule = (await vite.ssrLoadModule(
  '/src/services/styles/outputProfileService.ts',
)) as typeof import('./outputProfileService');
const { outputProfileService } = outputProfileModule;

after(async () => {
  await vite.close();
});

beforeEach(() => {
  storage.clear();
});

function readStoredProfiles(): OutputProfile[] {
  return JSON.parse(storage.getItem(OUTPUT_KEY) ?? '[]') as OutputProfile[];
}

function profileInput(name: string, novelId?: string): CreateOutputProfileInput {
  return {
    novelId,
    name,
    targetWordCount: 2400,
    minWordCount: 1800,
    maxWordCount: 3200,
    paceLevel: 'medium',
    dialogueRatio: 0.3,
    descriptionRatio: 0.45,
  };
}

test('getAll seeds defaults once when LocalStorage is empty', async () => {
  const seeded = await outputProfileService.getAll();

  assert.equal(seeded.length, 3);
  assert.deepEqual(readStoredProfiles(), seeded);
  assert.equal(seeded.filter((profile) => profile.isDefault).length, 1);
  assert.ok(seeded.every((profile) => profile.id.length > 0));
  assert.ok(seeded.every((profile) => profile.createdAt === profile.updatedAt));

  const secondRead = await outputProfileService.getAll();
  assert.deepEqual(
    secondRead.map((profile) => profile.id),
    seeded.map((profile) => profile.id),
  );
  assert.equal(readStoredProfiles().length, 3);
});

test('create derives output defaults and persists the complete profile', async () => {
  const created = await outputProfileService.create({
    ...profileInput('Novel A profile', 'novel-a'),
    endingHookRequired: true,
    isDefault: true,
    forbiddenItems: ['deus ex machina'],
  });

  assert.match(created.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(created.chapterWordRange, {
    min: 1800,
    max: 3200,
    default: 2400,
  });
  assert.equal(created.paragraphLength, 'medium');
  assert.equal(created.povType, 'third_person_limited');
  assert.equal(created.tenseType, 'past');
  assert.equal(created.endingHookRequired, true);
  assert.equal(created.isDefault, true);
  assert.equal(created.createdAt, created.updatedAt);
  assert.deepEqual(readStoredProfiles(), [created]);

  const found = await outputProfileService.getById(created.id);
  assert.deepEqual(found, created);
  assert.equal(await outputProfileService.getById('missing-profile'), null);
});

test('getAll filters by novel while keeping shared profiles available', async () => {
  const shared = await outputProfileService.create(profileInput('Shared profile'));
  const novelA = await outputProfileService.create(profileInput('Novel A profile', 'novel-a'));
  const novelB = await outputProfileService.create(profileInput('Novel B profile', 'novel-b'));

  const forNovelA = await outputProfileService.getAll('novel-a');
  assert.deepEqual(
    forNovelA.map((profile) => profile.id),
    [shared.id, novelA.id],
  );

  const forUnknownNovel = await outputProfileService.getAll('novel-missing');
  assert.deepEqual(
    forUnknownNovel.map((profile) => profile.id),
    [shared.id],
  );

  const unfiltered = await outputProfileService.getAll();
  assert.deepEqual(
    unfiltered.map((profile) => profile.id),
    [shared.id, novelA.id, novelB.id],
  );
});

test('update merges fields, recalculates word range, and leaves missing IDs untouched', async () => {
  const created = await outputProfileService.create(profileInput('Original', 'novel-a'));
  const updated = await outputProfileService.update(created.id, {
    name: 'Updated',
    minWordCount: 2000,
    targetWordCount: 2600,
    paceLevel: 'fast',
  });

  assert.ok(updated);
  assert.equal(updated.id, created.id);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.name, 'Updated');
  assert.equal(updated.paceLevel, 'fast');
  assert.deepEqual(updated.chapterWordRange, {
    min: 2000,
    max: 3200,
    default: 2600,
  });
  assert.deepEqual(readStoredProfiles(), [updated]);

  const renamed = await outputProfileService.update(created.id, {
    name: 'Renamed only',
  });
  assert.ok(renamed);
  assert.equal(renamed.name, 'Renamed only');
  assert.deepEqual(renamed.chapterWordRange, updated.chapterWordRange);

  const beforeMissingUpdate = storage.getItem(OUTPUT_KEY);
  assert.equal(await outputProfileService.update('missing-profile', { name: 'Ignored' }), null);
  assert.equal(storage.getItem(OUTPUT_KEY), beforeMissingUpdate);
});

test('remove deletes only the requested profile and is idempotent for missing IDs', async () => {
  const first = await outputProfileService.create(profileInput('First', 'novel-a'));
  const second = await outputProfileService.create(profileInput('Second', 'novel-a'));

  await outputProfileService.remove(first.id);
  assert.equal(await outputProfileService.getById(first.id), null);
  assert.deepEqual(readStoredProfiles(), [second]);

  const beforeMissingRemove = storage.getItem(OUTPUT_KEY);
  await outputProfileService.remove('missing-profile');
  assert.equal(storage.getItem(OUTPUT_KEY), beforeMissingRemove);
  assert.deepEqual(await outputProfileService.getById(second.id), second);
});

test('setDefault keeps one default per scope and rejects cross-scope or missing targets', async () => {
  const sharedFirst = await outputProfileService.create(profileInput('Shared first'));
  const sharedSecond = await outputProfileService.create(profileInput('Shared second'));
  const projectFirst = await outputProfileService.create(profileInput('Project first', 'novel-a'));
  const projectSecond = await outputProfileService.create(
    profileInput('Project second', 'novel-a'),
  );

  await outputProfileService.setDefault(undefined, sharedSecond.id);
  await outputProfileService.setDefault('novel-a', projectSecond.id);

  let stored = readStoredProfiles();
  assert.deepEqual(
    stored.filter((profile) => !profile.novelId && profile.isDefault).map((profile) => profile.id),
    [sharedSecond.id],
  );
  assert.deepEqual(
    stored
      .filter((profile) => profile.novelId === 'novel-a' && profile.isDefault)
      .map((profile) => profile.id),
    [projectSecond.id],
  );
  assert.equal(stored.find((profile) => profile.id === sharedFirst.id)?.isDefault, false);
  assert.equal(stored.find((profile) => profile.id === projectFirst.id)?.isDefault, false);

  const beforeRejectedSwitch = storage.getItem(OUTPUT_KEY);
  await assert.rejects(
    outputProfileService.setDefault('novel-b', projectSecond.id),
    /不存在或不属于当前作品/,
  );
  await assert.rejects(
    outputProfileService.setDefault(undefined, 'missing-profile'),
    /不存在或不属于当前作品/,
  );
  assert.equal(storage.getItem(OUTPUT_KEY), beforeRejectedSwitch);
  stored = readStoredProfiles();
  assert.equal(stored.find((profile) => profile.id === projectSecond.id)?.isDefault, true);
});
