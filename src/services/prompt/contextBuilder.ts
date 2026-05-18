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
import { contextRecordService, buildContextSummary } from '../context/contextRecordService';
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

  // v1.0.26 作品总大纲（优先使用 novel.outline，降级使用 novel.description）
  const novelOutline = extractText(novel?.outline) || extractText(novel?.description);

  let volumeTitle: string | undefined;
  let volumeOutline: string | undefined;
  let volumeGoal: string | undefined;
  let volumeConflict: string | undefined;

  if (chapter.volumeId) {
    const volume = await volumeRepository.getById(chapter.volumeId);
    if (volume) {
      volumeTitle = volume.title;
      volumeGoal = extractText(volume.goal);
      volumeConflict = extractText(volume.mainConflict);
      // v1.0.25 分卷大纲（从 summary 和 goal 组合）
      volumeOutline = [volume.summary, volume.goal]
        .filter(Boolean)
        .join('\n')
        .trim() || undefined;
    }
  }

  // 加载风格和输出控制方案
  let styleProfileSummary: string | undefined;
  let outputProfileSummary: string | undefined;
  let resolvedOutputProfile: OutputProfile | null = null;
  if (styleId || outputId) {
    const [styles, outputs] = await Promise.all([
      styleId ? styleProfileService.getById(styleId) : Promise.resolve(null),
      outputId ? outputProfileService.getById(outputId) : Promise.resolve(null),
    ]);
    if (styles) styleProfileSummary = buildStyleSummary(styles);
    if (outputs) {
      outputProfileSummary = buildOutputSummary(outputs);
      resolvedOutputProfile = outputs;
    }
  }

  // v1.0.25 加载本章设定补充
  let chapterSettingsSummary: string | undefined;
  try {
    const allSettings = await settingRepository.getWorldSettings(novelId);
    // 取最近的几条激活设定作为本章可用设定
    const activeSettings = allSettings.filter((s) => s.isActive).slice(-6);
    if (activeSettings.length > 0) {
      chapterSettingsSummary = activeSettings
        .map((s) => `- ${s.title}：${s.content?.slice(0, 300)}`)
        .join('\n');
    }
  } catch { /* 设定加载失败不影响生成 */ }

  // v0.7.0 加载本章出场角色和事件
  let chapterCharacterSummary: string | undefined;
  let chapterEventSummary: string | undefined;
  let protagonistInChapter = false;
  let protagonistMustAppear = false;
  if (chapter.id) {
    const [chapterChars, chapterEvents] = await Promise.all([
      chapterCharacterService.getByChapterId(chapter.id),
      chapterEventService.getByChapterId(chapter.id),
    ]);
    if (chapterChars.length > 0) {
      const chars = await characterService.getByNovelId(novelId);
      chapterCharacterSummary = chapterChars.map((cc) => {
        const ch = chars.find((c) => c.id === cc.characterId);
        const isProtagonist = ch?.isProtagonist || ch?.roleType === 'protagonist';
        if (isProtagonist) {
          protagonistInChapter = true;
          protagonistMustAppear = cc.mustAppear || cc.roleInChapter === 'main';
        }
        const roleLabel = isProtagonist ? '主角' : cc.roleInChapter;
        const appearance = cc.mustAppear ? '必须出场' : '本章出场';
        const parts = [`- ${ch?.name || cc.characterName || '未知'}：${roleLabel}，${appearance}`];
        if (cc.note) parts.push(`  备注：${cc.note}`);
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

  // v0.8.0 加载前文上下文记录
  let previousContext: string | undefined;
  try {
    const records = await contextRecordService.getForGeneration({
      novelId, chapterId: chapter.id, maxCount: 15,
    });
    if (records.length > 0) {
      previousContext = buildContextSummary(records);
    }
  } catch { /* 上下文加载失败不影响生成 */ }

  // v1.0.28 构建主角信息摘要
  const protagonistMode = novel?.protagonistMode || 'single';
  let protagonistsSummary: string | undefined;
  let dualProtagonistSummary: string | undefined;
  let protagonistNames: string | undefined;
  const prots = novel?.protagonists;
  if (prots && prots.length > 0) {
    protagonistsSummary = prots.map((p) => {
      const parts = [`- ${p.label === 'primary' ? '主角A' : '主角B'}：${p.name}`];
      if (p.identity) parts.push(`  身份：${p.identity}`);
      if (p.personality) parts.push(`  性格：${p.personality}`);
      if (p.goal) parts.push(`  目标：${p.goal}`);
      if (p.motivation) parts.push(`  动机：${p.motivation}`);
      if (p.specialAbility) parts.push(`  特殊能力：${p.specialAbility}`);
      if (p.abilityLimits) parts.push(`  能力限制：${p.abilityLimits}`);
      if (p.forbiddenBehaviors) parts.push(`  禁止行为：${p.forbiddenBehaviors}`);
      if (p.background) parts.push(`  背景：${p.background}`);
      if (p.arc) parts.push(`  人物成长线：${p.arc}`);
      return parts.join('\n');
    }).join('\n\n');
    // v1.0.36: 提取主角名用于硬性约束
    protagonistNames = prots.map((p) => p.name).filter(Boolean).join('、');
  }
  if (!protagonistNames && protagonist?.name) {
    protagonistNames = protagonist.name;
  }
  if (!protagonistsSummary && protagonist?.name) {
    const parts = [`- 主角：${protagonist.name}`];
    if (protagonist.identity) parts.push(`  身份：${protagonist.identity}`);
    if (protagonist.personality) parts.push(`  性格：${protagonist.personality}`);
    if (protagonist.goal) parts.push(`  目标：${protagonist.goal}`);
    if (protagonist.specialAbility) parts.push(`  特殊能力：${protagonist.specialAbility}`);
    if (protagonist.abilityLimits) parts.push(`  能力限制：${protagonist.abilityLimits}`);
    if (protagonist.forbiddenBehaviors) parts.push(`  禁止行为：${protagonist.forbiddenBehaviors}`);
    protagonistsSummary = parts.join('\n');
  }
  const protagonistAppearance = protagonistNames
    ? protagonistInChapter
      ? `本章主角已加入出场角色，${protagonistMustAppear ? '必须直接出场并推动本章目标。' : '可以直接出场，但不强制承担全部行动。'}`
      : '本章主角未加入出场角色，不要强制主角直接出场；剧情仍需服务主线和后续发展。'
    : undefined;
  if (novel?.dualProtagonistRelation?.description) {
    const rel = novel.dualProtagonistRelation;
    const relParts: string[] = [];
    relParts.push(`关系类型：${rel.type}`);
    relParts.push(`关系说明：${rel.description}`);
    if (rel.conflict) relParts.push(`核心冲突：${rel.conflict}`);
    if (rel.cooperation) relParts.push(`合作方式：${rel.cooperation}`);
    if (rel.emotionalProgression) relParts.push(`关系推进：${rel.emotionalProgression}`);
    if (rel.narrativeWeight) relParts.push(`叙事权重：${rel.narrativeWeight === 'balanced' ? '双主角均衡' : rel.narrativeWeight === 'primary_main' ? '主角A更核心' : '主角B更核心'}`);
    dualProtagonistSummary = relParts.join('\n');
  }

  // v1.0.37: 目标字数优先级：章节单独设置 > 输出控制方案 > 系统默认4000
  let resolvedTargetWordCount = 4000; // 最终降级默认值
  let resolvedOutputProfileSummary = outputProfileSummary;
  if (resolvedOutputProfile) {
    const outputTarget = resolvedOutputProfile.targetWordCount
      || resolvedOutputProfile.chapterWordRange?.default;
    if (outputTarget && outputTarget > 0) {
      resolvedTargetWordCount = outputTarget;
    }
    // 附加字数强调
    if (resolvedOutputProfileSummary && !resolvedOutputProfileSummary.includes('必须')) {
      resolvedOutputProfileSummary += `\n本章必须尽量接近目标字数 ${resolvedTargetWordCount} 字，不要默认生成 4000 字。`;
    }
  }
  // 章节单独设置的目标字数优先级最高，覆盖输出控制方案
  if (chapter.targetWordCount && chapter.targetWordCount > 0) {
    resolvedTargetWordCount = chapter.targetWordCount;
  }

  return {
    novelTitle: novel?.title || '',
    novelGenre: novel?.genre,
    novelDescription: extractText(novel?.description),
    novelOutline,
    worldBackground: extractText(activeWorld?.content),
    ruleSystems: activeRules.length > 0
      ? activeRules.map((r) => `【${r.title}】${r.content}`).join('\n')
      : undefined,
    protagonist: protagonist?.name || prots?.[0]?.name,
    specialAbility: extractText(protagonist?.specialAbility) || prots?.[0]?.specialAbility,
    abilityLimits: extractText(protagonist?.abilityLimits) || prots?.[0]?.abilityLimits,
    forbiddenBehaviors: extractText(protagonist?.forbiddenBehaviors) || prots?.[0]?.forbiddenBehaviors,
    protagonistMode,
    protagonistsSummary,
    dualProtagonistSummary,
    protagonistNames,
    protagonistAppearance,
    protagonistMustAppear,
    volumeTitle,
    volumeOutline,
    volumeGoal,
    volumeConflict,
    chapterTitle: `${chapter.title}`,
    chapterOutline: extractText(chapter.outline),
    chapterGoal: extractText(chapter.goal),
    targetWordCount: resolvedTargetWordCount,
    styleProfile: styleProfileSummary,
    outputProfile: resolvedOutputProfileSummary,
    chapterCharacters: chapterCharacterSummary,
    chapterEvents: chapterEventSummary,
    chapterSettings: chapterSettingsSummary,
    previousContext,
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
