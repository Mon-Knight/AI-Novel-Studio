import type {
  AiContextBudgetV1,
  AiContextDriftReport,
  AiContextSourceInput,
  AiContextSourceManifestV1,
  AiContextSourceType,
  CompiledAiContextSource,
  CompiledAiContextV1,
} from '../../../types/aiCompilation';
import {
  compareCanonicalText,
  estimateTokens,
  normalizeCompilationText,
  sha256,
  unicodeLength,
  utf8Length,
} from './canonical';
import { AiCompilationError } from './errors';

const MAX_SOURCES = 256;
const MAX_SOURCE_CHARS = 500_000;
const MAX_ID_CHARS = 160;
const MAX_VERSION_CHARS = 96;
const MAX_LABEL_CHARS = 120;
const TRUNCATION_MARKER = '\n[该来源已按上下文预算截断]';

export interface CompileAiContextInput {
  sources: AiContextSourceInput[];
  missingSourceTypes?: AiContextSourceType[];
  modelContextTokens: number;
  reservedOutputTokens: number;
  fixedMessageTokens: number;
}

interface NormalizedSource extends AiContextSourceInput {
  content: string;
  required: boolean;
}

function boundedInteger(value: number, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      `${label} 必须是 ${minimum}～${maximum} 的整数。`,
    );
  }
  return value;
}

function boundedText(value: string, label: string, maximum: number): string {
  const normalized = normalizeCompilationText(value);
  const length = unicodeLength(normalized);
  if (!normalized || length > maximum) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      `${label} 为空或超过 ${maximum} 字符。`,
    );
  }
  return normalized;
}

function normalizeSource(source: AiContextSourceInput): NormalizedSource {
  const content = normalizeCompilationText(source.content);
  if (unicodeLength(content) > MAX_SOURCE_CHARS) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      `上下文来源 ${source.sourceType}:${source.sourceId} 超过长度限制。`,
    );
  }
  const normalized: NormalizedSource = {
    ...source,
    sourceId: boundedText(source.sourceId, 'sourceId', MAX_ID_CHARS),
    sourceVersion: boundedText(source.sourceVersion, 'sourceVersion', MAX_VERSION_CHARS),
    label: boundedText(source.label, 'source label', MAX_LABEL_CHARS),
    content,
    order: boundedInteger(source.order, 'source order', 0, 100_000),
    priority: boundedInteger(source.priority, 'source priority', 0, 100),
    required: source.required === true,
    maxTokens: source.maxTokens === undefined
      ? undefined
      : boundedInteger(source.maxTokens, 'source maxTokens', 1, 1_000_000),
  };
  if (normalized.required && !normalized.content) {
    throw new AiCompilationError(
      'AI_CONTEXT_SOURCE_REQUIRED',
      `必需上下文来源 ${normalized.sourceType}:${normalized.sourceId} 没有内容。`,
    );
  }
  return normalized;
}

function sortSources(sources: NormalizedSource[]): NormalizedSource[] {
  return [...sources].sort((left, right) => (
    left.order - right.order
    || Number(right.required) - Number(left.required)
    || right.priority - left.priority
    || compareCanonicalText(left.sourceType, right.sourceType)
    || compareCanonicalText(left.sourceId, right.sourceId)
  ));
}

function sourceKey(source: Pick<AiContextSourceInput, 'sourceType' | 'sourceId'>): string {
  return `${source.sourceType}:${source.sourceId}`;
}

function renderSection(source: NormalizedSource, content: string, truncated: boolean): string {
  return `## ${source.label}\n${content}${truncated ? TRUNCATION_MARKER : ''}`;
}

function truncateToBudget(
  source: NormalizedSource,
  compiledPrefix: string,
  tokenBudget: number,
): string {
  const characters = Array.from(source.content);
  const separator = compiledPrefix ? '\n\n' : '';
  const prefixTokens = estimateTokens(compiledPrefix);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2);
    const candidate = `${compiledPrefix}${separator}${renderSection(
      source,
      characters.slice(0, midpoint).join(''),
      true,
    )}`;
    if (estimateTokens(candidate) - prefixTokens <= tokenBudget) low = midpoint;
    else high = midpoint - 1;
  }
  return characters.slice(0, low).join('');
}

