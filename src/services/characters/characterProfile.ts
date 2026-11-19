import type { Character, CharacterRoleType } from '../../types/character';

export interface CharacterProfileValues {
  name: string;
  roleType: CharacterRoleType | '';
  identity: string;
  faction: string;
  relationToProtagonist: string;
  personality: string;
  goal: string;
  behaviorLimits: string;
  forbiddenBehaviors: string;
}

export interface SaveCharacterProfileInput extends CharacterProfileValues {
  novelId: string;
  characterId: string;
  expectedUpdatedAt: string;
  expectedSource: string;
}

export function hasProtagonistBinding(character: {
  protagonistKey?: string;
  protagonistLabel?: string;
  source?: string;
}): boolean {
  return Boolean(
    character.protagonistKey?.trim() ||
    character.protagonistLabel?.trim() ||
    String(character.source) === 'protagonist_profile',
  );
}

export function characterProfileValues(
  character: Partial<Omit<Character, 'roleType'>> & {
    roleType?: CharacterRoleType | '';
  },
): CharacterProfileValues {
  return {
    name: character.name ?? '',
    roleType: hasProtagonistBinding(character) ? 'protagonist' : (character.roleType ?? ''),
    identity: character.identity ?? '',
    faction: character.faction ?? '',
    relationToProtagonist: character.relationToProtagonist ?? '',
    personality: character.personality ?? '',
    goal: character.goal ?? '',
    behaviorLimits: character.behaviorLimits ?? '',
    forbiddenBehaviors: character.forbiddenBehaviors ?? '',
  };
}

export function prepareCharacterProfileSave(
  baseline: Character,
  values: CharacterProfileValues,
): SaveCharacterProfileInput {
  if (
    !baseline.id ||
    !baseline.novelId ||
    !baseline.updatedAt ||
    !baseline.source ||
    !baseline.isActive
  )
    throw new Error('人物编辑基线无效，请刷新正式版本。');
  if (!values.name.trim()) throw new Error('角色名称不能为空。');
  if (hasProtagonistBinding(baseline) && values.roleType !== 'protagonist')
    throw new Error('已绑定主角设定的角色须保持主角类型；请在主角设定中管理绑定。');
  return {
    ...characterProfileValues(values),
    name: values.name.trim(),
    novelId: baseline.novelId,
    characterId: baseline.id,
    expectedUpdatedAt: baseline.updatedAt,
    expectedSource: baseline.source,
  };
}

export function requireCharacterProfileBaseline(
  character: Character | undefined,
  input: SaveCharacterProfileInput,
): asserts character is Character {
  if (
    !input.novelId.trim() ||
    !input.characterId.trim() ||
    !input.expectedUpdatedAt.trim() ||
    !input.expectedSource.trim() ||
    !character ||
    character.id !== input.characterId ||
    character.novelId !== input.novelId ||
    !character.isActive ||
    character.updatedAt !== input.expectedUpdatedAt ||
    character.source !== input.expectedSource
  )
    throw new Error('CHARACTER_PROFILE_CONFLICT: 人物档案已变化、停用或删除，请刷新后核对。');
}
