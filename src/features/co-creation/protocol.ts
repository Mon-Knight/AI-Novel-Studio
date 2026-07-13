import type {
  CoCreationExtractedInformationV1,
  CoCreationFieldSuggestionV1,
  CoCreationIntent,
  CoCreationQuickReplyV1,
  CoCreationSourceReferenceV1,
  CoCreationStage,
  CoCreationStageCompletionV1,
  CoCreationTurnOutputV1,
} from '../../types/coCreation';
import { CO_CREATION_PROTOCOL_VERSION } from '../../types/coCreation';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { stableCanonicalStringify } from '../../services/ai-tasks/stage3PrerequisiteService';
import { getStageDefinition } from './stageMachine';

const STAGES = new Set<CoCreationStage>([
  'story_seed', 'creative_intent', 'world_background', 'rule_system', 'protagonist',
  'core_conflict', 'story_arc', 'outline', 'chapter_plan', 'chapter_generation',
]);

const INTENTS = new Set<CoCreationIntent>([
  'answer_current_question', 'free_discussion', 'modify_setting', 'request_ai_completion',
  'generate_outline', 'generate_chapter', 'revise_existing_content', 'accept_suggestion',
  'reject_suggestion', 'undo_change', 'navigate_to_page',
]);

const OBJECT_PREFIXES: Record<string, readonly string[]> = {
  story_seed: ['storySeed.'],
  creative_intent: ['creativeIntent.'],
  world_setting: ['worldSetting.'],
  rule_system: ['ruleSystem.'],
  protagonist: ['protagonist.'],
  outline: ['outline.', 'storyArc.', 'coreConflict.'],
  volume: ['volume.'],
  chapter: ['chapterPlan.', 'chapterGeneration.'],
};

const OBJECT_TYPE_ALIASES: Record<string, keyof typeof OBJECT_PREFIXES> = {
  world_background: 'world_setting',
  core_conflict: 'outline',
  story_arc: 'outline',
  chapter_plan: 'chapter',
  chapter_generation: 'chapter',
};