function uniqueMissingTypes(
  values: AiContextSourceType[] | undefined,
  sources: NormalizedSource[],
): AiContextSourceType[] {
  const present = new Set(sources.map((source) => source.sourceType));
  return [...new Set(values ?? [])]
    .filter((sourceType) => !present.has(sourceType))
    .sort();
}

export async function compileAiContext(input: CompileAiContextInput): Promise<CompiledAiContextV1> {
  if (!Array.isArray(input.sources) || input.sources.length > MAX_SOURCES) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      `上下文来源必须是最多 ${MAX_SOURCES} 项的数组。`,
    );
  }
  const modelContextTokens = boundedInteger(
    input.modelContextTokens,
    'modelContextTokens',
    128,
    10_000_000,
  );
  const reservedOutputTokens = boundedInteger(
    input.reservedOutputTokens,
    'reservedOutputTokens',
    1,
    modelContextTokens - 1,
  );
  const fixedMessageTokens = boundedInteger(
    input.fixedMessageTokens,
    'fixedMessageTokens',
    0,
    modelContextTokens - reservedOutputTokens,
  );
  const availableContextTokens = modelContextTokens - reservedOutputTokens - fixedMessageTokens;
  if (availableContextTokens < 1) {
    throw new AiCompilationError(
      'AI_CONTEXT_BUDGET_EXCEEDED',
      '模型上下文预算没有为编译上下文保留空间。',
    );
  }

  const normalized = sortSources(input.sources.map(normalizeSource));
  const identities = new Set<string>();
  for (const source of normalized) {
    const key = sourceKey(source);
    if (identities.has(key)) {
      throw new AiCompilationError(
        'AI_COMPILATION_INPUT_INVALID',
        `上下文来源身份重复：${key}。`,
      );
    }
    identities.add(key);
  }

  const renderedSections: string[] = [];
  const manifestSources: CompiledAiContextSource[] = [];
  let consumedTokens = 0;

  for (let ordinal = 0; ordinal < normalized.length; ordinal += 1) {
    const source = normalized[ordinal];
    const originalChars = unicodeLength(source.content);
    const originalBytes = utf8Length(source.content);
    const originalTokens = estimateTokens(source.content);
    const contentHash = await sha256(source.content);
    let status: CompiledAiContextSource['status'];
    let includedContent = '';

    if (!source.content) {
      status = 'omitted_empty';
    } else {
      const compiledPrefix = renderedSections.join('\n\n');
      const separator = renderedSections.length === 0 ? '' : '\n\n';
      const remaining = availableContextTokens - consumedTokens;
      const sourceLimit = Math.min(remaining, source.maxTokens ?? remaining);
      const fullSection = renderSection(source, source.content, false);
      const fullCost = estimateTokens(`${compiledPrefix}${separator}${fullSection}`) - consumedTokens;
      if (fullCost <= sourceLimit) {
        includedContent = source.content;
        status = 'included';
        renderedSections.push(fullSection);
        consumedTokens = estimateTokens(renderedSections.join('\n\n'));
      } else {
        includedContent = truncateToBudget(source, compiledPrefix, sourceLimit);
        if (!includedContent) {
          if (source.required) {
            throw new AiCompilationError(
              'AI_CONTEXT_BUDGET_EXCEEDED',
              `预算不足以包含必需来源 ${sourceKey(source)}。`,
            );
          }
          status = 'omitted_budget';
        } else {
          status = 'truncated';
          const section = renderSection(source, includedContent, true);
          renderedSections.push(section);
          consumedTokens = estimateTokens(renderedSections.join('\n\n'));
        }
      }
    }

    manifestSources.push({
      ordinal,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceVersion: source.sourceVersion,
      origin: source.origin,
      label: source.label,
      order: source.order,
      priority: source.priority,
      required: source.required,
      contentHash,
      originalChars,
      originalBytes,
      originalTokens,
      status,
      includedHash: includedContent ? await sha256(includedContent) : undefined,
      includedChars: unicodeLength(includedContent),
      includedBytes: utf8Length(includedContent),
      includedTokens: estimateTokens(includedContent),
    });
  }

  const compiledContext = renderedSections.join('\n\n');
  const compiledContextHash = await sha256(compiledContext);
  const compiledContextTokens = estimateTokens(compiledContext);
  if (compiledContextTokens > availableContextTokens || compiledContextTokens !== consumedTokens) {
    throw new AiCompilationError(
      'AI_CONTEXT_BUDGET_EXCEEDED',
      '编译上下文超出预算或预算核算不一致。',
    );
  }
  const sourceManifestJson: AiContextSourceManifestV1 = {
    contractVersion: 'context_manifest_v1',
    compilerVersion: 'context_compiler_v1',
    tokenEstimator: 'utf8_bytes_div3_v1',
    compiledContextHash,
    missingSourceTypes: uniqueMissingTypes(input.missingSourceTypes, normalized),
    sources: manifestSources,
  };
  const budgetJson: AiContextBudgetV1 = {
    contractVersion: 'context_budget_v1',
    tokenEstimator: 'utf8_bytes_div3_v1',
    modelContextTokens,
    reservedOutputTokens,
    fixedMessageTokens,
    availableContextTokens,
    compiledContextTokens,
    compiledContextChars: unicodeLength(compiledContext),
    compiledContextBytes: utf8Length(compiledContext),
    includedSourceCount: manifestSources.filter((source) => source.status === 'included').length,
    truncatedSourceCount: manifestSources.filter((source) => source.status === 'truncated').length,
    omittedSourceCount: manifestSources.filter((source) => source.status.startsWith('omitted_')).length,
  };
  return {
    schemaVersion: 2,
    compilerVersion: 'context_compiler_v1',
    sourceManifestJson,
    compiledContext,
    budgetJson,
  };
}

