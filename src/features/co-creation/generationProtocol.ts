import type {
  CoCreationChapterGenerationHandoffV1,
  CoCreationGenerationKind,
  CoCreationGenerationRecordV1,
  CoCreationGenerationRequestV1,
} from '../../types/coCreation';
import type { Chapter } from '../../types/chapter';
import { CO_CREATION_GENERATION_PROTOCOL_VERSION } from '../../types/coCreation';
import { stableCanonicalStringify } from '../../services/ai-tasks/stage3PrerequisiteService';
import { computeContentSha256 } from '../../utils/contentIntegrity';

export const CO_CREATION_MAX_CHAPTER_OUTLINE_COUNT = 20;
export const CO_CREATION_MAX_GENERATION_INSTRUCTION_CHARS = 2_000;
export const CO_CREATION_MAX_CHAPTER_PLAN_CHARS = 6_000;
export const CO_CREATION_MAX_GENERATION_RECORDS = 24;

const KINDS = new Set<CoCreationGenerationKind>([
  'master_outline',
  'volume_outline',
  'chapter_outlines',
  'chapter_generation_handoff',
]);

function protocolError(message: string): never {
  throw Object.assign(new Error(`AI 共创生成请求无效：${message}`), {
    code: 'CO_CREATION_GENERATION_REQUEST_INVALID',
  });
}

function normalizedText(value: unknown, label: string, maxChars: number, required = false): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) protocolError(`${label} 不能为空`);
    return undefined;
  }
  if (typeof value !== 'string') protocolError(`${label} 必须是字符串`);
  const withoutControlCharacters = Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
  }).join('');
  const normalized = Array.from(withoutControlCharacters)
    .slice(0, maxChars + 1)
    .join('')
    .trim();
  if (required && !normalized) protocolError(`${label} 不能为空`);
  if (Array.from(normalized).length > maxChars) protocolError(`${label} 不能超过 ${maxChars} 字`);
  return normalized || undefined;
}

function containsCredential(value: string): boolean {
  return /(?:api[_ -]?key|authorization|client[_ -]?secret|access[_ -]?(?:token|key)|refresh[_ -]?token|token|password|passwd|secret)\s*["']?\s*[:=]/i.test(value)
    || /bearer\s+\S+/i.test(value)
    || /sk-[a-z0-9._-]{8,}/i.test(value)
    || /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value)
    || /:\/\/[^\s/@:]+:[^\s/@]+@/i.test(value);
}

function safeInteger(value: unknown, label: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    protocolError(`${label} 必须是 ${minimum} 到 ${maximum} 的整数`);
  }
  return value;
}

function requestBody(request: Omit<CoCreationGenerationRequestV1, 'requestHash'>): Record<string, unknown> {
  return { ...request };
}