function protocolError(message: string): never {
  throw new Error(`AI 共创结构化结果无效：${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) protocolError(`${label} 必须是对象`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, required = true): string {
  if (typeof value !== 'string') protocolError(`${label} 必须是字符串`);
  const normalized = value.trim();
  if (required && !normalized) protocolError(`${label} 不能为空`);
  return normalized;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) protocolError(`${label} 必须是数组`);
  return value;
}

function confidence(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    protocolError(`${label} 必须位于 0 到 1`);
  }
  return value;
}

function containsCredential(value: unknown): boolean {
  if (typeof value === 'string') {
    return /(?:api[_ -]?key\s*[:=]|authorization\s*[:=]|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,})/i.test(value);
  }
  if (Array.isArray(value)) return value.some(containsCredential);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => (
    ['apikey', 'api_key', 'authorization', 'secret'].includes(key.toLowerCase())
      || containsCredential(child)
  ));
}

function assertSafeJsonNumbers(value: unknown, label: string): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      protocolError(`${label} 包含无法跨语言精确表示的数字`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeJsonNumbers(item, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => (
    assertSafeJsonNumbers(child, `${label}.${key}`)
  ));
}

function parseJson(textValue: string): unknown {
  const trimmed = textValue.trim();
  const unfenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed;
  try {
    return JSON.parse(unfenced);
  } catch {
    const start = unfenced.indexOf('{');
    const end = unfenced.lastIndexOf('}');
    if (start < 0 || end <= start) protocolError('Provider 未返回 JSON 对象');
    try {
      return JSON.parse(unfenced.slice(start, end + 1));
    } catch {
      return protocolError('Provider 返回的 JSON 无法解析');
    }
  }
}

function sourceReferences(value: unknown, label: string): CoCreationSourceReferenceV1[] {
  return array(value, label).map((item, index) => {
    const source = record(item, `${label}[${index}]`);
    const sourceType = text(source.sourceType, `${label}[${index}].sourceType`) as CoCreationSourceReferenceV1['sourceType'];
    if (!['author_message', 'formal_project_data', 'adopted_chapter_text', 'pending_draft', 'ai_inference'].includes(sourceType)) {
      protocolError(`${label}[${index}].sourceType 不受支持`);
    }
    return {
      sourceType,
      sourceId: text(source.sourceId, `${label}[${index}].sourceId`),
      ...(source.excerpt === undefined ? {} : { excerpt: text(source.excerpt, `${label}[${index}].excerpt`, false) }),
      ...(source.contentHash === undefined ? {} : { contentHash: text(source.contentHash, `${label}[${index}].contentHash`) }),
    };
  });
}

function target(value: unknown, label: string): CoCreationFieldSuggestionV1['target'] {
  const input = record(value, label);
  const rawObjectType = text(input.objectType, `${label}.objectType`);
  const objectType = (OBJECT_TYPE_ALIASES[rawObjectType] ?? rawObjectType) as
    CoCreationFieldSuggestionV1['target']['objectType'];
  const prefixes = OBJECT_PREFIXES[objectType];
  if (!prefixes) protocolError(`${label}.objectType 不受支持`);
  const fieldPath = text(input.fieldPath, `${label}.fieldPath`);
  if (!prefixes.some((prefix) => fieldPath.startsWith(prefix))) {
    protocolError(`${label}.fieldPath 与目标类型不匹配`);
  }
  return {
    objectType,
    ...(input.objectId === undefined ? {} : { objectId: text(input.objectId, `${label}.objectId`) }),
    fieldPath,
  };
}

async function suggestion(
  value: unknown,
  index: number,
  dataRevision: number,
): Promise<CoCreationFieldSuggestionV1> {
  const input = record(value, `changeSuggestions[${index}]`);
  const fieldState = text(input.fieldState, `changeSuggestions[${index}].fieldState`) as CoCreationFieldSuggestionV1['fieldState'];
  if (!['ai_suggested', 'ai_inferred', 'temporary_assumption', 'conflict'].includes(fieldState)) {
    protocolError(`changeSuggestions[${index}].fieldState 不受支持`);
  }
  const sourceType = text(input.sourceType, `changeSuggestions[${index}].sourceType`) as CoCreationFieldSuggestionV1['sourceType'];
  if (!['author_message', 'formal_project_data', 'adopted_chapter_text', 'pending_draft', 'ai_inference']
    .includes(sourceType)) {
    protocolError(`changeSuggestions[${index}].sourceType 不受支持`);
  }
  const refs = sourceReferences(input.sourceReferences ?? [], `changeSuggestions[${index}].sourceReferences`);
  if (sourceType !== 'ai_inference' && refs.length === 0) {
    protocolError(`changeSuggestions[${index}] 必须提供来源引用`);
  }
  const conflicts = array(input.conflicts ?? [], `changeSuggestions[${index}].conflicts`).map((item, conflictIndex) => {
    const conflict = record(item, `changeSuggestions[${index}].conflicts[${conflictIndex}]`);
    const severityValue = text(conflict.severity, `changeSuggestions[${index}].conflicts[${conflictIndex}].severity`);
    if (severityValue !== 'warning' && severityValue !== 'blocking') protocolError('冲突严重度无效');
    const severity: 'warning' | 'blocking' = severityValue;
    return {
      code: text(conflict.code, `changeSuggestions[${index}].conflicts[${conflictIndex}].code`),
      severity,
      message: text(conflict.message, `changeSuggestions[${index}].conflicts[${conflictIndex}].message`),
      sourceReferences: sourceReferences(
        conflict.sourceReferences ?? [],
        `changeSuggestions[${index}].conflicts[${conflictIndex}].sourceReferences`,
      ),
    };
  });
  const originalValue = input.originalValue ?? null;
  const suggestedValue = input.suggestedValue ?? null;
  assertSafeJsonNumbers(originalValue, `changeSuggestions[${index}].originalValue`);
  assertSafeJsonNumbers(suggestedValue, `changeSuggestions[${index}].suggestedValue`);
  if (input.baseTargetVersion !== undefined && input.baseTargetVersion !== null
      && (typeof input.baseTargetVersion !== 'number' || !Number.isSafeInteger(input.baseTargetVersion))) {
    protocolError(`changeSuggestions[${index}].baseTargetVersion 必须是安全整数`);
  }
  const body = {
    target: target(input.target, `changeSuggestions[${index}].target`),
    originalValue,
    suggestedValue,
    fieldState,
    sourceType,
    sourceReferences: refs,
    confidence: confidence(input.confidence, `changeSuggestions[${index}].confidence`),
    conflicts,
    baseDataRevision: dataRevision,
    ...(typeof input.baseTargetVersion === 'number' && Number.isSafeInteger(input.baseTargetVersion)
      ? { baseTargetVersion: input.baseTargetVersion } : {}),
    ...(typeof input.baseTargetHash === 'string' && input.baseTargetHash.trim()
      ? { baseTargetHash: input.baseTargetHash.trim() } : {}),
  };
  return {
    suggestionId: crypto.randomUUID(),
    ...body,
    decision: 'pending',
    candidateHash: await computeContentSha256(stableCanonicalStringify(body)),
  };
}

function stageCompletion(value: unknown, currentStage: CoCreationStage): CoCreationStageCompletionV1 {
  const input = record(value, 'stageCompletion');
  const stage = text(input.stage, 'stageCompletion.stage') as CoCreationStage;
  if (stage !== currentStage) protocolError('stageCompletion.stage 与 currentStage 不一致');
  const status = text(input.status, 'stageCompletion.status') as CoCreationStageCompletionV1['status'];
  if (!['not_started', 'in_progress', 'minimum_complete', 'complete', 'skipped'].includes(status)) {
    protocolError('stageCompletion.status 无效');
  }
  const completedRequiredFields = array(input.completedRequiredFields ?? [], 'stageCompletion.completedRequiredFields')
    .map((item, index) => text(item, `stageCompletion.completedRequiredFields[${index}]`));
  const missingRequiredFields = array(input.missingRequiredFields ?? [], 'stageCompletion.missingRequiredFields')
    .map((item, index) => text(item, `stageCompletion.missingRequiredFields[${index}]`));
  const required = new Set(getStageDefinition(stage).minimumRequiredFields);
  if ([...completedRequiredFields, ...missingRequiredFields].some((path) => !required.has(path))) {
    protocolError('stageCompletion 包含未声明的最低完备字段');
  }
  if (typeof input.percentage !== 'number' || !Number.isInteger(input.percentage)
      || input.percentage < 0 || input.percentage > 100) protocolError('stageCompletion.percentage 无效');
  return { stage, status, completedRequiredFields, missingRequiredFields, percentage: input.percentage };
}

export async function parseCoCreationTurnOutput(
  rawText: string,
  expectedDataRevision: number,
  expectedStage?: CoCreationStage,
  expectedUserMessageId?: string,
): Promise<CoCreationTurnOutputV1> {
  const input = record(parseJson(rawText), 'root');
  if (input.schemaVersion !== CO_CREATION_PROTOCOL_VERSION) protocolError('schemaVersion 不受支持');
  if (containsCredential(input)) protocolError('结果包含凭据或授权信息');
  const currentStage = text(input.currentStage, 'currentStage') as CoCreationStage;
  if (!STAGES.has(currentStage)) protocolError('currentStage 无效');
  if (expectedStage && currentStage !== expectedStage) protocolError('currentStage 与冻结阶段不一致');
  const intent = text(input.intent, 'intent') as CoCreationIntent;
  if (!INTENTS.has(intent)) protocolError('intent 无效');
  if (input.dataRevision !== expectedDataRevision) protocolError('结果基于错误的数据 revision');

  const extractedInformation: CoCreationExtractedInformationV1[] = array(
    input.extractedInformation ?? [],
    'extractedInformation',
  ).map((item, index) => {
    const extracted = record(item, `extractedInformation[${index}]`);
    const fieldState = text(extracted.fieldState, `extractedInformation[${index}].fieldState`) as CoCreationExtractedInformationV1['fieldState'];
    if (!['user_confirmed', 'ai_suggested', 'ai_inferred', 'temporary_assumption', 'conflict', 'blank'].includes(fieldState)) {
      protocolError(`extractedInformation[${index}].fieldState 无效`);
    }
    const refs = sourceReferences(
      extracted.sourceReferences ?? [],
      `extractedInformation[${index}].sourceReferences`,
    );
    if (refs.length === 0) protocolError(`extractedInformation[${index}] 必须提供来源引用`);
    if (fieldState === 'user_confirmed' && !refs.some((reference) => (
      reference.sourceType === 'author_message'
        && (!expectedUserMessageId || reference.sourceId === expectedUserMessageId)
    ))) {
      protocolError(`extractedInformation[${index}] 的 user_confirmed 缺少本轮作者来源`);
    }
    return {
      target: target(extracted.target, `extractedInformation[${index}].target`),
      value: extracted.value ?? null,
      fieldState,
      sourceReferences: refs,
      confidence: confidence(extracted.confidence, `extractedInformation[${index}].confidence`),
    };
  });

  const quickReplies: CoCreationQuickReplyV1[] = array(input.quickReplies ?? [], 'quickReplies')
    .slice(0, 4)
    .map((item, index) => {
      const reply = record(item, `quickReplies[${index}]`);
      return {
        id: text(reply.id, `quickReplies[${index}].id`),
        label: text(reply.label, `quickReplies[${index}].label`),
        value: text(reply.value, `quickReplies[${index}].value`),
      };
    });

  const nextQuestion = input.nextHighValueQuestion === undefined || input.nextHighValueQuestion === null
    ? undefined
    : (() => {
        const question = record(input.nextHighValueQuestion, 'nextHighValueQuestion');
        return {
          question: text(question.question, 'nextHighValueQuestion.question'),
          reason: text(question.reason, 'nextHighValueQuestion.reason'),
          targetFieldPaths: array(question.targetFieldPaths ?? [], 'nextHighValueQuestion.targetFieldPaths')
            .map((item, index) => text(item, `nextHighValueQuestion.targetFieldPaths[${index}]`)),
        };
      })();

  return {
    schemaVersion: CO_CREATION_PROTOCOL_VERSION,
    naturalLanguageReply: text(input.naturalLanguageReply, 'naturalLanguageReply'),
    intent,
    currentStage,
    extractedInformation,
    pendingConfirmations: array(input.pendingConfirmations ?? [], 'pendingConfirmations')
      .map((item, index) => text(item, `pendingConfirmations[${index}]`)),
    ...(nextQuestion ? { nextHighValueQuestion: nextQuestion } : {}),
    quickReplies,
    changeSuggestions: await Promise.all(
      array(input.changeSuggestions ?? [], 'changeSuggestions')
        .map((item, index) => suggestion(item, index, expectedDataRevision)),
    ),
    stageCompletion: stageCompletion(input.stageCompletion, currentStage),
    dataRevision: expectedDataRevision,
  };
}
