import { characterService } from '../characters/characterService';
import { chapterRepository } from '../database/chapterRepository';
import { novelRepository } from '../database/novelRepository';
import { settingRepository } from '../database/settingRepository';
import { volumeRepository } from '../database/volumeRepository';
import {
  chapterOutlineService,
  masterOutlineService,
  volumeOutlineService,
} from '../outlines/outlineService';
import { outputProfileService } from '../styles/outputProfileService';
import {
  selectGenerationOutputProfile,
  selectGenerationStyleProfile,
} from '../styles/generationProfileResolver';
import { styleProfileService } from '../styles/styleProfileService';
import { buildStylePromptProjection } from '../styles/styleProfilePromptProjection';
import { contextRecordService } from './contextRecordService';
import { chapterSummaryService } from './chapterSummaryService';
import type { ContextRecord } from '../../types/context';

export const CONTEXT_COMPRESSION_PROVIDER_ID = 'ans.novel-context.extractive-v1';
export const CONTEXT_COMPRESSION_PROVIDER_VERSION = '1.1.0';
export const CONTEXT_COMPRESSION_TITLE_PREFIX = '小说上下文压缩';
export const DEFAULT_CONTEXT_TOKEN_BUDGET = 4000;

export interface NovelContextCompressionConfig {
  tokenBudget: number;
}

export interface CoverageEvidence {
  characters: { required: string[]; present: string[]; missing: string[] };
  plot: { required: string[]; present: string[]; missing: string[] };
  foreshadow: { required: string[]; present: string[]; missing: string[] };
  timeline: { required: string[]; present: string[]; missing: string[] };
  world: { required: string[]; present: string[]; missing: string[] };
  rules: { required: string[]; present: string[]; missing: string[] };
  outlines: { required: string[]; present: string[]; missing: string[] };
  style: { required: string[]; present: string[]; missing: string[] };
  output: { required: string[]; present: string[]; missing: string[] };
  tokens: { budget: number; used: number; withinBudget: boolean };
}

export interface NovelContextCompressionCandidate {
  providerId: typeof CONTEXT_COMPRESSION_PROVIDER_ID;
  version: typeof CONTEXT_COMPRESSION_PROVIDER_VERSION;
  config: NovelContextCompressionConfig;
  novelId: string;
  sourceRevision: string;
  compressedText: string;
  coverage: CoverageEvidence;
  valid: boolean;
}

export interface AppliedContextCompression {
  recordId: string;
  novelId: string;
  sourceRevision: string;
  previousRecordId?: string;
}

function tokenCount(text: string): number {
  return [...text].length;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function presentIn(text: string, required: string[]): string[] {
  return required.filter((item) => item && text.includes(item));
}

function coverageBucket(text: string, required: string[]): CoverageEvidence['characters'] {
  const present = presentIn(text, required);
  return {
    required,
    present,
    missing: required.filter((item) => !present.includes(item)),
  };
}

function takeUntilBudget(parts: string[], budget: number): string {
  const kept: string[] = [];
  let used = 0;
  for (const part of parts) {
    const next = part.trim();
    if (!next) continue;
    const cost = tokenCount(next) + (kept.length > 0 ? 1 : 0);
    if (used + cost > budget) {
      const remaining = budget - used - (kept.length > 0 ? 1 : 0);
      if (remaining > 8) {
        kept.push(`${[...next].slice(0, remaining).join('').trimEnd()}…`);
      }
      break;
    }
    kept.push(next);
    used += cost;
  }
  return kept.join('\n');
}

function limitPart(value: string | undefined, limit: number): string {
  const text = value?.trim() ?? '';
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 9))}…[已截断]`;
}

function normalizedTimestamp(value: string): string {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? value : timestamp.toISOString();
}

function outputProfileProjection(
  profile: Awaited<ReturnType<typeof outputProfileService.getById>>,
): string {
  if (!profile) return '';
  return [
    `输出方案《${profile.name}》`,
    `字数：${profile.minWordCount ?? profile.chapterWordRange.min}-${profile.maxWordCount ?? profile.chapterWordRange.max}，默认 ${profile.targetWordCount ?? profile.chapterWordRange.default}`,
    profile.paceLevel ? `节奏：${profile.paceLevel}` : '',
    `视角：${profile.povType}；时态：${profile.tenseType}`,
    profile.extraRequirements ? `额外要求：${profile.extraRequirements}` : '',
    profile.forbiddenItems?.length ? `禁止：${profile.forbiddenItems.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function hashRevision(parts: string[]): string {
  const body = parts.join('|');
  let hash = 0;
  for (let index = 0; index < body.length; index += 1) {
    hash = (hash * 33 + body.charCodeAt(index)) >>> 0;
  }
  return `rev-${hash.toString(16).padStart(8, '0')}-${body.length}`;
}

function isCompressedRecord(record: ContextRecord): boolean {
  return record.title.startsWith(CONTEXT_COMPRESSION_TITLE_PREFIX);
}

function isStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === 'string' && item.trim() === item && item.length > 0)
  );
}