export async function createCoCreationGenerationRequest(input: {
  requestId: string;
  kind: CoCreationGenerationKind;
  novelId: string;
  sessionId: string;
  volumeId?: string;
  chapterId?: string;
  chapterCount?: number;
  targetWordCount?: number;
  additionalInstruction?: string;
  chapterPlan?: string;
  baseContextHash: string;
  compiledInputHash?: string;
  baseDataRevision: number;
  sourceDraftRevisionId?: string;
  sourceDraftContentHash?: string;
  createdAt?: string;
}): Promise<CoCreationGenerationRequestV1> {
  if (!KINDS.has(input.kind)) protocolError('kind 不在白名单中');
  const requestId = normalizedText(input.requestId, 'requestId', 160, true)!;
  const novelId = normalizedText(input.novelId, 'novelId', 160, true)!;
  const sessionId = normalizedText(input.sessionId, 'sessionId', 160, true)!;
  const volumeId = normalizedText(input.volumeId, 'volumeId', 160);
  const chapterId = normalizedText(input.chapterId, 'chapterId', 160);
  const baseContextHash = normalizedText(input.baseContextHash, 'baseContextHash', 160, true)!;
  const compiledInputHash = normalizedText(input.compiledInputHash, 'compiledInputHash', 160);
  const sourceDraftRevisionId = normalizedText(
    input.sourceDraftRevisionId,
    'sourceDraftRevisionId',
    160,
  );
  const sourceDraftContentHash = normalizedText(
    input.sourceDraftContentHash,
    'sourceDraftContentHash',
    160,
  );
  const createdAt = normalizedText(input.createdAt ?? new Date().toISOString(), 'createdAt', 64, true)!;
  if (Number.isNaN(Date.parse(createdAt))) protocolError('createdAt 必须是有效时间');
  if (!!sourceDraftRevisionId !== !!sourceDraftContentHash) {
    protocolError('来源草案 ID 与 content hash 必须同时提供');
  }
  const additionalInstruction = normalizedText(
    input.additionalInstruction,
    'additionalInstruction',
    CO_CREATION_MAX_GENERATION_INSTRUCTION_CHARS,
  );
  const chapterPlan = normalizedText(
    input.chapterPlan,
    'chapterPlan',
    CO_CREATION_MAX_CHAPTER_PLAN_CHARS,
  );
  if ((additionalInstruction && containsCredential(additionalInstruction))
      || (chapterPlan && containsCredential(chapterPlan))) {
    protocolError('请求不得包含凭据或授权信息');
  }
  const chapterCount = safeInteger(
    input.chapterCount,
    'chapterCount',
    1,
    CO_CREATION_MAX_CHAPTER_OUTLINE_COUNT,
  );
  const targetWordCount = safeInteger(input.targetWordCount, 'targetWordCount', 500, 50_000);
  if (!Number.isSafeInteger(input.baseDataRevision) || input.baseDataRevision < 0) {
    protocolError('baseDataRevision 必须是非负安全整数');
  }
  if (input.kind === 'master_outline' && (volumeId || chapterId || chapterCount)) {
    protocolError('作品总纲请求不能携带分卷、章节或章节数量');
  }
  if (input.kind === 'volume_outline' && (!volumeId || chapterId || chapterCount)) {
    protocolError('分卷大纲请求必须且只能指定分卷');
  }
  if (input.kind === 'chapter_outlines' && !volumeId && !chapterId) {
    protocolError('章节大纲请求必须指定分卷或章节');
  }
  if (input.kind !== 'chapter_outlines' && chapterCount !== undefined) {
    protocolError('只有章节大纲请求可以设置 chapterCount');
  }
  if (input.kind === 'chapter_generation_handoff' && (!chapterId || !chapterPlan)) {
    protocolError('章节生成交接必须指定章节和非空章节计划');
  }
  if (input.kind === 'chapter_generation_handoff' && compiledInputHash) {
    protocolError('章节生成交接不能携带大纲编译输入 hash');
  }
  if (input.kind !== 'chapter_generation_handoff' && !compiledInputHash) {
    protocolError('后台大纲请求必须携带编译输入 hash');
  }
  if (input.kind !== 'chapter_generation_handoff' && targetWordCount !== undefined) {
    protocolError('只有章节生成交接可以设置目标字数');
  }

  const body: Omit<CoCreationGenerationRequestV1, 'requestHash'> = {
    schemaVersion: CO_CREATION_GENERATION_PROTOCOL_VERSION,
    requestId,
    kind: input.kind,
    novelId,
    sessionId,
    ...(volumeId ? { volumeId } : {}),
    ...(chapterId ? { chapterId } : {}),
    ...(chapterCount !== undefined ? { chapterCount } : {}),
    ...(targetWordCount !== undefined ? { targetWordCount } : {}),
    ...(additionalInstruction ? { additionalInstruction } : {}),
    ...(chapterPlan ? { chapterPlan } : {}),
    baseContextHash,
    ...(compiledInputHash ? { compiledInputHash } : {}),
    baseDataRevision: input.baseDataRevision,
    ...(sourceDraftRevisionId ? { sourceDraftRevisionId } : {}),
    ...(sourceDraftContentHash ? { sourceDraftContentHash } : {}),
    operationId: `co-creation-generation:${sessionId}:${requestId}`,
    createdAt,
  };
  return {
    ...body,
    requestHash: await computeContentSha256(stableCanonicalStringify(requestBody(body))),
  };
}