export async function verifyAiContextSourceDrift(
  manifest: AiContextSourceManifestV1,
  currentSources: AiContextSourceInput[],
): Promise<AiContextDriftReport> {
  const normalized = sortSources(currentSources.map(normalizeSource));
  const identities = normalized.map(sourceKey);
  if (new Set(identities).size !== identities.length) {
    throw new AiCompilationError(
      'AI_COMPILATION_INPUT_INVALID',
      '当前上下文来源包含重复身份，不能执行漂移验证。',
    );
  }
  const current = new Map(normalized.map((source) => [sourceKey(source), source]));
  const items: AiContextDriftReport['items'] = [];
  for (const expected of manifest.sources) {
    const key = sourceKey(expected);
    const actual = current.get(key);
    if (!actual) {
      items.push({
        sourceType: expected.sourceType,
        sourceId: expected.sourceId,
        status: 'missing',
        expectedVersion: expected.sourceVersion,
        expectedHash: expected.contentHash,
      });
      continue;
    }
    current.delete(key);
    const actualHash = await sha256(actual.content);
    const unchanged = actual.sourceVersion === expected.sourceVersion
      && actualHash === expected.contentHash;
    items.push({
      sourceType: expected.sourceType,
      sourceId: expected.sourceId,
      status: unchanged ? 'unchanged' : 'changed',
      expectedVersion: expected.sourceVersion,
      actualVersion: actual.sourceVersion,
      expectedHash: expected.contentHash,
      actualHash,
    });
  }
  for (const source of current.values()) {
    items.push({
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      status: 'unexpected',
      actualVersion: source.sourceVersion,
      actualHash: await sha256(source.content),
    });
  }
  items.sort((left, right) => (
    compareCanonicalText(left.sourceType, right.sourceType)
    || compareCanonicalText(left.sourceId, right.sourceId)
  ));
  return {
    matches: items.every((item) => item.status === 'unchanged'),
    items,
  };
}
