import {
  CREATIVE_INTENT_SCHEMA_VERSION,
  DIRECTOR_GOVERNANCE_SCHEMA_VERSION,
  INITIALIZATION_CANDIDATE_SCHEMA_VERSION,
  type AuthorConfirmationV1,
  type CreativeIntentSnapshotV1,
  type CreativeIntentStatementV1,
  type DirectorDecisionAuditV1,
  type DirectorGovernanceV1,
  type EvidenceReferenceV1,
  type InitializationCandidateBundleV1,
  type InitializationCandidateDecisionV1,
  type InitializationCandidateV1,
} from '../../types/creativeIntent';
import { computeContentSha256 } from '../../utils/contentIntegrity';

type WithoutHash<T, K extends keyof T> = Omit<T, K>;

export interface FreezeCreativeIntentInput {
  intentId?: string;
  novelId: string;
  revision: number;
  parentIntentId?: string;
  createdAt?: string;
  statements: Array<WithoutHash<CreativeIntentStatementV1, 'statementHash'>>;
}

export interface BuildInitializationBundleInput {
  bundleId?: string;
  novelId: string;
  revision: number;
  parentBundleId?: string;
  intent: InitializationCandidateBundleV1['intent'];
  createdAt?: string;
  items: Array<WithoutHash<InitializationCandidateV1, 'candidateHash'>>;
}

export interface CreateDirectorGovernanceInput extends Omit<DirectorGovernanceV1, 'schemaVersion' | 'contentHash'> {}

export interface CreateDirectorDecisionAuditInput extends Omit<DirectorDecisionAuditV1, 'schemaVersion' | 'contentHash'> {}

export function stableCanonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCanonicalStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableCanonicalStringify(record[key])}`).join(',')}}`;
}

function fail(message: string): never {
  throw new Error(message);
}

function valueIsEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

function containsCredential(value: unknown): boolean {
  if (typeof value === 'string') {
    return /(?:api[_ -]?key\s*[:=]|apikey\s*[:=]|authorization\s*[:=]|bearer\s+[a-z0-9._-]{8,}|sk-[a-z0-9_-]{8,})/i.test(value);
  }
  if (Array.isArray(value)) return value.some(containsCredential);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => (
    ['apikey', 'api_key', 'authorization', 'secret'].includes(key.toLowerCase())
    || containsCredential(child)
  ));
}

function validateConfirmation(
  knowledgeClass: CreativeIntentStatementV1['knowledgeClass'],
  confirmation: AuthorConfirmationV1,
): void {
  if (confirmation.status === 'pending' && (confirmation.confirmedBy || confirmation.confirmedAt)) {
    fail('待确认信息不得携带作者确认记录');
  }
  if (confirmation.status !== 'pending' && confirmation.confirmedBy !== 'author') {
    fail('确认或拒绝结果必须由作者显式确认');
  }
  if (confirmation.status !== 'pending' && !confirmation.confirmedAt) {
    fail('确认或拒绝结果必须记录决定时间');
  }
  if (knowledgeClass === 'author_explicit' && confirmation.status !== 'confirmed') {
    fail('作者明确输入必须记录为作者已确认');
  }
}

function validateEvidence(evidence: EvidenceReferenceV1[], required: boolean): void {
  if (required && evidence.length === 0) fail('推断、待确认信息和初始化候选必须提供证据');
  const ids = new Set<string>();
  for (const item of evidence) {
    const evidenceId = item.evidenceId.trim();
    if (!evidenceId) fail('证据 ID 不能为空');
    if (ids.has(evidenceId)) fail(`证据 ID 重复: ${item.evidenceId}`);
    ids.add(evidenceId);
  }
}

async function hash(value: unknown): Promise<string> {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) fail('协议内容必须可以持久化为 JSON');
  return computeContentSha256(stableCanonicalStringify(JSON.parse(serialized)));
}

export async function freezeCreativeIntent(input: FreezeCreativeIntentInput): Promise<CreativeIntentSnapshotV1> {
  if (!input.novelId.trim()) fail('作品 ID 不能为空');
  if (!Number.isInteger(input.revision) || input.revision < 1) fail('创作意图 revision 必须从 1 开始递增');
  if (input.statements.length === 0) fail('创作意图至少包含一条陈述');

  const ids = new Set<string>();
  const statements: CreativeIntentStatementV1[] = [];
  for (const statement of input.statements) {
    const statementId = statement.statementId.trim();
    if (!statementId) fail('创作意图陈述 ID 不能为空');
    if (ids.has(statementId)) fail(`创作意图陈述 ID 重复: ${statement.statementId}`);
    ids.add(statementId);
    if (valueIsEmpty(statement.value)) fail('创作意图内容不能为空');
    if (!Number.isFinite(statement.confidence)
        || statement.confidence < 0 || statement.confidence > 1) fail('confidence 必须位于 0 到 1');
    validateConfirmation(statement.knowledgeClass, statement.confirmation);
    validateEvidence(statement.evidence, statement.knowledgeClass !== 'author_explicit');
    statements.push({ ...statement, statementHash: await hash(statement) });
  }

  if (containsCredential(input)) fail('创作意图不得包含 API Key 或授权信息');

  const createdAt = input.createdAt ?? new Date().toISOString();
  const frozenAt = createdAt;
  const withoutHash = {
    schemaVersion: CREATIVE_INTENT_SCHEMA_VERSION,
    intentId: input.intentId ?? crypto.randomUUID(),
    novelId: input.novelId,
    revision: input.revision,
    ...(input.parentIntentId ? { parentIntentId: input.parentIntentId } : {}),
    status: 'frozen' as const,
    statements,
    createdAt,
    frozenAt,
  };
  return { ...withoutHash, contentHash: await hash(withoutHash) };
}