export async function assertCoCreationGenerationRequestIntegrity(
  request: CoCreationGenerationRequestV1,
): Promise<void> {
  if (request.schemaVersion !== CO_CREATION_GENERATION_PROTOCOL_VERSION) {
    protocolError('schemaVersion 不受支持');
  }
  const rebuilt = await createCoCreationGenerationRequest({
    ...request,
    createdAt: request.createdAt,
  });
  if (rebuilt.operationId !== request.operationId || rebuilt.requestHash !== request.requestHash) {
    protocolError('operationId 或 requestHash 校验失败');
  }
}

function isGenerationRecord(value: unknown): value is CoCreationGenerationRecordV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<CoCreationGenerationRecordV1>;
  return !!item.request && typeof item.request === 'object'
    && typeof item.request.requestId === 'string'
    && ['prepared', 'submitted', 'handoff_ready', 'failed'].includes(item.status ?? '')
    && typeof item.updatedAt === 'string';
}

export function readCoCreationGenerationRecords(
  payload?: Record<string, unknown>,
): CoCreationGenerationRecordV1[] {
  if (!Array.isArray(payload?.generationRequests)) return [];
  return payload.generationRequests.filter(isGenerationRecord).slice(-CO_CREATION_MAX_GENERATION_RECORDS);
}

export function writeCoCreationGenerationRecord(
  payload: Record<string, unknown>,
  record: CoCreationGenerationRecordV1,
): Record<string, unknown> {
  const records = readCoCreationGenerationRecords(payload);
  const index = records.findIndex((item) => item.request.requestId === record.request.requestId);
  const next = index < 0
    ? [...records, record]
    : records.map((item, itemIndex) => itemIndex === index ? record : item);
  return { ...payload, generationRequests: next.slice(-CO_CREATION_MAX_GENERATION_RECORDS) };
}

export function buildChapterPlanFromDraft(payload?: Record<string, unknown>): string {
  const fields = payload?.fields && typeof payload.fields === 'object' && !Array.isArray(payload.fields)
    ? payload.fields as Record<string, { value?: unknown; state?: unknown }>
    : {};
  const labels: Record<string, string> = {
    'chapterPlan.goal': '本章目标',
    'chapterPlan.conflict': '核心冲突',
    'chapterPlan.outcome': '预期结果',
    'chapterGeneration.planReady': '计划状态',
  };
  return Object.entries(fields)
    .filter(([path, field]) => path.startsWith('chapterPlan.')
      && field?.state === 'user_confirmed'
      && field?.value !== undefined && field.value !== null && String(field.value).trim())
    .map(([path, field]) => {
      const value = typeof field.value === 'string'
        ? field.value.trim()
        : stableCanonicalStringify(field.value);
      return `${labels[path] ?? path}：${value}`;
    })
    .join('\n')
    .slice(0, CO_CREATION_MAX_CHAPTER_PLAN_CHARS);
}

export function resolveChapterGenerationHandoffPrefill(
  handoff: CoCreationChapterGenerationHandoffV1,
  novelId: string,
  chapter: Pick<Chapter, 'id' | 'novelId' | 'volumeId'>,
): { instruction: string; targetWordCount?: number } {
  if (handoff.novelId !== novelId || chapter.novelId !== novelId
      || handoff.chapterId !== chapter.id
      || (handoff.volumeId && handoff.volumeId !== chapter.volumeId)) {
    throw protocolError('章节生成交接与当前工作台目标不一致');
  }
  const instruction = normalizedText(
    handoff.chapterPlan,
    'chapterPlan',
    CO_CREATION_MAX_CHAPTER_PLAN_CHARS,
    true,
  )!;
  const targetWordCount = safeInteger(handoff.targetWordCount, 'targetWordCount', 500, 50_000);
  return {
    instruction,
    ...(targetWordCount ? { targetWordCount } : {}),
  };
}