function isCoverageBucket(value: unknown): value is CoverageEvidence['characters'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const bucket = value as Record<string, unknown>;
  return (
    isStringList(bucket.required) && isStringList(bucket.present) && isStringList(bucket.missing)
  );
}

export function isContextCompressionCandidate(
  value: unknown,
): value is NovelContextCompressionCandidate {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const config =
    row.config !== null && typeof row.config === 'object' && !Array.isArray(row.config)
      ? (row.config as Record<string, unknown>)
      : undefined;
  const coverage =
    row.coverage !== null && typeof row.coverage === 'object' && !Array.isArray(row.coverage)
      ? (row.coverage as Record<string, unknown>)
      : undefined;
  const tokens =
    coverage?.tokens !== null &&
    typeof coverage?.tokens === 'object' &&
    !Array.isArray(coverage.tokens)
      ? (coverage.tokens as Record<string, unknown>)
      : undefined;
  const tokenBudget = config?.tokenBudget;
  const tokenUsed = tokens?.used;
  const compressedText = row.compressedText;
  const structurallyValid =
    row.providerId === CONTEXT_COMPRESSION_PROVIDER_ID &&
    row.version === CONTEXT_COMPRESSION_PROVIDER_VERSION &&
    typeof tokenBudget === 'number' &&
    Number.isSafeInteger(tokenBudget) &&
    tokenBudget >= 200 &&
    tokenBudget <= 20_000 &&
    typeof row.novelId === 'string' &&
    row.novelId.trim() === row.novelId &&
    row.novelId.length > 0 &&
    typeof row.sourceRevision === 'string' &&
    /^rev-[0-9a-f]{8}-\d+$/.test(row.sourceRevision) &&
    typeof compressedText === 'string' &&
    compressedText.length > 0 &&
    typeof row.valid === 'boolean' &&
    isCoverageBucket(coverage?.characters) &&
    isCoverageBucket(coverage?.plot) &&
    isCoverageBucket(coverage?.foreshadow) &&
    isCoverageBucket(coverage?.timeline) &&
    isCoverageBucket(coverage?.world) &&
    isCoverageBucket(coverage?.rules) &&
    isCoverageBucket(coverage?.outlines) &&
    isCoverageBucket(coverage?.style) &&
    isCoverageBucket(coverage?.output) &&
    typeof tokens?.budget === 'number' &&
    Number.isSafeInteger(tokens.budget) &&
    tokens.budget === tokenBudget &&
    typeof tokenUsed === 'number' &&
    Number.isSafeInteger(tokenUsed) &&
    tokenUsed >= 0 &&
    typeof tokens.withinBudget === 'boolean';
  if (!structurallyValid || !row.valid) return structurallyValid;
  return (
    tokens!.withinBudget === true &&
    tokenUsed === [...(compressedText as string)].length &&
    tokenUsed <= (tokenBudget as number) &&
    [
      coverage!.characters,
      coverage!.plot,
      coverage!.foreshadow,
      coverage!.timeline,
      coverage!.world,
      coverage!.rules,
      coverage!.outlines,
      coverage!.style,
      coverage!.output,
    ].every(
      (bucket) =>
        (bucket as CoverageEvidence['characters']).missing.length === 0 &&
        (bucket as CoverageEvidence['characters']).required.every((item) =>
          (compressedText as string).includes(item),
        ),
    )
  );
}

