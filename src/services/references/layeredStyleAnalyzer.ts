import type { AiGenerateOptions } from '../../types/ai';
import type {
  LayeredStyleResult,
  LayeredStyleSample,
  ReferenceSection,
  ReferenceWork,
  StyleMetricConfidence,
  StyleSampleLayer,
} from '../../types/reference';
import type { StyleAnalyzeResult } from '../../types/style';
import { throwIfAiRequestCancelled } from '../ai/aiCancellation';
import { aiSettingsService } from '../ai/aiSettingsService';
import { analyzeStyle } from '../styles/styleAnalyzeService';

export const LAYERED_STYLE_ANALYZER_VERSION = 'layered_style_analyzer_v1' as const;
export const LAYERED_STYLE_PROMPT_VERSION = 'style_analyze_layered_v1';

const DEFAULT_SAMPLE_CHARS = 4_000;
const MIN_SAMPLE_CHARS = 240;

interface CandidateWindow {
  section: ReferenceSection;
  startUtf16: number;
  endUtf16: number;
  content: string;
  dialogueDensity: number;
  intensityScore: number;
}

export interface LayeredStyleSamplingOptions {
  sampleChars?: number;
}

export interface AnalyzeLayeredReferenceStyleInput {
  work: ReferenceWork;
  importId: string;
  sourceHash: string;
  sections: ReferenceSection[];
  options?: AiGenerateOptions;
}

export interface LayeredStyleAnalyzerDependencies {
  analyzeSample?: (text: string, options: AiGenerateOptions) => Promise<StyleAnalyzeResult>;
}

const stringFields = [
  'narrativePerspective',
  'tone',
  'pace',
  'sentenceStyle',
  'battleStyle',
  'battleIntensity',
  'emotionTendency',
  'chapterEnding',
] as const satisfies ReadonlyArray<keyof StyleAnalyzeResult>;

const numberFields = [
  'dialogueRatio',
  'descriptionRatio',
  'psychologicalRatio',
] as const satisfies ReadonlyArray<keyof StyleAnalyzeResult>;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function dialogueDensity(content: string): number {
  if (!content) return 0;
  let dialogueChars = 0;
  const patterns = [/“[^”]*”/gu, /「[^」]*」/gu, /『[^』]*』/gu, /"[^"\r\n]*"/gu];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) dialogueChars += match[0].length;
  }
  const speechLines = content.match(/^(?:[-—]|[^\r\n]{0,24}[：:])[^\r\n]+$/gmu) ?? [];
  dialogueChars += speechLines.reduce((sum, line) => sum + Math.min(line.length, 160), 0);
  return clamp(dialogueChars / Math.max(1, content.length));
}

function intensityScore(content: string): number {
  if (!content) return 0;
  const punctuation = content.match(/[!！?？…]/gu)?.length ?? 0;
  const actionMarkers = content.match(/[冲撞击破杀逃追爆裂吼喊骤猛]/gu)?.length ?? 0;
  const shortParagraphs = content
    .split(/\r?\n/u)
    .filter((paragraph) => paragraph.trim().length > 0 && paragraph.trim().length <= 80).length;
  return (punctuation * 2 + actionMarkers + shortParagraphs) / Math.max(1, content.length);
}

function normalizeWindowStart(
  contentLength: number,
  desiredStart: number,
  sampleChars: number,
): number {
  return Math.max(0, Math.min(Math.max(0, contentLength - sampleChars), desiredStart));
}

function createCandidate(
  section: ReferenceSection,
  desiredStart: number,
  sampleChars: number,
): CandidateWindow | undefined {
  const startUtf16 = normalizeWindowStart(section.content.length, desiredStart, sampleChars);
  const endUtf16 = Math.min(section.content.length, startUtf16 + sampleChars);
  const content = section.content.slice(startUtf16, endUtf16).trim();
  if (unicodeLength(content) < MIN_SAMPLE_CHARS) return undefined;
  const leadingWhitespace = section.content.slice(startUtf16, endUtf16).search(/\S/u);
  const adjustedStart = leadingWhitespace < 0 ? startUtf16 : startUtf16 + leadingWhitespace;
  return {
    section,
    startUtf16: adjustedStart,
    endUtf16: adjustedStart + content.length,
    content,
    dialogueDensity: dialogueDensity(content),
    intensityScore: intensityScore(content),
  };
}

function candidateWindows(sections: ReferenceSection[], sampleChars: number): CandidateWindow[] {
  const candidates: CandidateWindow[] = [];
  for (const section of sections) {
    const maximumStart = Math.max(0, section.content.length - sampleChars);
    const starts = new Set([
      0,
      Math.floor(maximumStart / 3),
      Math.floor((maximumStart * 2) / 3),
      maximumStart,
    ]);
    for (const start of starts) {
      const candidate = createCandidate(section, start, sampleChars);
      if (candidate) candidates.push(candidate);
    }
  }
  return candidates;
}

