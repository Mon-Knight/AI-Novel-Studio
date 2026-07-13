import { novelRepository } from '../../services/database/novelRepository';
import { settingRepository } from '../../services/database/settingRepository';
import { protagonistRepository } from '../../services/database/protagonistRepository';
import { volumeRepository } from '../../services/database/volumeRepository';
import { chapterRepository } from '../../services/database/chapterRepository';
import { creativeIntentService } from '../../services/ai-tasks/creativeIntentService';
import { stableCanonicalStringify } from '../../services/ai-tasks/stage3PrerequisiteService';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import type { CreativeIntentSnapshotV1, CreativeIntentStatementV1 } from '../../types/creativeIntent';
import type { ProtagonistProfile } from '../../types/novel';
import type { Protagonist } from '../../types/protagonist';
import type { RuleSystem, WorldSetting } from '../../types/setting';
import type {
  CoCreationDraftRevision,
  CoCreationMessage,
  CoCreationObjectContext,
  CoCreationSession,
} from '../../types/coCreation';
import type { CoCreationFieldValue } from './stageMachine';

const MAX_RECENT_MESSAGES = 8;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_SUMMARY_CHARS = 8_000;

export interface CoCreationCanonicalContext {
  novel: {
    id: string;
    title: string;
    genre?: string;
    description: string;
    outline: string;
    protagonistAbility?: string;
    worldBackground?: string;
    updatedAt: string;
  };
  creativeIntent: CreativeIntentSnapshotV1 | null;
  worldSettings: WorldSetting[];
  ruleSystems: RuleSystem[];
  protagonists: ProtagonistProfile[];
  legacyProtagonist: Protagonist | null;
  selectedVolume?: unknown;
  selectedChapter?: unknown;
}

export interface CoCreationCompiledContext {
  priorityOrder: readonly [
    'formal_project_data',
    'pending_draft',
    'session_summary',
    'recent_messages',
  ];
  canonical: CoCreationCanonicalContext;
  pendingDraft?: CoCreationDraftRevision;
  sessionSummary?: string;
  recentMessages: Array<Pick<CoCreationMessage, 'messageId' | 'role' | 'content' | 'contentHash'>>;
  objectContext: CoCreationObjectContext;
  knownFields: Record<string, CoCreationFieldValue>;
  sourceManifest: Array<Record<string, unknown>>;
  canonicalDataHash: string;
  dataRevision: number;
}

function compactMessage(message: CoCreationMessage) {
  return {
    messageId: message.messageId,
    role: message.role,
    content: message.content.slice(0, MAX_MESSAGE_CHARS),
    contentHash: message.contentHash,
  };
}

function confirmed(value: unknown): CoCreationFieldValue | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  if (Array.isArray(value) && value.length === 0) return undefined;
  return { value, state: 'user_confirmed' };
}

function hasContent(value: unknown): boolean {
  return confirmed(value) !== undefined;
}

function firstContent(values: readonly unknown[]): unknown {
  return values.find(hasContent);
}

function combineContent(values: readonly unknown[]): unknown {
  const present = values.filter(hasContent);
  if (present.length === 0) return undefined;
  return present.length === 1 ? present[0] : present;
}

function normalizeStructuredKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s_.-]/g, '');
}

function findStructuredValue(value: unknown, aliases: readonly string[], depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    return firstContent(value.map((item) => findStructuredValue(item, aliases, depth + 1)));
  }
  if (typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const normalizedAliases = new Set(aliases.map(normalizeStructuredKey));
  const direct = Object.entries(record).find(([key, child]) => (
    normalizedAliases.has(normalizeStructuredKey(key)) && hasContent(child)
  ));
  if (direct) return direct[1];
  return firstContent(Object.values(record).map((child) => (
    findStructuredValue(child, aliases, depth + 1)
  )));
}