export const novelContextCompressionProvider = {
  describe() {
    return {
      providerId: CONTEXT_COMPRESSION_PROVIDER_ID,
      version: CONTEXT_COMPRESSION_PROVIDER_VERSION,
      config: { tokenBudget: DEFAULT_CONTEXT_TOKEN_BUDGET } satisfies NovelContextCompressionConfig,
    };
  },

  async propose(
    novelId: string,
    tokenBudget = DEFAULT_CONTEXT_TOKEN_BUDGET,
  ): Promise<NovelContextCompressionCandidate> {
    const budget = Math.max(200, Math.min(tokenBudget, 20_000));
    const novel = await novelRepository.getById(novelId);
    if (!novel) {
      throw new Error(`作品 ${novelId} 不存在，无法压缩上下文。`);
    }
    const [
      characters,
      chapters,
      volumes,
      records,
      summaries,
      worldSettings,
      ruleSystems,
      masterOutline,
      styleProfiles,
      outputProfiles,
    ] = await Promise.all([
      characterService.getByNovelId(novelId),
      chapterRepository.getByNovelId(novelId),
      volumeRepository.getByNovelId(novelId),
      contextRecordService.getByNovelId(novelId),
      chapterSummaryService.getByNovelId(novelId),
      settingRepository.getWorldSettings(novelId),
      settingRepository.getRuleSystems(novelId),
      masterOutlineService.getActive(novelId),
      styleProfileService.getAll(undefined, { initialize: false }),
      outputProfileService.getAll(novelId, { initialize: false }),
    ]);
    const orderedCharacters = [...characters].sort(
      (left, right) =>
        Number(right.isProtagonist || right.roleType === 'protagonist') -
          Number(left.isProtagonist || left.roleType === 'protagonist') ||
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.id.localeCompare(right.id),
    );
    const orderedVolumes = [...volumes].sort(
      (left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id),
    );
    const volumeOrder = new Map(orderedVolumes.map((volume, index) => [volume.id, index]));
    const orderedChapters = [...chapters].sort(
      (left, right) =>
        (volumeOrder.get(left.volumeId ?? '') ?? Number.MAX_SAFE_INTEGER) -
          (volumeOrder.get(right.volumeId ?? '') ?? Number.MAX_SAFE_INTEGER) ||
        left.orderIndex - right.orderIndex ||
        left.id.localeCompare(right.id),
    );
    const orderedRecords = [...records].sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    );
    const activeWorldSettings = worldSettings
      .filter((setting) => setting.isActive)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      );
    const activeRuleSystems = ruleSystems
      .filter((rule) => rule.isActive)
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      );
    const [volumeOutlines, chapterOutlines] = await Promise.all([
      Promise.all(
        orderedVolumes.map((volume) => volumeOutlineService.getActive(novelId, volume.id)),
      ),
      Promise.all(
        orderedChapters.map((chapter) => chapterOutlineService.getActive(novelId, chapter.id)),
      ),
    ]);
    const activeVolumeOutlines = volumeOutlines.filter(
      (outline): outline is NonNullable<typeof outline> => Boolean(outline?.isActive),
    );
    const activeChapterOutlines = chapterOutlines.filter(
      (outline): outline is NonNullable<typeof outline> => Boolean(outline?.isActive),
    );
    const styleProfile = selectGenerationStyleProfile(novelId, styleProfiles) ?? null;
    const outputProfile = selectGenerationOutputProfile(novelId, outputProfiles) ?? null;
    const characterNames = unique([
      novel.protagonistName ?? '',
      ...orderedCharacters.map((character) => character.name),
    ]);
    const chapterTitles = unique(orderedChapters.map((chapter) => chapter.title));
    const timeline = [...chapterTitles];
    const foreshadow = unique(
      orderedRecords
        .filter((record) => record.contextType === 'foreshadow' && !isCompressedRecord(record))
        .map((record) => record.title),
    );
    const world = unique(activeWorldSettings.map((setting) => setting.title));
    const rules = unique([
      ...activeRuleSystems.map((rule) => rule.title),
      ...orderedRecords
        .filter((record) => record.contextType === 'rule' && !isCompressedRecord(record))
        .map((record) => record.title),
    ]);
    const outlineTitles = unique([
      masterOutline?.isActive ? masterOutline.title : '',
      ...activeVolumeOutlines.map((outline) => outline.title),
      ...activeChapterOutlines.map((outline) => outline.title),
    ]);
    const styleNames = unique([styleProfile?.name ?? '']);
    const outputNames = unique([outputProfile?.name ?? '']);
    const sourceRevision = hashRevision([
      novelId,
      normalizedTimestamp(novel.updatedAt),
      ...characterNames,
      ...chapterTitles,
      ...orderedRecords.map(
        (record) => `context:${record.id}:${normalizedTimestamp(record.updatedAt)}`,
      ),
      ...summaries.map(
        (summary) => `summary:${summary.id}:${normalizedTimestamp(summary.updatedAt)}`,
      ),
      ...activeWorldSettings.map(
        (setting) => `world:${setting.id}:${normalizedTimestamp(setting.updatedAt)}`,
      ),
      ...activeRuleSystems.map((rule) => `rule:${rule.id}:${normalizedTimestamp(rule.updatedAt)}`),
      ...(masterOutline?.isActive
        ? [
            `master_outline:${masterOutline.id}:${masterOutline.version}:${normalizedTimestamp(masterOutline.updatedAt)}`,
          ]
        : []),
      ...activeVolumeOutlines.map(
        (outline) =>
          `volume_outline:${outline.id}:${outline.version}:${normalizedTimestamp(outline.updatedAt)}`,
      ),
      ...activeChapterOutlines.map(
        (outline) =>
          `chapter_outline:${outline.id}:${outline.version}:${normalizedTimestamp(outline.updatedAt)}`,
      ),
      ...(styleProfile
        ? [`style:${styleProfile.id}:${normalizedTimestamp(styleProfile.updatedAt)}`]
        : []),
      ...(outputProfile
        ? [`output:${outputProfile.id}:${normalizedTimestamp(outputProfile.updatedAt)}`]
        : []),
    ]);
    const parts = [
      `【作品】${novel.title}${novel.genre ? ` · ${novel.genre}` : ''}`,
      novel.description ? `简介：${novel.description}` : '',
      novel.protagonistName ? `主角：${novel.protagonistName}` : '',
      characterNames.length > 0 ? `人物：${characterNames.join('、')}` : '',
      timeline.length > 0 ? `时间线：${timeline.join(' → ')}` : '',
      world.length > 0 ? `世界设定索引：${world.join('、')}` : '',
      rules.length > 0 ? `规则索引：${rules.join('、')}` : '',
      outlineTitles.length > 0 ? `大纲索引：${outlineTitles.join('、')}` : '',
      styleNames.length > 0 ? `活动风格：${styleNames.join('、')}` : '',
      outputNames.length > 0 ? `默认输出方案：${outputNames.join('、')}` : '',
      activeWorldSettings.length > 0
        ? limitPart(
            activeWorldSettings
              .map((setting) => `世界《${setting.title}》：${setting.content}`)
              .join('\n'),
            500,
          )
        : '',
      activeRuleSystems.length > 0
        ? limitPart(
            activeRuleSystems
              .map(
                (rule) =>
                  `规则《${rule.title}》${rule.category ? `（${rule.category}）` : ''}：${rule.content}${rule.forbiddenRules ? `\n禁止违背：${rule.forbiddenRules}` : ''}`,
              )
              .join('\n'),
            550,
          )
        : '',
      masterOutline?.isActive
        ? `全书大纲《${masterOutline.title}》：${limitPart(masterOutline.content, 450)}`
        : '',
      activeVolumeOutlines.length > 0
        ? limitPart(
            activeVolumeOutlines
              .map((outline) => `分卷大纲《${outline.title}》：${outline.content}`)
              .join('\n'),
            550,
          )
        : '',
      activeChapterOutlines.length > 0
        ? limitPart(
            activeChapterOutlines
              .map((outline) => `章节大纲《${outline.title}》：${outline.content}`)
              .join('\n'),
            750,
          )
        : '',
      styleProfile
        ? `写作风格《${styleProfile.name}》：\n${limitPart(buildStylePromptProjection(styleProfile), 400)}`
        : '',
      outputProfile ? limitPart(outputProfileProjection(outputProfile), 400) : '',
      ...orderedChapters.map((chapter) =>
        chapter.outline
          ? `章《${chapter.title}》：${limitPart(chapter.outline, 600)}`
          : `章《${chapter.title}》`,
      ),
      ...orderedRecords
        .filter((record) => !isCompressedRecord(record))
        .sort((left, right) => right.importance - left.importance)
        .map(
          (record) => `${record.contextType}《${record.title}》：${limitPart(record.content, 700)}`,
        ),
      ...summaries.map(
        (summary) => `总结《${summary.chapterId}》：${limitPart(summary.summary, 700)}`,
      ),
    ];
    const compressedText = takeUntilBudget(parts, budget);
    const coverage: CoverageEvidence = {
      characters: coverageBucket(compressedText, characterNames),
      plot: coverageBucket(compressedText, chapterTitles),
      foreshadow: coverageBucket(compressedText, foreshadow),
      timeline: coverageBucket(compressedText, timeline),
      world: coverageBucket(compressedText, world),
      rules: coverageBucket(compressedText, rules),
      outlines: coverageBucket(compressedText, outlineTitles),
      style: coverageBucket(compressedText, styleNames),
      output: coverageBucket(compressedText, outputNames),
      tokens: {
        budget,
        used: tokenCount(compressedText),
        withinBudget: tokenCount(compressedText) <= budget,
      },
    };
    const valid =
      coverage.tokens.withinBudget &&
      coverage.characters.missing.length === 0 &&
      coverage.plot.missing.length === 0 &&
      coverage.foreshadow.missing.length === 0 &&
      coverage.timeline.missing.length === 0 &&
      coverage.world.missing.length === 0 &&
      coverage.rules.missing.length === 0 &&
      coverage.outlines.missing.length === 0 &&
      coverage.style.missing.length === 0 &&
      coverage.output.missing.length === 0;
    return {
      providerId: CONTEXT_COMPRESSION_PROVIDER_ID,
      version: CONTEXT_COMPRESSION_PROVIDER_VERSION,
      config: { tokenBudget: budget },
      novelId,
      sourceRevision,
      compressedText,
      coverage,
      valid,
    };
  },

  async apply(candidate: NovelContextCompressionCandidate): Promise<AppliedContextCompression> {
    if (!candidate.valid) {
      throw new Error('压缩候选未通过覆盖率或 token 预算校验，不能应用。');
    }
    const existing = (await contextRecordService.getByNovelId(candidate.novelId)).filter(
      isCompressedRecord,
    );
    const previous = existing.find((record) => record.isActive);
    const record = await contextRecordService.create({
      novelId: candidate.novelId,
      contextType: 'plot_progress',
      title: `${CONTEXT_COMPRESSION_TITLE_PREFIX} ${candidate.version} ${candidate.sourceRevision}`,
      content: candidate.compressedText,
      importance: 5,
      isActive: true,
      contentHash: candidate.sourceRevision,
    });
    if (previous && previous.id !== record.id) {
      await contextRecordService.setActive(previous.id, false);
    }
    return {
      recordId: record.id,
      novelId: candidate.novelId,
      sourceRevision: candidate.sourceRevision,
      previousRecordId: previous?.id,
    };
  },

  async rollback(applied: AppliedContextCompression): Promise<void> {
    await contextRecordService.setActive(applied.recordId, false);
    if (applied.previousRecordId) {
      await contextRecordService.setActive(applied.previousRecordId, true);
    }
  },
};
