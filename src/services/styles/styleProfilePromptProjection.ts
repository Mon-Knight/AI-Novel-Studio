import type { StyleProfile, StyleSourceState } from '../../types/style';

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/u;
const SAMPLE_LAYERS = new Set([
  'opening',
  'development',
  'dialogue_dense',
  'description_dense',
  'climax',
  'closing',
]);

export interface StyleProfileTraceSample {
  sectionId: string;
  sectionOrderIndex: number;
  startUtf16: number;
  endUtf16: number;
  contentHash: string;
  layers: string[];
}

export interface StyleProfileTrace {
  sourceState: StyleSourceState;
  sourceReferenceWorkId?: string;
  sourceReferenceImportId?: string;
  sourceContentHash?: string;
  analyzerVersion?: string;
  promptVersion?: string;
  model?: {
    runtimeMode?: string;
    provider?: string;
    modelName?: string;
  };
  confidenceOverall?: number;
  samples: StyleProfileTraceSample[];
}

export const STYLE_SOURCE_STATE_LABELS: Record<StyleSourceState, string> = {
  none: '无来源绑定',
  available: '来源可用',
  outdated: '来源已过期',
  missing: '来源缺失',
  legacy_unverified: '旧版来源待验证',
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safeId(value: unknown): string | undefined {
  return typeof value === 'string' && ID_PATTERN.test(value) ? value : undefined;
}

function safeHash(value: unknown): string | undefined {
  return typeof value === 'string' && HASH_PATTERN.test(value) ? value : undefined;
}

function safeSingleLine(value: unknown, maximum = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .replace(/[\r\n\t]+/gu, ' ')
    .trim()
    .slice(0, maximum);
  return normalized || undefined;
}

function safeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function parseMetadata(profile: StyleProfile): Record<string, unknown> | undefined {
  if (!profile.analysisMetadataJson) return undefined;
  try {
    return asRecord(JSON.parse(profile.analysisMetadataJson));
  } catch {
    return undefined;
  }
}

function identitiesMatch(profile: StyleProfile, metadata: Record<string, unknown>): boolean {
  const metadataWorkId = safeId(metadata.sourceWorkId);
  const metadataImportId = safeId(metadata.sourceImportId);
  const metadataHash = safeHash(metadata.sourceHash);
  return (
    (!metadataWorkId ||
      metadataWorkId === profile.sourceReferenceWorkId ||
      (profile.sourceState === 'missing' && !profile.sourceReferenceWorkId)) &&
    (!metadataImportId ||
      metadataImportId === profile.sourceReferenceImportId ||
      (profile.sourceState === 'missing' && !profile.sourceReferenceImportId)) &&
    (!metadataHash || metadataHash === profile.sourceContentHash)
  );
}

function parseSamples(value: unknown): StyleProfileTraceSample[] {
  if (!Array.isArray(value)) return [];
  const samples: StyleProfileTraceSample[] = [];
  for (const candidate of value.slice(0, 12)) {
    const sample = asRecord(candidate);
    if (!sample) continue;
    const sectionId = safeId(sample.sectionId);
    const sectionOrderIndex = safeInteger(sample.sectionOrderIndex);
    const startUtf16 = safeInteger(sample.startUtf16);
    const endUtf16 = safeInteger(sample.endUtf16);
    const contentHash = safeHash(sample.contentHash);
    if (
      !sectionId ||
      sectionOrderIndex === undefined ||
      startUtf16 === undefined ||
      endUtf16 === undefined ||
      endUtf16 <= startUtf16 ||
      !contentHash
    ) {
      continue;
    }
    const layers = Array.isArray(sample.layers)
      ? sample.layers.filter(
          (layer): layer is string => typeof layer === 'string' && SAMPLE_LAYERS.has(layer),
        )
      : [];
    samples.push({
      sectionId,
      sectionOrderIndex,
      startUtf16,
      endUtf16,
      contentHash,
      layers: [...new Set(layers)].sort(),
    });
  }
  return samples;
}

/**
 * Reads only replay metadata. Unknown metadata fields, per-layer payloads and
 * any accidental source/sample text are deliberately discarded.
 */
export function getStyleProfileTrace(profile: StyleProfile): StyleProfileTrace {
  const sourceState = profile.sourceState ?? 'none';
  const trace: StyleProfileTrace = {
    sourceState,
    sourceReferenceWorkId: safeId(profile.sourceReferenceWorkId),
    sourceReferenceImportId: safeId(profile.sourceReferenceImportId),
    sourceContentHash: safeHash(profile.sourceContentHash),
    samples: [],
  };
  const metadata = parseMetadata(profile);
  if (!metadata || !identitiesMatch(profile, metadata)) return trace;

  if (profile.sourceState === 'missing') {
    trace.sourceReferenceWorkId ??= safeId(metadata.sourceWorkId);
    trace.sourceReferenceImportId ??= safeId(metadata.sourceImportId);
  }

  trace.analyzerVersion = safeSingleLine(metadata.analyzerVersion);
  trace.promptVersion = safeSingleLine(metadata.promptVersion);
  const model = asRecord(metadata.model);
  if (model) {
    const safeModel = {
      runtimeMode: safeSingleLine(model.runtimeMode, 32),
      provider: safeSingleLine(model.provider, 80),
      modelName: safeSingleLine(model.modelName, 120),
    };
    if (Object.values(safeModel).some(Boolean)) trace.model = safeModel;
  }
  const confidence = asRecord(metadata.confidence);
  const overall = confidence?.overall;
  if (typeof overall === 'number' && Number.isFinite(overall) && overall >= 0 && overall <= 1) {
    trace.confidenceOverall = Number(overall.toFixed(4));
  }
  trace.samples = parseSamples(metadata.samples);
  return trace;
}

/** Builds the only style-profile representation permitted in chapter prompts. */
export function buildStylePromptProjection(profile: StyleProfile): string {
  const parts: string[] = [];
  if (profile.narrativePerspective) parts.push(`叙事人称：${profile.narrativePerspective}`);
  if (profile.tone) parts.push(`文风语气：${profile.tone}`);
  if (profile.pace) parts.push(`节奏：${profile.pace}`);
  if (profile.sentenceStyle) parts.push(`句式特点：${profile.sentenceStyle}`);
  parts.push(
    `对话比例：${Math.round(profile.dialogueRatio * 100)}%，描写比例：${Math.round(profile.descriptionRatio * 100)}%`,
  );
  if (profile.psychologicalRatio !== undefined) {
    parts.push(`心理描写比例：${Math.round(profile.psychologicalRatio * 100)}%`);
  }
  if (profile.battleStyle) parts.push(`战斗描写：${profile.battleStyle}`);
  if (profile.battleIntensity) parts.push(`战斗强度：${profile.battleIntensity}`);
  if (profile.emotionTendency) parts.push(`情绪倾向：${profile.emotionTendency}`);
  if (profile.chapterEnding) parts.push(`章节结尾：${profile.chapterEnding}`);
  if (profile.styleSummary) parts.push(`风格总结：${profile.styleSummary}`);
  const forbiddenStyles = profile.forbiddenStyles ?? profile.prohibitedStyles;
  if (forbiddenStyles.length) parts.push(`禁用写法：${forbiddenStyles.join('、')}`);

  const trace = getStyleProfileTrace(profile);
  if (
    trace.sourceState !== 'none' ||
    trace.sourceReferenceWorkId ||
    trace.sourceReferenceImportId ||
    trace.sourceContentHash
  ) {
    parts.push(`画像追溯元数据：${JSON.stringify(trace)}`);
  }
  return parts.join('\n');
}
