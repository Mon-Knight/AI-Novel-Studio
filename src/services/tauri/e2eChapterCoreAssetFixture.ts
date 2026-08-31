/**
 * E2E-only core-asset fixture for the production Workbench readiness gate.
 *
 * The bridge imports this module only in an explicitly enabled E2E build. It
 * uses the real repositories and outline service against the isolated SQLite
 * database, without adding a product command or weakening runtime policy.
 */
import { chapterRepository } from '../database/chapterRepository';
import { isTauri } from '../database/db';
import { novelRepository } from '../database/novelRepository';
import { protagonistRepository } from '../database/protagonistRepository';
import { settingRepository } from '../database/settingRepository';
import { chapterAssetReadinessService } from '../conversation/chapterAssetReadiness';
import { chapterOutlineService } from '../outlines/outlineService';

export interface E2eChapterCoreAssetSeedInput {
  novelId: string;
  worldSetting: {
    title: string;
    content: string;
  };
  ruleSystem: {
    title: string;
    content: string;
    forbiddenRules?: string;
  };
  protagonist: {
    name: string;
    identity: string;
    personality: string;
    goal: string;
  };
  chapters: Array<{
    chapterId: string;
    title: string;
    outline: string;
    targetWordCount: number;
  }>;
}

export interface E2eChapterCoreAssetSeedEvidence {
  storageMode: 'sqlite';
  novelId: string;
  worldSettingId: string;
  ruleSystemId: string;
  protagonistId: string;
  chapterOutlineIds: string[];
  readiness: Array<{
    chapterId: string;
    ready: boolean;
    missingAssets: string[];
  }>;
}

interface E2eChapterCoreAssetFixtureDependencies {
  isDesktop?: () => boolean;
  getNovel?: typeof novelRepository.getById;
  getChapter?: typeof chapterRepository.getById;
  updateChapter?: typeof chapterRepository.update;
  saveWorldSetting?: typeof settingRepository.saveWorldSetting;
  saveRuleSystem?: typeof settingRepository.saveRuleSystem;
  saveProtagonist?: typeof protagonistRepository.save;
  saveChapterOutline?: typeof chapterOutlineService.save;
  setActiveChapterOutline?: typeof chapterOutlineService.setActive;
  inspectReadiness?: typeof chapterAssetReadinessService.inspect;
}

function required(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`E2E core-asset fixture requires ${field}.`);
  return normalized;
}

function requiredPositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`E2E core-asset fixture requires a positive integer ${field}.`);
  }
  return value;
}

export async function seedE2eChapterCoreAssets(
  input: E2eChapterCoreAssetSeedInput,
  dependencies: E2eChapterCoreAssetFixtureDependencies = {},
): Promise<E2eChapterCoreAssetSeedEvidence> {
  const desktop = dependencies.isDesktop ?? isTauri;
  if (!desktop()) throw new Error('E2E core-asset fixture requires the Tauri runtime.');

  const novelId = required(input.novelId, 'novelId');
  if (input.chapters.length === 0) {
    throw new Error('E2E core-asset fixture requires at least one chapter.');
  }

  const getNovel = dependencies.getNovel ?? novelRepository.getById;
  const getChapter = dependencies.getChapter ?? chapterRepository.getById;
  const [novel, ...chapters] = await Promise.all([
    getNovel(novelId),
    ...input.chapters.map(({ chapterId }) => getChapter(required(chapterId, 'chapterId'))),
  ]);
  if (!novel || novel.id !== novelId) {
    throw new Error('E2E core-asset fixture novel does not exist.');
  }
  for (let index = 0; index < chapters.length; index += 1) {
    const chapter = chapters[index];
    if (!chapter || chapter.novelId !== novelId || chapter.id !== input.chapters[index].chapterId) {
      throw new Error('E2E core-asset fixture chapter does not belong to the requested novel.');
    }
  }

  const chapterTargets = input.chapters.map(({ targetWordCount }) =>
    requiredPositiveInteger(targetWordCount, 'chapter.targetWordCount'),
  );

  const updateChapter = dependencies.updateChapter ?? chapterRepository.update;
  const saveWorldSetting = dependencies.saveWorldSetting ?? settingRepository.saveWorldSetting;
  const saveRuleSystem = dependencies.saveRuleSystem ?? settingRepository.saveRuleSystem;
  const saveProtagonist = dependencies.saveProtagonist ?? protagonistRepository.save;
  const saveChapterOutline = dependencies.saveChapterOutline ?? chapterOutlineService.save;
  const setActiveChapterOutline =
    dependencies.setActiveChapterOutline ?? chapterOutlineService.setActive;
  const inspectReadiness = dependencies.inspectReadiness ?? chapterAssetReadinessService.inspect;

  await Promise.all(
    input.chapters.map(async ({ chapterId }, index) => {
      const targetWordCount = chapterTargets[index];
      const updated = await updateChapter(chapterId, { targetWordCount });
      if (!updated || updated.targetWordCount !== targetWordCount) {
        throw new Error('E2E core-asset fixture failed to persist the chapter target word count.');
      }
    }),
  );

  const [worldSetting, ruleSystem, protagonist] = await Promise.all([
    saveWorldSetting(null, {
      novelId,
      title: required(input.worldSetting.title, 'worldSetting.title'),
      content: required(input.worldSetting.content, 'worldSetting.content'),
      isActive: true,
    }),
    saveRuleSystem(null, {
      novelId,
      title: required(input.ruleSystem.title, 'ruleSystem.title'),
      content: required(input.ruleSystem.content, 'ruleSystem.content'),
      forbiddenRules: input.ruleSystem.forbiddenRules?.trim() || undefined,
      isActive: true,
    }),
    saveProtagonist(null, {
      novelId,
      name: required(input.protagonist.name, 'protagonist.name'),
      identity: required(input.protagonist.identity, 'protagonist.identity'),
      personality: required(input.protagonist.personality, 'protagonist.personality'),
      goal: required(input.protagonist.goal, 'protagonist.goal'),
    }),
  ]);

  const chapterOutlineIds: string[] = [];
  for (let index = 0; index < input.chapters.length; index += 1) {
    const chapter = input.chapters[index];
    const outline = await saveChapterOutline({
      projectId: novelId,
      chapterId: chapter.chapterId,
      chapterIndex: index + 1,
      title: required(chapter.title, 'chapter.title'),
      content: required(chapter.outline, 'chapter.outline'),
      sourceType: 'e2e_fixture',
    });
    await setActiveChapterOutline(outline.id, novelId);
    chapterOutlineIds.push(outline.id);
  }

  const readiness = await Promise.all(
    input.chapters.map(async ({ chapterId }) => {
      const result = await inspectReadiness({
        novelId,
        chapterId,
        userInstruction: 'E2E core-asset fixture readiness verification',
      });
      return {
        chapterId,
        ready: result.ready,
        missingAssets: result.missingAssets,
      };
    }),
  );
  if (readiness.some((result) => !result.ready || result.missingAssets.length > 0)) {
    throw new Error('E2E core-asset fixture did not satisfy the production readiness gate.');
  }

  return {
    storageMode: 'sqlite',
    novelId,
    worldSettingId: worldSetting.id,
    ruleSystemId: ruleSystem.id,
    protagonistId: protagonist.id,
    chapterOutlineIds,
    readiness,
  };
}