function parseStructuredJson(value: string | undefined): unknown {
  if (!value?.trim()) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function confirmedIntentStatements(
  intent: CreativeIntentSnapshotV1 | null,
): CreativeIntentStatementV1[] {
  return intent?.statements.filter((statement) => (
    statement.confirmation.status === 'confirmed'
      && statement.confirmation.confirmedBy === 'author'
      && hasContent(statement.value)
  )) ?? [];
}

function statementValues(
  statements: readonly CreativeIntentStatementV1[],
  kind: CreativeIntentStatementV1['kind'],
): unknown {
  return combineContent(statements.filter((statement) => statement.kind === kind)
    .map((statement) => statement.value));
}

function settingSummary(items: readonly WorldSetting[]): unknown {
  return combineContent(items.map((item) => {
    const content = item.content.trim();
    if (!content) return undefined;
    return item.title.trim() ? `${item.title.trim()}：${content}` : content;
  }));
}

function ruleSummary(items: readonly RuleSystem[]): unknown {
  return combineContent(items.map((item) => {
    const title = item.title.trim();
    const content = item.content.trim();
    if (!content) return undefined;
    return title ? `${title}：${content}` : content;
  }));
}

function draftFields(draft?: CoCreationDraftRevision): Record<string, CoCreationFieldValue> {
  if (!draft) return {};
  const raw = draft.payload.fields;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const fields: Record<string, CoCreationFieldValue> = {};
  for (const [path, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    if (typeof item.state !== 'string') continue;
    if (!['user_confirmed', 'ai_suggested', 'ai_inferred', 'temporary_assumption', 'conflict', 'blank']
      .includes(item.state)) continue;
    fields[path] = { value: item.value, state: item.state as CoCreationFieldValue['state'] };
  }
  return fields;
}

function canonicalFields(context: CoCreationCanonicalContext): Record<string, CoCreationFieldValue> {
  const intentStatements = confirmedIntentStatements(context.creativeIntent);
  const intentValues = intentStatements.map((statement) => statement.value);
  const activeWorldSettings = context.worldSettings.filter((item) => item.isActive !== false);
  const worldStructures = activeWorldSettings.map((item) => parseStructuredJson(item.structuredJson));
  const worldFallback = firstContent([
    settingSummary(activeWorldSettings),
    context.novel.worldBackground,
  ]);
  const activeRuleSystems = context.ruleSystems.filter((item) => item.isActive !== false);
  const ruleStructures = activeRuleSystems.map((item) => parseStructuredJson(item.structuredJson));
  const ruleFallback = ruleSummary(activeRuleSystems);
  const ruleBoundaries = combineContent(activeRuleSystems.map((item) => item.forbiddenRules));

  const fields: Record<string, CoCreationFieldValue | undefined> = {
    'storySeed.premise': confirmed(context.novel.description),
    'creativeIntent.primaryGoal': confirmed(firstContent([
      findStructuredValue(intentValues, ['primaryGoal', 'primary_goal', '创作目标', '核心目标']),
      statementValues(intentStatements, 'goal'),
    ])),
    'creativeIntent.genre': confirmed(firstContent([
      context.novel.genre,
      findStructuredValue(intentValues, ['genre', '题材', '类型']),
    ])),
    'creativeIntent.readerExperience': confirmed(firstContent([
      findStructuredValue(intentValues, ['readerExperience', 'reader_experience', '读者体验', '阅读体验']),
      statementValues(intentStatements, 'preference'),
    ])),
    'creativeIntent.facts': confirmed(statementValues(intentStatements, 'fact')),
    'creativeIntent.constraints': confirmed(statementValues(intentStatements, 'constraint')),
    'storyArc.primaryOutline': confirmed(context.novel.outline),
    'worldSetting.content': confirmed(worldFallback),
    'worldSetting.era': confirmed(firstContent([
      findStructuredValue(worldStructures, ['era', 'timePeriod', 'time_period', '时代', '时期']),
      worldFallback,
    ])),
    'worldSetting.primaryLocation': confirmed(firstContent([
      findStructuredValue(worldStructures, [
        'primaryLocation', 'primary_location', 'mainLocation', '主要地点', '核心地点',
      ]),
      worldFallback,
    ])),
    'worldSetting.socialStructure': confirmed(firstContent([
      findStructuredValue(worldStructures, [
        'socialStructure', 'social_structure', 'society', '社会结构', '社会体系',
      ]),
      worldFallback,
    ])),
    'ruleSystem.content': confirmed(ruleFallback),
    'ruleSystem.coreMechanism': confirmed(firstContent([
      findStructuredValue(ruleStructures, [
        'coreMechanism', 'core_mechanism', 'mechanism', '核心机制', '运作机制',
      ]),
      ruleFallback,
    ])),
    'ruleSystem.cost': confirmed(firstContent([
      findStructuredValue(ruleStructures, ['cost', 'costs', 'price', '代价', '消耗']),
      ruleFallback,
    ])),
    'ruleSystem.boundary': confirmed(firstContent([
      findStructuredValue(ruleStructures, [
        'boundary', 'boundaries', 'limit', 'limits', '边界', '限制', '禁区',
      ]),
      ruleBoundaries,
      ruleFallback,
    ])),
  };
  const primary = context.protagonists[0];
  if (primary) {
    fields['protagonist.identity'] = confirmed(primary.identity);
    fields['protagonist.currentGoal'] = confirmed(primary.goal);
    fields['protagonist.mainStrength'] = confirmed(firstContent([
      primary.ability, primary.specialAbility, context.novel.protagonistAbility,
    ]));
    fields['protagonist.coreFlaw'] = confirmed(firstContent([
      primary.limitation, primary.abilityLimits, primary.forbiddenBehaviors,
    ]));
    fields['protagonist.mainlineRelation'] = confirmed(firstContent([
      primary.arc, primary.motivation,
    ]));
  }
  const legacy = context.legacyProtagonist;
  if (legacy) {
    fields['protagonist.identity'] ??= confirmed(legacy.identity);
    fields['protagonist.currentGoal'] ??= confirmed(legacy.goal);
    fields['protagonist.mainStrength'] ??= confirmed(legacy.specialAbility);
    fields['protagonist.coreFlaw'] ??= confirmed(firstContent([
      legacy.abilityLimits, legacy.forbiddenBehaviors,
    ]));
  }
  fields['protagonist.mainStrength'] ??= confirmed(context.novel.protagonistAbility);
  return Object.fromEntries(Object.entries(fields).filter((entry): entry is [string, CoCreationFieldValue] => !!entry[1]));
}

export async function computeCoCreationDataHash(
  canonical: CoCreationCanonicalContext,
  pendingFields: Record<string, CoCreationFieldValue>,
): Promise<string> {
  return computeContentSha256(stableCanonicalStringify({ canonical, pendingFields }));
}

export async function buildCoCreationContext(input: {
  session: CoCreationSession;
  messages: CoCreationMessage[];
  activeDraft?: CoCreationDraftRevision;
}): Promise<CoCreationCompiledContext> {
  const { session } = input;
  const [novel, worldSettings, ruleSystems, legacyProtagonist, creativeIntent, volumes, chapters] = await Promise.all([
    novelRepository.getById(session.novelId),
    settingRepository.getWorldSettings(session.novelId),
    settingRepository.getRuleSystems(session.novelId),
    protagonistRepository.getByNovelId(session.novelId),
    creativeIntentService.getLatest(session.novelId),
    volumeRepository.getByNovelId(session.novelId),
    chapterRepository.getByNovelId(session.novelId),
  ]);
  if (!novel) throw new Error('作品不存在，无法构建 AI 共创上下文');

  const selectedChapter = session.objectContext.chapterId
    ? chapters.find((chapter) => chapter.id === session.objectContext.chapterId)
    : undefined;
  if (session.objectContext.chapterId && !selectedChapter) {
    throw new Error('当前章节不属于该作品，已阻止构建上下文');
  }
  const volumeId = session.objectContext.volumeId ?? selectedChapter?.volumeId;
  const selectedVolume = volumeId ? volumes.find((volume) => volume.id === volumeId) : undefined;
  if (volumeId && !selectedVolume) throw new Error('当前分卷不属于该作品，已阻止构建上下文');

  const canonical: CoCreationCanonicalContext = {
    novel: {
      id: novel.id,
      title: novel.title,
      genre: novel.genre,
      description: novel.description,
      outline: novel.outline,
      protagonistAbility: novel.protagonistAbility,
      worldBackground: novel.worldBackground,
      updatedAt: novel.updatedAt,
    },
    creativeIntent: creativeIntent?.intent ?? null,
    worldSettings,
    ruleSystems,
    protagonists: novel.protagonists,
    legacyProtagonist,
    ...(selectedVolume ? { selectedVolume } : {}),
    ...(selectedChapter ? { selectedChapter } : {}),
  };
  const pendingFields = draftFields(input.activeDraft);
  const canonicalDataHash = await computeCoCreationDataHash(canonical, pendingFields);
  const recentMessages = input.messages
    .filter((message) => message.status === 'completed')
    .slice(-MAX_RECENT_MESSAGES)
    .map(compactMessage);
  const knownFields = { ...pendingFields, ...canonicalFields(canonical) };
  const sourceManifest: Array<Record<string, unknown>> = [
    { sourceType: 'novel', sourceId: novel.id, version: novel.updatedAt },
    ...worldSettings.map((item) => ({ sourceType: 'world_setting', sourceId: item.id, version: item.updatedAt })),
    ...ruleSystems.map((item) => ({ sourceType: 'rule_system', sourceId: item.id, version: item.updatedAt })),
    ...(creativeIntent ? [{
      sourceType: 'creative_intent',
      sourceId: creativeIntent.intent.intentId,
      version: creativeIntent.intent.revision,
      contentHash: creativeIntent.intent.contentHash,
    }] : []),
    ...novel.protagonists
      .filter((item) => typeof item.id === 'string' && item.id)
      .map((item) => ({ sourceType: 'character', sourceId: item.id, version: novel.updatedAt })),
    ...(legacyProtagonist?.id
      ? [{
          sourceType: 'legacy_protagonist',
          sourceId: legacyProtagonist.id,
          version: legacyProtagonist.updatedAt,
        }] : []),
    ...(selectedVolume
      ? [{
          sourceType: 'volume',
          sourceId: selectedVolume.id,
          version: selectedVolume.updatedAt,
        }] : []),
    ...(selectedChapter
      ? [{
          sourceType: 'chapter',
          sourceId: selectedChapter.id,
          version: selectedChapter.updatedAt,
        }] : []),
    ...(input.activeDraft ? [{
      sourceType: 'co_creation_draft',
      sourceId: input.activeDraft.draftRevisionId,
      version: input.activeDraft.revisionNo,
      contentHash: input.activeDraft.contentHash,
    }] : []),
  ];

  return {
    priorityOrder: ['formal_project_data', 'pending_draft', 'session_summary', 'recent_messages'],
    canonical,
    ...(input.activeDraft ? { pendingDraft: input.activeDraft } : {}),
    ...(session.summary ? { sessionSummary: session.summary.slice(0, MAX_SUMMARY_CHARS) } : {}),
    recentMessages,
    objectContext: session.objectContext,
    knownFields,
    sourceManifest,
    canonicalDataHash,
    dataRevision: session.dataRevision,
  };
}
