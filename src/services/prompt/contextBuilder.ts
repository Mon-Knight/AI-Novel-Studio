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
import { getContextForChapterTask, buildContextPromptSection } from './contextReaderService';
import { masterOutlineService, volumeOutlineService, chapterOutlineService } from '../outlines/outlineService';
import { chapterRepository } from '../database/chapterRepository';
import { getCachedChapterOutlineDraft } from './chapterOutlineDraftCache';
import { buildOutlineChecklistText, extractOutlineKeyPoints } from './outlineKeyPointExtractor';
import type { ChapterCharacterContext, ChapterGenerationContext } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type { StyleProfile } from '../../types/style';
import type { OutputProfile } from '../../types/output';

function extractText(summary: string | undefined | null): string | undefined {
  return summary?.trim() || undefined;
}

function parseTimestamp(value?: string): number {
  if (!value) return NaN;
  const normalized = value.replace(/\.(\d{3})\d+/, '.$1');
  return Date.parse(normalized);
}

function isSameOrNewer(left?: string, right?: string): boolean {
  const leftTime = parseTimestamp(left);
  const rightTime = parseTimestamp(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime >= rightTime;
}

async function safeLoad<T>(loader: Promise<T>, fallback: T): Promise<T> {
  try {
    return await loader;
  } catch {
    return fallback;
  }
}

function roleLabel(roleInChapter?: string, roleType?: string, isProtagonist?: boolean): string {
  if (isProtagonist || roleType === 'protagonist') return '主角';
  if (roleInChapter === 'main') return '主要出场';
  if (roleInChapter === 'supporting') return '辅助出场';
  if (roleInChapter === 'mentioned') return '仅提及';
  if (roleInChapter === 'hidden') return '幕后影响';
  if (roleType === 'antagonist') return '反派';
  if (roleType === 'neutral') return '中立';
  return roleInChapter || roleType || '配角';
}

function buildChapterCharacterSummary(characters: ChapterCharacterContext[]): string | undefined {
  if (characters.length === 0) return undefined;
  return characters.map((item, index) => {
    const parts = [
      `${index + 1}. ${item.name}`,
      `- 角色定位：${roleLabel(item.roleInChapter, item.roleType, item.isProtagonist)}`,
      `- 本章要求：${item.mustAppear ? '必须直接出场' : '本章出场'}`,
    ];
    if (item.identity) parts.push(`- 身份/背景：${item.identity}`);
    if (item.faction) parts.push(`- 所属阵营：${item.faction}`);
    if (item.personality) parts.push(`- 性格：${item.personality}`);
    if (item.goal) parts.push(`- 目标：${item.goal}`);
    if (item.behaviorLimits) parts.push(`- 行为限制：${item.behaviorLimits}`);
    if (item.forbiddenBehaviors) parts.push(`- 禁止行为：${item.forbiddenBehaviors}`);
    if (item.note) parts.push(`- 本章备注：${item.note}`);
    return parts.join('\n');
  }).join('\n\n');
}

function buildRequiredCharactersSummary(characters: ChapterCharacterContext[]): string | undefined {
  if (characters.length === 0) return undefined;
  return characters.map((item) => `- ${item.name}：必须在正文中直接出现，并参与本章剧情`).join('\n');
}

export async function buildFreshChapterGenerationContext(params: {
  novelId: string;
  volumeId?: string;
  chapterId: string;
  userInstruction?: string;
  styleId?: string;
  outputId?: string;
  targetWordCount?: number;
  draftContent?: string;
}): Promise<ChapterGenerationContext> {
  const freshChapter = await chapterRepository.getById(params.chapterId);
  if (!freshChapter) {
    throw new Error('无法读取当前章节最新配置，生成已停止。');
  }
  const effectiveChapter: Chapter = {
    ...freshChapter,
    volumeId: freshChapter.volumeId || params.volumeId,
    targetWordCount: params.targetWordCount && params.targetWordCount > 0
      ? params.targetWordCount
      : freshChapter.targetWordCount,
  };
  return buildChapterContext(
    params.novelId,
    effectiveChapter,
    params.userInstruction,
    params.styleId,
    params.outputId,
    params.draftContent,
  );
}

export async function buildChapterContext(
  novelId: string,
  chapter: Chapter,
  userInstruction?: string,
  styleId?: string,
  outputId?: string,
  draftContent?: string,
): Promise<ChapterGenerationContext> {
  const [novel, worldSettings, ruleSystems, protagonist] = await Promise.all([
    novelRepository.getById(novelId),
    settingRepository.getWorldSettings(novelId),
    settingRepository.getRuleSystems(novelId),
    protagonistRepository.getByNovelId(novelId),
  ]);

  const [activeMasterOutline, activeVolumeOutline, activeChapterOutline] = await Promise.all([
    safeLoad(masterOutlineService.getActive(novelId), null),
    chapter.volumeId ? safeLoad(volumeOutlineService.getActive(novelId, chapter.volumeId), null) : Promise.resolve(null),
    chapter.id ? safeLoad(chapterOutlineService.getActive(novelId, chapter.id), null) : Promise.resolve(null),
  ]);

  const activeWorld = worldSettings.find((w) => w.isActive) || worldSettings[0];
  const activeRules = ruleSystems.filter((r) => r.isActive);

  // 正文生成优先使用“当前采用”的总纲/分卷大纲/章节大纲，字段草稿只作为降级来源。
  const activeMasterOutlineText = extractText(activeMasterOutline?.content);
  const novelFieldOutline = extractText(novel?.outline);
  const novelDescription = extractText(novel?.description);
  const novelOutline = activeMasterOutlineText || novelFieldOutline || novelDescription;
  const masterOutlineSource: ChapterGenerationContext['masterOutlineSource'] = activeMasterOutlineText
    ? 'active_outline'
    : novelFieldOutline
      ? 'novel_field'
      : novelDescription
        ? 'novel_description'
        : 'none';

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
      const activeVolumeOutlineText = extractText(activeVolumeOutline?.content);
      // v1.0.25 分卷大纲（优先当前采用分卷大纲，降级从 summary 和 goal 组合）
      volumeOutline = activeVolumeOutlineText || [volume.summary, volume.goal]
        .filter(Boolean)
        .join('\n')
        .trim() || undefined;
    }
  }
  const volumeOutlineSource: ChapterGenerationContext['volumeOutlineSource'] = extractText(activeVolumeOutline?.content)
    ? 'active_outline'
    : volumeOutline
      ? 'volume_field'
      : 'none';
  const cachedChapterOutlineDraft = chapter.id ? getCachedChapterOutlineDraft(chapter.id) : null;
  const cachedChapterOutlineText = cachedChapterOutlineDraft !== null
    ? extractText(cachedChapterOutlineDraft)
    : undefined;
  const activeChapterOutlineText = extractText(activeChapterOutline?.content);
  const chapterFieldOutlineText = extractText(chapter.outline);
  const shouldPreferChapterFieldOutline = !!chapterFieldOutlineText
    && (!activeChapterOutlineText
      || (
        chapterFieldOutlineText !== activeChapterOutlineText
        && isSameOrNewer(chapter.updatedAt, activeChapterOutline?.updatedAt)
      ));
  const chapterOutline = cachedChapterOutlineDraft !== null
    ? cachedChapterOutlineText
    : shouldPreferChapterFieldOutline
      ? chapterFieldOutlineText
      : activeChapterOutlineText || chapterFieldOutlineText;
  const resolvedChapterOutlineSource: ChapterGenerationContext['chapterOutlineSource'] = cachedChapterOutlineDraft !== null
    ? 'draft'
    : shouldPreferChapterFieldOutline
      ? 'chapter_field'
      : activeChapterOutlineText
        ? 'active_chapter_outline'
        : chapterFieldOutlineText
          ? 'chapter_field'
          : 'empty';
  const outlineKeyPoints = extractOutlineKeyPoints(chapterOutline || '');
  const outlineChecklistText = buildOutlineChecklistText(outlineKeyPoints, chapterOutline);

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
  let requiredCharactersSummary: string | undefined;
  let requiredCharacterNames: string | undefined;
  let chapterEventSummary: string | undefined;
  let protagonistMustAppear = false;
  let chapterCharacterContexts: ChapterCharacterContext[] = [];
  let requiredCharacterContexts: ChapterCharacterContext[] = [];
  const protagonistsInChapterNames: string[] = [];
  const protagonistsNotInChapterNames: string[] = [];
  if (chapter.id) {
    const [chapterChars, chapterEvents] = await Promise.all([
      chapterCharacterService.getByChapterId(chapter.id),
      chapterEventService.getByChapterId(chapter.id),
    ]);
    if (chapterChars.length > 0) {
      const chars = await characterService.getByNovelId(novelId);
      chapterCharacterContexts = chapterChars.map((cc) => {
        const ch = chars.find((c) => c.id === cc.characterId);
        const isProtagonist = ch?.isProtagonist || ch?.roleType === 'protagonist';
        if (isProtagonist) {
          protagonistMustAppear = protagonistMustAppear || cc.mustAppear || cc.roleInChapter === 'main';
          protagonistsInChapterNames.push(ch?.name || cc.characterName || '未知');
        }
        return {
          id: cc.id,
          novelId: cc.novelId,
          chapterId: cc.chapterId,
          characterId: cc.characterId,
          name: ch?.name || cc.characterName || '未知',
          roleInChapter: cc.roleInChapter,
          roleType: ch?.roleType,
          identity: ch?.identity,
          faction: ch?.faction,
          goal: ch?.goal,
          personality: ch?.personality,
          behaviorLimits: ch?.behaviorLimits,
          forbiddenBehaviors: ch?.forbiddenBehaviors,
          note: cc.note,
          mustAppear: cc.mustAppear,
          isProtagonist,
        };
      });
      requiredCharacterContexts = chapterCharacterContexts.filter((item) => item.mustAppear);
      if (chapterCharacterContexts.length > 0 && requiredCharacterContexts.length === 0) {
        // 兼容旧数据：历史 chapter_characters 可能没有 must_appear，默认本章出场角色都必须直接出场。
        chapterCharacterContexts = chapterCharacterContexts.map((item) => ({ ...item, mustAppear: true }));
        requiredCharacterContexts = chapterCharacterContexts;
      }
      chapterCharacterSummary = buildChapterCharacterSummary(chapterCharacterContexts);
      requiredCharactersSummary = buildRequiredCharactersSummary(requiredCharacterContexts);
      requiredCharacterNames = requiredCharacterContexts.map((item) => item.name).filter(Boolean).join('、') || undefined;
      // 找出本章不在出场角色中的主角
      for (const ch of chars) {
        if ((ch.isProtagonist || ch.roleType === 'protagonist') && !protagonistsInChapterNames.includes(ch.name)) {
          protagonistsNotInChapterNames.push(ch.name);
        }
      }
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

  // v1.7.15 使用统一上下文读取服务，分区注入 Prompt
  let previousContext: string | undefined;
  try {
    const contextResult = await getContextForChapterTask({
      novelId,
      chapterId: chapter.id,
      volumeId: chapter.volumeId,
      taskType: 'chapter_generate',
    });
    if (contextResult.chapterSummaries.length > 0 || contextResult.volumeContexts.length > 0) {
      previousContext = buildContextPromptSection(contextResult);
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
    ? (() => {
        const parts: string[] = [];
        if (protagonistsInChapterNames.length > 0) {
          parts.push(`本章出场主角：${protagonistsInChapterNames.join('、')}。`);
          if (protagonistMustAppear) {
            parts.push('至少有一位主角必须直接出场并推动本章目标。');
          }
        }
        if (protagonistsNotInChapterNames.length > 0) {
          parts.push(`本章不直接出场主角：${protagonistsNotInChapterNames.join('、')}（不直接出场，但其影响/绑定关系/未来伏笔仍可作为隐性推动）。`);
        }
        if (parts.length === 0) {
          parts.push('本章主角未加入出场角色，不要强制主角直接出场；剧情仍需服务主线和后续发展。');
        }
        return parts.join(' ');
      })()
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

  const generationContext: ChapterGenerationContext = {
    novelTitle: novel?.title || '',
    novelGenre: novel?.genre,
    novelDescription: extractText(novel?.description),
    novelOutline,
    masterOutline: novelOutline,
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
    chapterOutline,
    outlineKeyPoints,
    outlineChecklistText,
    chapterGoal: extractText(chapter.goal),
    targetWordCount: resolvedTargetWordCount,
    styleProfile: styleProfileSummary,
    outputProfile: resolvedOutputProfileSummary,
    chapterCharacters: chapterCharacterSummary,
    chapterCharacterList: chapterCharacterContexts,
    requiredCharacters: requiredCharacterContexts,
    requiredCharactersSummary,
    requiredCharacterNames,
    chapterEvents: chapterEventSummary,
    chapterSettings: chapterSettingsSummary,
    previousContext,
    userInstruction: extractText(userInstruction),
    draftContent: extractText(draftContent),
    chapterOutlineSource: resolvedChapterOutlineSource,
    volumeOutlineSource,
    masterOutlineSource,
  };

  if (import.meta.env.DEV) {
    console.info(`[ContextBuilder] chapterId=${chapter.id}`);
    console.info(`[ContextBuilder] chapterTitle=${chapter.title}`);
    console.info(`[ContextBuilder] chapterOutlineSource=${resolvedChapterOutlineSource}`);
    console.info(`[ContextBuilder] chapterOutlineLength=${chapterOutline?.length || 0}`);
    console.info(`[ContextBuilder] outlineKeyPoints=${outlineKeyPoints.length}`, outlineKeyPoints.map((point) => point.text));
  }

  return generationContext;
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
