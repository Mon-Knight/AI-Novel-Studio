import { beforeEach, expect, it, vi } from 'vitest';
import type { Character } from '../../types/character';

const mocks = vi.hoisted(() => ({
  desktop: false,
  invoke: vi.fn(),
  storage: new Map<string, unknown>(),
  writes: vi.fn(),
}));
vi.mock('../database/db', () => ({
  dbCall: mocks.invoke,
  isTauri: () => mocks.desktop,
  lsGet: (key: string) => structuredClone(mocks.storage.get(key)),
  lsSet: (key: string, value: unknown) => {
    mocks.writes(key, value);
    mocks.storage.set(key, structuredClone(value));
  },
  generateId: () => 'unused',
  nowISO: () => 'updated',
}));
import { characterService } from './characterService';
import { characterProfileValues, prepareCharacterProfileSave } from './characterProfile';

const character: Character = {
  id: 'character',
  novelId: 'novel',
  name: '人物甲',
  roleType: 'supporting',
  identity: '记录员',
  behaviorLimits: '旧边界',
  forbiddenBehaviors: '不得毁损原件',
  currentState: '仍在调查',
  source: 'manual',
  isActive: true,
  createdAt: 'created',
  updatedAt: 'before',
};

beforeEach(() => {
  mocks.desktop = false;
  mocks.invoke.mockReset();
  mocks.writes.mockReset();
  mocks.storage.clear();
  mocks.storage.set('ai_novel_studio_novels', [{ id: 'novel' }, { id: 'other' }]);
  mocks.storage.set('ai_novel_studio_characters', [character]);
});
function input() {
  return prepareCharacterProfileSave(character, {
    ...characterProfileValues(character),
    behaviorLimits: '新边界',
  });
}

it('uses the guarded native command and returns only a matching persisted character', async () => {
  mocks.desktop = true;
  mocks.invoke.mockResolvedValue({ ...character, behaviorLimits: '新边界', updatedAt: 'after' });
  const request = input();
  expect((await characterService.saveProfile(request)).updatedAt).toBe('after');
  expect(mocks.invoke).toHaveBeenCalledWith('save_character_profile', { input: request });
  expect(mocks.writes).not.toHaveBeenCalled();
  mocks.invoke.mockResolvedValue({ ...character, novelId: 'wrong' });
  await expect(characterService.saveProfile(request)).rejects.toThrow('范围不匹配');
});

it('browser development save clears fields and preserves unrelated identity and state', async () => {
  const saved = await characterService.saveProfile({
    ...input(),
    identity: '',
    behaviorLimits: '',
    forbiddenBehaviors: '',
  });
  expect(saved.identity).toBe('');
  expect(saved.behaviorLimits).toBe('');
  expect(saved.forbiddenBehaviors).toBe('');
  expect(saved.currentState).toBe('仍在调查');
  expect(saved.protagonistKey).toBeUndefined();
  expect(saved.createdAt).toBe('created');
  expect(saved.source).toBe('manual');
  expect(mocks.storage.get('ai_novel_studio_characters')).toEqual([saved]);
});

it.each([
  ['stale baseline', { updatedAt: 'newer' }],
  ['cross project', { novelId: 'other' }],
  ['changed source', { source: 'ai_generated' }],
  ['disabled', { isActive: false }],
])('rejects %s without any local write', async (_name, patch) => {
  mocks.storage.set('ai_novel_studio_characters', [{ ...character, ...patch }]);
  await expect(characterService.saveProfile(input())).rejects.toThrow('CHARACTER_PROFILE_CONFLICT');
  expect(mocks.writes).not.toHaveBeenCalled();
});

it('rejects missing character and deleted project without local writes', async () => {
  mocks.storage.set('ai_novel_studio_characters', []);
  await expect(characterService.saveProfile(input())).rejects.toThrow('CHARACTER_PROFILE_CONFLICT');
  mocks.storage.set('ai_novel_studio_characters', [character]);
  mocks.storage.set('ai_novel_studio_novels', [{ id: 'novel', deletedAt: 'now' }]);
  await expect(characterService.saveProfile(input())).rejects.toThrow('CHARACTER_PROFILE_CONFLICT');
  expect(mocks.writes).not.toHaveBeenCalled();
});

it('keeps native errors visible without browser fallback', async () => {
  mocks.desktop = true;
  mocks.invoke.mockRejectedValue(new Error('CHARACTER_PROFILE_CONFLICT: stale'));
  await expect(characterService.saveProfile(input())).rejects.toThrow('CHARACTER_PROFILE_CONFLICT');
  expect(mocks.writes).not.toHaveBeenCalled();
});

it('keeps protagonist identity consistent when promoting and demoting an unbound role', async () => {
  const promoted = await characterService.saveProfile({ ...input(), roleType: 'protagonist' });
  expect(promoted.isProtagonist).toBe(true);
  expect(promoted.protagonistKey).toBeUndefined();
  const demoted = await characterService.saveProfile(
    prepareCharacterProfileSave(promoted, {
      ...characterProfileValues(promoted),
      roleType: 'supporting',
    }),
  );
  expect(demoted.isProtagonist).toBe(false);
  expect(demoted.roleType).toBe('supporting');
});

it('blocks demotion of a profile bound to protagonist settings in preparation and persistence', async () => {
  const bound: Character = {
    ...character,
    roleType: 'protagonist',
    isProtagonist: true,
    protagonistKey: 'bound',
  };
  expect(() =>
    prepareCharacterProfileSave(bound, {
      ...characterProfileValues(bound),
      roleType: 'supporting',
    }),
  ).toThrow('须保持主角类型');
  mocks.storage.set('ai_novel_studio_characters', [bound]);
  const request = {
    ...prepareCharacterProfileSave(bound, characterProfileValues(bound)),
    roleType: 'neutral' as const,
  };
  await expect(characterService.saveProfile(request)).rejects.toThrow(
    'CHARACTER_PROFILE_BOUND_ROLE',
  );
  expect(mocks.writes).not.toHaveBeenCalled();
});