export async function validateCreativeIntentSnapshot(
  snapshot: CreativeIntentSnapshotV1,
  expectedNovelId = snapshot.novelId,
): Promise<void> {
  if (snapshot.schemaVersion !== CREATIVE_INTENT_SCHEMA_VERSION || snapshot.status !== 'frozen') {
    fail('创作意图快照协议无效');
  }
  if (snapshot.novelId !== expectedNovelId || snapshot.revision < 1 || snapshot.statements.length === 0
      || !snapshot.intentId.trim() || !snapshot.createdAt.trim() || !snapshot.frozenAt.trim()) {
    fail('创作意图快照范围或 revision 无效');
  }
  const ids = new Set<string>();
  for (const statement of snapshot.statements) {
    const statementId = statement.statementId.trim();
    if (!statementId || ids.has(statementId)) fail('创作意图快照包含重复陈述');
    ids.add(statementId);
    if (valueIsEmpty(statement.value)) fail('创作意图快照包含空内容');
    if (!Number.isFinite(statement.confidence)
        || statement.confidence < 0 || statement.confidence > 1) fail('confidence 必须位于 0 到 1');
    validateConfirmation(statement.knowledgeClass, statement.confirmation);
    validateEvidence(statement.evidence, statement.knowledgeClass !== 'author_explicit');
    const { statementHash, ...body } = statement;
    if (await hash(body) !== statementHash) fail(`创作意图陈述 hash 校验失败: ${statement.statementId}`);
  }
  if (containsCredential(snapshot)) fail('创作意图快照包含凭据或授权信息');
  const { contentHash, ...body } = snapshot;
  if (await hash(body) !== contentHash) fail('创作意图快照 contentHash 校验失败');
}

export async function buildInitializationCandidateBundle(
  input: BuildInitializationBundleInput,
): Promise<InitializationCandidateBundleV1> {
  if (!input.novelId.trim()) fail('作品 ID 不能为空');
  if (!Number.isInteger(input.revision) || input.revision < 1) fail('候选包 revision 必须从 1 开始递增');
  if (input.items.length === 0) fail('初始化候选包不能为空');

  const ids = new Set<string>();
  const items: InitializationCandidateV1[] = [];
  for (const item of input.items) {
    if (!item.candidateId.trim()) fail('候选 ID 不能为空');
    if (ids.has(item.candidateId)) fail(`候选 ID 重复: ${item.candidateId}`);
    ids.add(item.candidateId);
    if (!item.explanation.trim()) fail('每个初始化候选必须解释生成依据');
    if (item.confidence < 0 || item.confidence > 1) fail('confidence 必须位于 0 到 1');
    validateConfirmation(item.knowledgeClass, item.confirmation);
    validateEvidence(item.evidence, true);
    const candidateBody = {
      candidateId: item.candidateId,
      targetType: item.targetType,
      proposedValue: item.proposedValue,
      knowledgeClass: item.knowledgeClass,
      confidence: item.confidence,
      evidence: item.evidence,
      explanation: item.explanation,
      conflicts: item.conflicts,
      dependsOnCandidateIds: item.dependsOnCandidateIds,
    };
    items.push({ ...item, candidateHash: await hash(candidateBody) });
  }
  for (const item of items) {
    for (const dependencyId of item.dependsOnCandidateIds) {
      if (!ids.has(dependencyId)) fail(`候选依赖不存在: ${dependencyId}`);
      if (dependencyId === item.candidateId) fail('候选不能依赖自身');
    }
  }

  const withoutHash = {
    schemaVersion: INITIALIZATION_CANDIDATE_SCHEMA_VERSION,
    bundleId: input.bundleId ?? crypto.randomUUID(),
    novelId: input.novelId,
    revision: input.revision,
    ...(input.parentBundleId ? { parentBundleId: input.parentBundleId } : {}),
    intent: input.intent,
    items,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  return { ...withoutHash, contentHash: await hash(withoutHash) };
}

export async function decideInitializationCandidates(
  bundle: InitializationCandidateBundleV1,
  expectedBundleHash: string,
  decisions: InitializationCandidateDecisionV1[],
): Promise<InitializationCandidateBundleV1> {
  if (bundle.contentHash !== expectedBundleHash) fail('候选包已变化，请重新审查');
  if (decisions.length === 0) fail('至少需要一项作者决策');
  const decisionIds = new Set<string>();
  const decisionsById = new Map(decisions.map((decision) => {
    if (decisionIds.has(decision.candidateId)) fail(`候选重复决策: ${decision.candidateId}`);
    decisionIds.add(decision.candidateId);
    return [decision.candidateId, decision];
  }));
  for (const candidateId of decisionsById.keys()) {
    if (!bundle.items.some((item) => item.candidateId === candidateId)) fail(`候选不存在: ${candidateId}`);
  }

  const now = new Date().toISOString();
  const items = bundle.items.map((item) => {
    const decision = decisionsById.get(item.candidateId);
    if (!decision) return item;
    if (decision.expectedCandidateHash !== item.candidateHash) fail(`候选已变化: ${item.candidateId}`);
    const hasConflicts = item.conflicts.length > 0;
    if (decision.decision === 'confirm' && hasConflicts && !decision.conflictAcknowledged) {
      fail(`候选冲突尚未确认: ${item.candidateId}`);
    }
    return {
      ...item,
      conflictAcknowledged: decision.decision === 'confirm' && hasConflicts
        ? true
        : item.conflictAcknowledged,
      confirmation: {
        status: decision.decision === 'confirm' ? 'confirmed' as const : 'rejected' as const,
        confirmedBy: 'author' as const,
        confirmedAt: now,
      },
    };
  });
  return buildInitializationCandidateBundle({
    bundleId: crypto.randomUUID(),
    novelId: bundle.novelId,
    revision: bundle.revision + 1,
    parentBundleId: bundle.bundleId,
    intent: bundle.intent,
    createdAt: now,
    items: items.map(({ candidateHash: _candidateHash, ...item }) => item),
  });
}

function validateBudget(governance: CreateDirectorGovernanceInput): void {
  const { limits, used } = governance.budget;
  if (governance.budget.onExceeded !== 'block') fail('预算超限策略必须为 block');
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value < 0) fail(`预算上限非法: ${name}`);
  }
  for (const [name, value] of Object.entries(used)) {
    if (!Number.isFinite(value) || value < 0) fail(`预算用量非法: ${name}`);
  }
  if (used.providerCalls > limits.maxProviderCalls
    || used.inputTokens > limits.maxInputTokens
    || used.outputTokens > limits.maxOutputTokens
    || used.costUsd > limits.maxCostUsd
    || used.durationMs > limits.maxDurationMs) {
    fail('导演预算已超限，必须阻断后续决策');
  }
}