function globalPositionCandidate(
  sections: ReferenceSection[],
  ratio: number,
  sampleChars: number,
): CandidateWindow | undefined {
  const totalLength = sections.reduce((sum, section) => sum + section.content.length, 0);
  const target = totalLength * ratio;
  let cursor = 0;
  for (const section of sections) {
    const next = cursor + section.content.length;
    if (target <= next) {
      const center = target - cursor;
      return createCandidate(section, Math.floor(center - sampleChars / 2), sampleChars);
    }
    cursor = next;
  }
  const last = sections[sections.length - 1];
  return last ? createCandidate(last, last.content.length - sampleChars, sampleChars) : undefined;
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('当前环境缺少可靠的 SHA-256，风格抽样已终止。');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Selects deterministic, replayable section-local UTF-16 ranges. Raw sample
 * content is returned only to the caller and is deliberately omitted from the
 * persisted LayeredStyleResult.
 */
export async function selectLayeredStyleSamples(
  sourceSections: ReferenceSection[],
  options: LayeredStyleSamplingOptions = {},
): Promise<LayeredStyleSample[]> {
  const sections = [...sourceSections]
    .filter((section) => section.content.trim().length > 0)
    .sort((left, right) => left.orderIndex - right.orderIndex || left.id.localeCompare(right.id));
  if (sections.length === 0) throw new Error('参考资料没有可分析的正文片段。');
  const sampleChars = Math.max(
    MIN_SAMPLE_CHARS,
    Math.min(8_000, options.sampleChars ?? DEFAULT_SAMPLE_CHARS),
  );
  const candidates = candidateWindows(sections, sampleChars);
  if (candidates.length === 0) throw new Error('参考资料正文过短，无法建立稳定的分层风格画像。');

  const first = createCandidate(sections[0], 0, sampleChars) ?? candidates[0];
  const lastSection = sections[sections.length - 1] ?? sections[0];
  const closing =
    createCandidate(lastSection, lastSection.content.length - sampleChars, sampleChars) ??
    candidates[candidates.length - 1] ??
    first;
  const development = globalPositionCandidate(sections, 0.4, sampleChars) ?? first;
  const dialogue = [...candidates].sort(
    (left, right) =>
      right.dialogueDensity - left.dialogueDensity ||
      left.section.orderIndex - right.section.orderIndex ||
      left.startUtf16 - right.startUtf16,
  )[0];
  const description = [...candidates].sort(
    (left, right) =>
      left.dialogueDensity - right.dialogueDensity ||
      left.intensityScore - right.intensityScore ||
      left.section.orderIndex - right.section.orderIndex ||
      left.startUtf16 - right.startUtf16,
  )[0];
  const climaxPool = candidates.filter(
    (candidate) =>
      candidate.section.orderIndex >= sections[Math.floor(sections.length / 2)].orderIndex,
  );
  const climax = [...(climaxPool.length ? climaxPool : candidates)].sort(
    (left, right) =>
      right.intensityScore - left.intensityScore ||
      right.section.orderIndex - left.section.orderIndex ||
      right.startUtf16 - left.startUtf16,
  )[0];

  const selections: Array<[StyleSampleLayer, CandidateWindow]> = [
    ['opening', first],
    ['development', development],
    ['dialogue_dense', dialogue],
    ['description_dense', description],
    ['climax', climax],
    ['closing', closing],
  ];
  const byRange = new Map<string, { candidate: CandidateWindow; layers: Set<StyleSampleLayer> }>();
  for (const [layer, candidate] of selections) {
    const key = `${candidate.section.id}:${candidate.startUtf16}:${candidate.endUtf16}`;
    const current = byRange.get(key) ?? { candidate, layers: new Set<StyleSampleLayer>() };
    current.layers.add(layer);
    byRange.set(key, current);
  }

  const samples: LayeredStyleSample[] = [];
  for (const { candidate, layers } of byRange.values()) {
    const contentHash = await sha256(candidate.content);
    samples.push({
      sampleId: `style-sample-${contentHash.slice(0, 24)}`,
      sectionId: candidate.section.id,
      sectionOrderIndex: candidate.section.orderIndex,
      sectionTitle: candidate.section.title,
      startUtf16: candidate.startUtf16,
      endUtf16: candidate.endUtf16,
      contentHash,
      layers: [...layers].sort(),
      content: candidate.content,
      charCount: unicodeLength(candidate.content),
      dialogueDensity: candidate.dialogueDensity,
    });
  }
  return samples.sort(
    (left, right) =>
      left.sectionOrderIndex - right.sectionOrderIndex || left.startUtf16 - right.startUtf16,
  );
}

function categoricalConsensus(
  profiles: StyleAnalyzeResult[],
  field: (typeof stringFields)[number],
): { value?: string; confidence: number } {
  const values = profiles
    .map((profile) => profile[field])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());
  if (values.length === 0) return { confidence: 0 };
  const counts = new Map<string, { value: string; count: number }>();
  for (const value of values) {
    const key = value.toLocaleLowerCase();
    const current = counts.get(key) ?? { value, count: 0 };
    current.count += 1;
    counts.set(key, current);
  }
  const winner = [...counts.values()].sort(
    (left, right) => right.count - left.count || left.value.localeCompare(right.value),
  )[0];
  return {
    value: winner.value,
    confidence: clamp((winner.count / values.length) * (values.length / profiles.length)),
  };
}

