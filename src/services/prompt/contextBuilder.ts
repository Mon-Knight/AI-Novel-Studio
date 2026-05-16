/**
 * AI Novel Studio - 上下文构建器
 * 根据当前章节组装 AI 生成所需的所有上下文信息
 */
import { novelRepository } from '../database/novelRepository';
import { settingRepository } from '../database/settingRepository';
import { protagonistRepository } from '../database/protagonistRepository';
import { volumeRepository } from '../database/volumeRepository';
import type { ChapterGenerationContext } from '../../types/ai';
import type { Chapter } from '../../types/chapter';

function extractText(summary: string | undefined | null): string | undefined {
  return summary?.trim() || undefined;
}

export async function buildChapterContext(
  novelId: string,
  chapter: Chapter,
  userInstruction?: string,
): Promise<ChapterGenerationContext> {
  const [novel, worldSettings, ruleSystems, protagonist] = await Promise.all([
    novelRepository.getById(novelId),
    settingRepository.getWorldSettings(novelId),
    settingRepository.getRuleSystems(novelId),
    protagonistRepository.getByNovelId(novelId),
  ]);

  const activeWorld = worldSettings.find((w) => w.isActive) || worldSettings[0];
  const activeRules = ruleSystems.filter((r) => r.isActive);

  let volumeTitle: string | undefined;
  let volumeGoal: string | undefined;
  let volumeConflict: string | undefined;

  if (chapter.volumeId) {
    const volume = await volumeRepository.getById(chapter.volumeId);
    if (volume) {
      volumeTitle = volume.title;
      volumeGoal = extractText(volume.goal);
      volumeConflict = extractText(volume.mainConflict);
    }
  }

  return {
    novelTitle: novel?.title || '',
    novelGenre: novel?.genre,
    worldBackground: extractText(activeWorld?.content),
    ruleSystems: activeRules.length > 0
      ? activeRules.map((r) => `【${r.title}】${r.content}`).join('\n')
      : undefined,
    protagonist: protagonist?.name,
    specialAbility: extractText(protagonist?.specialAbility),
    abilityLimits: extractText(protagonist?.abilityLimits),
    forbiddenBehaviors: extractText(protagonist?.forbiddenBehaviors),
    volumeTitle,
    volumeGoal,
    volumeConflict,
    chapterTitle: `${chapter.title}`,
    chapterOutline: extractText(chapter.outline),
    chapterGoal: extractText(chapter.goal),
    targetWordCount: chapter.targetWordCount || 4000,
    userInstruction: extractText(userInstruction),
  };
}