export async function createDirectorGovernance(
  input: CreateDirectorGovernanceInput,
): Promise<DirectorGovernanceV1> {
  validateBudget(input);
  if (input.permissions.canApplyCanonChanges) fail('阶段 3 前置治理禁止自动 Apply Canon');
  if (input.permissions.canChangeProviderConfig) fail('导演不得修改 Provider 配置');
  if (input.permissions.allowedTaskTypes.length === 0) fail('必须声明允许的 AiTask 类型');
  const withoutHash = { schemaVersion: DIRECTOR_GOVERNANCE_SCHEMA_VERSION, ...input };
  return { ...withoutHash, contentHash: await hash(withoutHash) };
}

export function assertDirectorDecisionAllowed(
  governance: DirectorGovernanceV1,
  taskType: string,
  targetType?: InitializationCandidateV1['targetType'],
): void {
  validateBudget(governance);
  if (!governance.permissions.canSubmitTasks) fail('导演没有提交任务权限');
  if (!governance.permissions.allowedTaskTypes.includes(taskType)) fail(`任务类型未获授权: ${taskType}`);
  if (targetType && !governance.permissions.allowedTargetTypes.includes(targetType)) {
    fail(`Canon 目标未获授权: ${targetType}`);
  }
}

export async function createDirectorDecisionAudit(
  input: CreateDirectorDecisionAuditInput,
): Promise<DirectorDecisionAuditV1> {
  if (!input.rationale.trim()) fail('决策审计必须记录理由');
  if (input.evidence.length === 0) fail('决策审计必须关联证据');
  if (!input.requiresUserConfirmation) fail('导演决策必须保留用户确认边界');
  const withoutHash = { schemaVersion: DIRECTOR_GOVERNANCE_SCHEMA_VERSION, ...input };
  return { ...withoutHash, contentHash: await hash(withoutHash) };
}

export function compileStage3PrerequisiteSnapshots(
  intent: CreativeIntentSnapshotV1,
  governance: DirectorGovernanceV1,
): {
  inputPayload: Record<string, unknown>;
  contextBudget: DirectorGovernanceV1['budget'];
  constraintPayload: Record<string, unknown>;
} {
  if (intent.novelId !== governance.novelId || intent.intentId !== governance.intent.intentId
      || intent.revision !== governance.intent.revision || intent.contentHash !== governance.intent.contentHash) {
    fail('治理约束与冻结创作意图不一致');
  }
  return {
    inputPayload: { contract: 'creative_intent_v1', intent },
    contextBudget: governance.budget,
    constraintPayload: {
      contract: 'director_governance_v1',
      governance,
      autoApply: false,
      taskSystem: 'ai_task_dag',
    },
  };
}
