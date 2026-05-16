/**
 * AI Novel Studio - 上下文构建器（v0.7.0 增强版）
 */
import { novelRepository } from '../database/novelRepository';
import { settingRepository } from '../database/settingRepository';
import { protagonistRepository } from '../database/protagonistRepository';
import { volumeRepository } from '../database/volumeRepository';
import { styleProfileService } from '../styles/styleProfileService';
import { outputProfileService } from '../styles/outputProfileService';
import { characterService } from '../characters/characterService';
import { chapterCharacterService } from '../characters/chapterCharacterService';
import { chapterEventService } from '../characters/chapterEventService';
import type { ChapterGenerationContext } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type { StyleProfile } from '../../types/style';
import type { OutputProfile } from '../../types/output';

function extractText(summary: string | undefined | null): string | undefined {
  return summary?.trim() || undefined;
}

export async function buildChapterContext(
  novelId: string,
  chapter: Chapter,
  userInstruction?: string,
  styleId?: string,
  outputId?: string,
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

  // 加载风格和输出控制方案
  let styleProfileSummary: string | undefined;
  let outputProfileSummary: string | undefined;
  if (styleId || outputId) {
    const [styles, outputs] = await Promise.all([
      styleId ? styleProfileService.getById(styleId) : Promise.resolve(null),
      outputId ? outputProfileService.getById(outputId) : Promise.resolve(null),
    ]);
    if (styles) styleProfileSummary = buildStyleSummary(styles);
    if (outputs) outputProfileSummary = buildOutputSummary(outputs);
  }

  // v0.7.0 加载本章出场角色和事件
  let chapterCharacterSummary: string | undefined;
  let chapterEventSummary: string | undefined;
  if (chapter.id) {
    const [chapterChars, chapterEvents] = await Promise.all([
      chapterCharacterService.getByChapterId(chapter.id),
      chapterEventService.getByChapterId(chapter.id),
    ]);
    if (chapterChars.length > 0) {
      const chars = await characterService.getByNovelId(novelId);
      chapterCharacterSummary = chapterChars.map((cc) => {
        const ch = chars.find((c) => c.id === cc.characterId);
        const parts = [`- ${ch?.name || cc.characterName || '未知'}（出场方式：${cc.mustAppear ? '必须出场' : '可选'}; 角色：${cc.roleInChapter}）`];
        if (ch?.personality) parts.push(`  性格：${ch.personality}`);
        if (ch?.goal) parts.push(`  目标：${ch.goal}`);
        if (ch?.forbiddenBehaviors) parts.push(`  禁止行为：${ch.forbiddenBehaviors}`);
        return parts.join('\n');
      }).join('\n');
    }
    if (chapterEvents.length > 0) {
      chapterEventSummary = chapterEvents
        .filter((e) => e.status !== 'forbidden' && e.status !== 'discarded')
        .map((e) => {
          const statusTag = e.status === 'required' ? '【必须发生！】' : e.status === 'selected' ? '【已选择】' : '';
          const parts = [`- ${statusTag}${e.title}：${e.description}`];
          if (e.impact) parts.push(`  影响：${e.impact}`);
          if (e.risk) parts.push(`  风险：${e.risk}`);
          return parts.join('\n');
        }).join('\n');
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
    styleProfile: styleProfileSummary,
    outputProfile: outputProfileSummary,
    chapterCharacters: chapterCharacterSummary,
    chapterEvents: chapterEventSummary,
    userInstruction: extractText(userInstruction),
  };
}

function buildStyleSummary(s: StyleProfile): string {
  const parts: string[] = [];
  if (s.narrativePerspective) parts.push(`叙事人称：${s.narrativePerspective}`);
  if (s.tone) parts.push(`文风语气：${s.tone}`);
  if (s.pace) parts.push(`节奏：${s.pace}`);
  if (s.sentenceStyle) parts.push(`句式特点：${s.sentenceStyle}`);
  parts.push(`对话比例：${Math.round(s.dialogueRatio * 100)}%，描写比例：${Math.round(s.descriptionRatio * 100)}%`);
  if (s.battleStyle) parts.push(`战斗描写：${s.battleStyle}`);
  if (s.emotionTendency) parts.push(`情绪倾向：${s.emotionTendency}`);
  if (s.chapterEnding) parts.push(`章节结尾：${s.chapterEnding}`);
  if (s.styleSummary) parts.push(`风格总结：${s.styleSummary}`);
  if (s.prohibitedStyles?.length) parts.push(`禁用写法：${s.prohibitedStyles.join('、')}`);
  return parts.join('\n');
}

function buildOutputSummary(o: OutputProfile): string {
  const parts: string[] = [];
  parts.push(`目标字数：${o.targetWordCount || o.chapterWordRange.default} 字`);
  if (o.paceLevel) parts.push(`节奏等级：${o.paceLevel === 'fast' ? '快' : o.paceLevel === 'slow' ? '慢' : '中等'}`);
  if (o.battleIntensity) parts.push(`战斗强度：${o.battleIntensity}`);
  if (o.emotionTendency) parts.push(`情绪倾向：${o.emotionTendency}`);
  if (o.endingHookRequired) parts.push('结尾必须有钩子');
  if (o.extraRequirements) parts.push(`额外要求：${o.extraRequirements}`);
  if (o.forbiddenItems?.length) parts.push(`禁止项：${o.forbiddenItems.join('、')}`);
  return parts.join('\n');
}