function numericConsensus(
  profiles: StyleAnalyzeResult[],
  field: (typeof numberFields)[number],
): { value?: number; confidence: number } {
  const values = profiles
    .map((profile) => profile[field])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .map((value) => clamp(value));
  if (values.length === 0) return { confidence: 0 };
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  const agreement = clamp(1 - Math.sqrt(variance) * 2);
  return {
    value: Number(average.toFixed(4)),
    confidence: clamp(agreement * (values.length / profiles.length)),
  };
}

export function mergeLayeredStyleProfiles(
  profiles: StyleAnalyzeResult[],
  name: string,
): { profile: StyleAnalyzeResult; confidence: StyleMetricConfidence } {
  if (profiles.length === 0) throw new Error('分层风格分析没有可合并的结果。');
  const profile: StyleAnalyzeResult = {
    name,
    styleSummary: profiles
      .map((item) => item.styleSummary?.trim())
      .filter((value): value is string => Boolean(value))
      .filter((value, index, all) => all.indexOf(value) === index)
      .join('\n'),
  };
  const byField: Record<string, number> = {};
  for (const field of stringFields) {
    const consensus = categoricalConsensus(profiles, field);
    if (consensus.value !== undefined) Object.assign(profile, { [field]: consensus.value });
    byField[field] = Number(consensus.confidence.toFixed(4));
  }
  for (const field of numberFields) {
    const consensus = numericConsensus(profiles, field);
    if (consensus.value !== undefined) Object.assign(profile, { [field]: consensus.value });
    byField[field] = Number(consensus.confidence.toFixed(4));
  }
  profile.forbiddenStyles = profiles
    .flatMap((item) => item.forbiddenStyles ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .filter((value, index, all) => all.indexOf(value) === index);
  byField.forbiddenStyles = profiles.some((item) => item.forbiddenStyles?.length) ? 0.75 : 0.25;
  byField.styleSummary =
    profiles.filter((item) => item.styleSummary?.trim()).length / profiles.length;
  const values = Object.values(byField);
  const overall = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  return {
    profile,
    confidence: {
      overall: Number(overall.toFixed(4)),
      byField,
      lowConfidenceFields: Object.entries(byField)
        .filter(([, value]) => value < 0.55)
        .map(([field]) => field),
    },
  };
}

export async function analyzeLayeredReferenceStyle(
  input: AnalyzeLayeredReferenceStyleInput,
  dependencies: LayeredStyleAnalyzerDependencies = {},
): Promise<LayeredStyleResult> {
  const requestOptions = input.options ?? {};
  throwIfAiRequestCancelled(requestOptions.signal);
  const samples = await selectLayeredStyleSamples(input.sections);
  const analyzeSample = dependencies.analyzeSample ?? analyzeStyle;
  const layerResults: LayeredStyleResult['layerResults'] = [];
  for (const sample of samples) {
    throwIfAiRequestCancelled(requestOptions.signal);
    const profile = await analyzeSample(sample.content, requestOptions);
    throwIfAiRequestCancelled(requestOptions.signal);
    layerResults.push({ sampleId: sample.sampleId, layers: sample.layers, profile });
  }
  const merged = mergeLayeredStyleProfiles(
    layerResults.map((item) => item.profile),
    `${input.work.title} · 分层风格画像`,
  );
  const settings = aiSettingsService.getSettings();
  return {
    analyzerVersion: LAYERED_STYLE_ANALYZER_VERSION,
    promptVersion: LAYERED_STYLE_PROMPT_VERSION,
    model: {
      runtimeMode: settings.runtimeMode,
      provider: settings.provider,
      modelName: settings.runtimeMode === 'mock' ? 'Mock' : settings.modelName,
    },
    sourceWorkId: input.work.id,
    sourceImportId: input.importId,
    sourceHash: input.sourceHash,
    samples: samples.map(
      ({
        content: _content,
        charCount: _charCount,
        dialogueDensity: _density,
        sampleId: _sampleId,
        ...range
      }) => range,
    ),
    layerResults,
    mergedProfile: merged.profile,
    confidence: merged.confidence,
  };
}
