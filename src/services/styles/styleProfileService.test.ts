import assert from 'node:assert/strict';
import test, { after, afterEach } from 'node:test';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { styleProfileService } from './styleProfileService';

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

const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { crypto: globalThis.crypto },
});
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: new MemoryStorage(),
});

afterEach(() => clearMocks());

after(() => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: originalLocalStorage,
  });
});

function styleDto(id: string, projectId: string | null, name: string, isActive: boolean) {
  return {
    id,
    projectId,
    name,
    narrativePerspective: '第三人称有限视角',
    tone: '中性偏沉稳',
    pace: '中等',
    dialogueRatio: 0.35,
    descriptionRatio: 0.4,
    forbiddenStylesJson: '[]',
    styleSummary: '适合大多数小说的通用风格配置。',
    isActive,
    sourceType: projectId === null ? 'system_default' : 'manual',
    sourceState: 'none',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
  };
}

test('Tauri project reads retain authoritative global style profiles', async () => {
  const records = [
    styleDto('style-global', null, '默认小说风格', true),
    styleDto('style-project-a', 'novel-a', '作品 A 风格', true),
    styleDto('style-project-b', 'novel-b', '作品 B 风格', true),
  ];
  mockIPC((command, args) => {
    assert.equal(command, 'list_style_profiles');
    const projectId = (args as { projectId?: string | null }).projectId;
    return projectId
      ? records.filter((profile) => profile.projectId === null || profile.projectId === projectId)
      : records;
  });

  const profiles = await styleProfileService.getAll('novel-a', { initialize: false });

  assert.deepEqual(
    profiles.map((profile) => profile.id),
    ['style-global', 'style-project-a'],
  );
  assert.equal(profiles[0].novelId, undefined);
  assert.equal(profiles[0].sourceType, 'system_default');
});

test('Tauri update and ID-only removal preserve the persisted project owner', async () => {
  let project = styleDto('style-project-a', 'novel-a', '作品 A 风格', true);
  const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
  mockIPC((command, args) => {
    const typedArgs = args as Record<string, unknown>;
    calls.push({ command, args: typedArgs });
    if (command === 'list_style_profiles') return [project];
    if (command === 'save_style_profile') {
      const input = typedArgs.input as Record<string, unknown>;
      project = { ...project, ...input, id: project.id };
      return project;
    }
    if (command === 'delete_style_profile') return undefined;
    throw new Error(`Unexpected command: ${command}`);
  });

  const updated = await styleProfileService.update(project.id, { name: '作品 A 冷峻风' });
  assert.equal(updated?.name, '作品 A 冷峻风');
  const save = calls.find((call) => call.command === 'save_style_profile');
  assert.equal((save?.args.input as Record<string, unknown>).projectId, 'novel-a');
  assert.equal((save?.args.input as Record<string, unknown>).tone, '中性偏沉稳');

  await styleProfileService.remove(project.id);
  const removal = calls.find((call) => call.command === 'delete_style_profile');
  assert.equal(removal?.args.projectId, 'novel-a');
});
