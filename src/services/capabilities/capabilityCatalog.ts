import type { ToolJsonSchema } from '../../types/toolRegistry';

/**
 * Capability assetization is deliberately separate from the production Tool
 * Registry.  This catalog records what the product can do, where the current
 * implementation lives, and whether the capability has earned an Agent
 * exposure gate.  Adding an entry here does not make it callable by a model.
 */
export type CapabilityKind = 'tool' | 'subagent' | 'host_protocol';
export type CapabilityHealth = 'working' | 'partial' | 'broken' | 'legacy' | 'unknown';
export type CapabilityExposure = 'catalog_only' | 'candidate' | 'stable' | 'internal';
export type CapabilitySideEffect = 'none' | 'proposal' | 'write';
export type CapabilityConfirmation = 'never' | 'user_required';
export type CapabilityScope = 'novel' | 'chapter' | 'draft' | 'project' | 'runtime';

export interface CapabilityEvidence {
  health: CapabilityHealth;
  callChain: readonly string[];
  userEntrypoints: readonly string[];
  implementationEntrypoints: readonly string[];
  sourceOfTruth: readonly string[];
  references: readonly string[];
  dynamicTests: readonly string[];
  blockers: readonly string[];
}

export interface CapabilityDefinition {
  id: string;
  version: '1';
  domain: string;
  kind: CapabilityKind;
  description: string;
  scope: CapabilityScope;
  inputSchema: ToolJsonSchema;
  outputSchema: ToolJsonSchema;
  permissions: readonly string[];
  sideEffect: CapabilitySideEffect;
  confirmationPolicy: CapabilityConfirmation;
  executor: string;
  /** Domain facade adapter; presence does not change catalog_only exposure. */
  facade?: string;
  legacyAliases: readonly string[];
  exposure: CapabilityExposure;
  evidence: CapabilityEvidence;
}

const id = (description: string): ToolJsonSchema => ({
  type: 'string',
  description,
  minLength: 1,
  maxLength: 160,
});

const novelInput: ToolJsonSchema = {
  type: 'object',
  required: ['novelId'],
  additionalProperties: false,
  properties: { novelId: id('目标作品 ID') },
};

const chapterInput: ToolJsonSchema = {
  type: 'object',
  required: ['novelId', 'chapterId'],
  additionalProperties: false,
  properties: { novelId: id('目标作品 ID'), chapterId: id('目标章节 ID') },
};

const contextChapterInput: ToolJsonSchema = {
  type: 'object',
  required: ['novelId', 'chapterId'],
  additionalProperties: false,
  properties: {
    novelId: id('目标作品 ID'),
    chapterId: id('目标章节 ID'),
    query: { type: 'string', minLength: 1, maxLength: 1000, description: '可选的记忆检索词' },
  },
};

const candidateOutput: ToolJsonSchema = {
  type: 'object',
  required: ['artifactId', 'candidateOnly'],
  additionalProperties: false,
  properties: {
    artifactId: id('不可变候选产物 ID'),
    candidateOnly: { type: 'boolean' },
  },
};

function evidence(
  health: CapabilityHealth,
  callChain: readonly string[],
  userEntrypoints: readonly string[],
  implementationEntrypoints: readonly string[],
  sourceOfTruth: readonly string[],
  references: readonly string[],
  blockers: readonly string[] = [],
  dynamicTests: readonly string[] = [],
): CapabilityEvidence {
  return {
    health,
    callChain,
    userEntrypoints,
    implementationEntrypoints,
    sourceOfTruth,
    references,
    dynamicTests,
    blockers,
  };
}

const commonRead = {
  version: '1' as const,
  kind: 'tool' as const,
  sideEffect: 'none' as const,
  confirmationPolicy: 'never' as const,
  exposure: 'catalog_only' as const,
};

/**
 * The first catalog is intentionally conservative.  Every action is
 * catalog-only until the facade, ownership, restart, and negative-path gates
 * are evidenced.  Consumers must not turn this array into model-visible
 * tools without an explicit later migration step.
 */
export const CAPABILITY_CATALOG: readonly CapabilityDefinition[] = [
  {
    ...commonRead,
    id: 'novel.read',
    domain: 'novel',
    description: '读取当前作品及其可供创作使用的基础设定摘要。',
    scope: 'novel',
    inputSchema: novelInput,
    outputSchema: { type: 'object', additionalProperties: true },
    permissions: ['novel.read'],
    executor: 'project/world services',
    facade: 'projectCapability.readCurrentProject',
    legacyAliases: ['novel.read_context', 'novel.read_settings'],
    evidence: evidence(
      'partial',
      ['Workbench/legacy page', 'project service', 'SQLite repositories'],
      ['/novels', '作品详情', 'Workbench'],
      ['src-tauri/src/services/project_service.rs', 'src/services/agent-tools/project-tools.ts'],
      ['SQLite novels and project-owned setting records'],
      ['docs/architecture-audit-v2/capability_inventory.md#2'],
      ['设定、主角和作品 JSON/表来源尚未完全统一'],
      [
        'src/services/agent-tools/productionToolRuntime.test.ts',
        'src/services/capabilities/domain/domainFacade.test.ts',
      ],
    ),
  },
  {
    ...commonRead,
    id: 'structure.read',
    domain: 'structure',
    description: '读取卷、章节和已激活的大纲版本及其修订信息。',
    scope: 'chapter',
    inputSchema: chapterInput,
    outputSchema: { type: 'object', additionalProperties: true },
    permissions: ['novel.read', 'chapter.read'],
    executor: 'chapter/outline services',
    facade: 'projectCapability.readChapterPosition',
    legacyAliases: ['chapter.read_outline'],
    evidence: evidence(
      'partial',
      ['Workbench/outline UI', 'chapter/outline service', 'SQLite repositories'],
      ['卷章树', '章节大纲页面', 'Workbench'],
      ['src-tauri/src/services/chapter_service.rs', 'src-tauri/src/outline_commands.rs'],
      ['SQLite chapters, volumes and outline versions'],
      ['docs/architecture-audit-v2/capability_inventory.md#2'],
      ['version 与 active pointer 必须持续通过写后读和 CAS 证据'],
      [
        'src/services/agent-tools/productionToolRuntime.test.ts',
        'src/services/capabilities/domain/domainFacade.test.ts',
      ],
    ),
  },
  {
    ...commonRead,
    id: 'draft.read',
    domain: 'writing',
    description: '读取章节候选/草稿元数据和当前已采用正文引用。',
    scope: 'draft',
    inputSchema: chapterInput,
    outputSchema: { type: 'object', additionalProperties: true },
    permissions: ['novel.read', 'chapter.read'],
    executor: 'draftVersionService + chapter service (facade pending)',
    legacyAliases: ['draftService', 'chapterVersionService'],
    evidence: evidence(
      'partial',
      ['Writing Workspace', 'draft service', 'SQLite draft repository'],
      ['Writing Workspace', '审阅编辑器'],
      [
        'src/services/chapters/chapterVersionService.ts',
        'src-tauri/src/repositories/draft_repository.rs',
      ],
      ['SQLite chapter_drafts and chapters.adopted_draft_id'],
      ['docs/architecture-audit-v2/duplicate_analysis.md#DUP-15'],
      ['LocalStorage 与内存版本源仍存在兼容读取路径'],
    ),
  },
  {
    ...commonRead,
    id: 'context.read',
    domain: 'context',
    description: '读取已采用正文、章节总结和上下文记录的可审计快照。',
    scope: 'chapter',
    inputSchema: contextChapterInput,
    outputSchema: { type: 'object', additionalProperties: true },
    permissions: ['novel.read', 'chapter.read'],
    executor: 'context/chapter summary services',
    facade: 'contextCapability.readCurrentStoryContext',
    legacyAliases: ['chapter.read_context', 'get_chapter_context'],
    evidence: evidence(
      'partial',
      ['Workbench/task runtime', 'context compiler', 'memory/context repositories'],
      ['Workbench', '章节总结/上下文面板'],
      ['src/services/generation/generationContextCompiler.ts', 'src/services/context'],
      ['SQLite adopted drafts, context records and memory documents'],
      ['docs/architecture-audit-v2/capability_merge_plan.md#4.1'],
      ['summary apply 与完整 context bundle 的来源协议仍需统一'],
    ),
  },
  {
    ...commonRead,
    id: 'memory.search',
    domain: 'memory',
    description: '在当前作品已采用事实中检索带来源的记忆片段。',
    scope: 'novel',
    inputSchema: {
      type: 'object',
      required: ['novelId', 'query'],
      additionalProperties: false,
      properties: {
        novelId: id('目标作品 ID'),
        query: { type: 'string', minLength: 1, maxLength: 1000 },
      },
    },
    outputSchema: { type: 'object', additionalProperties: true },
    permissions: ['novel.read'],
    executor: 'memoryService',
    facade: 'contextCapability.searchMemory',
    legacyAliases: ['search_memory', 'novelMemoryRetriever'],
    evidence: evidence(
      'partial',
      ['Workbench tool/fallback', 'memory service', 'SQLite FTS/vector repositories'],
      ['Workbench', '章节生成上下文'],
      [
        'src/services/memory/memoryService.ts',
        'src/services/memory/retrieval/novelMemoryRetriever.ts',
      ],
      ['SQLite memory_documents and memory relations'],
      ['docs/architecture-audit-v2/capability_inventory.md#3'],
      ['词法检索有证据；embedding/混合检索仍为部分能力'],
      [
        'src/services/agent-tools/productionToolRuntime.test.ts',
        'src/services/capabilities/domain/domainFacade.test.ts',
      ],
    ),
  },
  {
    ...commonRead,
    id: 'characters.read',
    domain: 'characters',
    description: '读取作品角色及其当前状态、关系和行为边界。',
    scope: 'novel',
    inputSchema: novelInput,
    outputSchema: { type: 'object', additionalProperties: true },
    permissions: ['novel.read'],
    executor: 'character services (facade pending)',
    legacyAliases: ['query_character_state', 'get_character_states'],
    evidence: evidence(
      'partial',
      ['Character page', 'character/state services', 'SQLite repositories'],
      ['角色库', '作品详情'],
      ['src/services/characters', 'src-tauri/src/repositories'],
      ['characters tables with legacy protagonist/JSON projections'],
      ['docs/architecture-audit-v2/duplicate_analysis.md#DUP-05'],
      ['角色事实源存在多轨，需先完成统一 projection'],
    ),
  },
  {
    ...commonRead,
    id: 'story_assets.read',
    domain: 'story_assets',
    description: '读取已经持久化并可供当前作品使用的势力、地点等资产。',
    scope: 'novel',
    inputSchema: novelInput,
    outputSchema: { type: 'object', additionalProperties: true },
    permissions: ['novel.read'],
    executor: 'story asset/content transaction services (facade pending)',
    legacyAliases: ['query_world_state'],
    evidence: evidence(
      'partial',
      ['Assets page', 'asset service', 'SQLite repositories'],
      ['资产中心'],
      ['src/pages/Assets/AssetsPage.tsx', 'src/services/content-transactions'],
      ['SQLite story asset records where present'],
      ['docs/architecture-audit-v2/capability_inventory.md#PRJ-22'],
      ['导入链和额外关系仍有未知/部分实现'],
    ),
  },
  {
    ...commonRead,
    id: 'reference.read',
    domain: 'reference',
    description: '读取当前作品参考资料的元数据和已激活切片。',
    scope: 'novel',
    inputSchema: novelInput,
    outputSchema: { type: 'object', additionalProperties: true },
    permissions: ['novel.read'],
    executor: 'reference library service (facade pending)',
    legacyAliases: ['referenceLibraryService'],
    evidence: evidence(
      'partial',
      ['Reference page', 'reference service', 'SQLite/file repositories'],
      ['参考资料页', '风格分析入口'],
      ['src/services/references'],
      ['SQLite reference metadata plus user-selected files'],
      ['docs/architecture-audit-v2/capability_inventory.md#PRJ-27'],
      ['文件权限、激活和导入事务需要统一 facade'],
    ),
  },
  {
    ...commonRead,
    id: 'style.read',
    domain: 'style',
    description: '读取当前作品激活的风格与输出控制方案。',
    scope: 'novel',
    inputSchema: novelInput,
    outputSchema: { type: 'object', additionalProperties: true },
    permissions: ['novel.read'],
    executor: 'style profile/output control services (facade pending)',
    legacyAliases: ['style.read_profile', 'style.read_output_control'],
    evidence: evidence(
      'partial',
      ['Style page', 'style services', 'SQLite/compat projections'],
      ['/styles', 'Workbench writer settings'],
      ['src/services/styles', 'src/pages/StyleProfiles'],
      ['SQLite style/output profile records'],
      ['docs/architecture-audit-v2/capability_inventory.md#PRJ-25'],
      ['LocalStorage 模板/设置兼容路径尚未完全单写'],
      ['src/services/agent-tools/productionToolRuntime.test.ts'],
    ),
  },
  {
    ...commonRead,
    id: 'transfer.export',
    domain: 'transfer',
    description: '在用户明确选择文件目标后导出作品或备份。',
    scope: 'project',
    inputSchema: novelInput,
    outputSchema: { type: 'object', additionalProperties: true },
    permissions: ['novel.read'],
    executor: 'project backup/export services (confirmation adapter pending)',
    legacyAliases: ['exportNovel', 'projectBackupService'],
    evidence: evidence(
      'partial',
      ['Export UI', 'backup/export service', 'filesystem'],
      ['导出中心', '设置备份'],
      ['src/services/backup', 'src/services/export'],
      ['SQLite snapshot and explicitly selected filesystem target'],
      ['docs/architecture-audit-v2/capability_inventory.md#PRJ-30'],
      ['文件选择/权限确认不能由模型静默完成'],
    ),
  },
  {
    id: 'writing.generate',
    version: '1',
    domain: 'writing',
    kind: 'subagent',
    description: '根据冻结上下文生成章节候选，不覆盖正式正文。',
    scope: 'chapter',
    inputSchema: chapterInput,
    outputSchema: candidateOutput,
    permissions: ['novel.read', 'chapter.read'],
    sideEffect: 'proposal',
    confirmationPolicy: 'never',
    executor: 'workbenchChapterWriter (candidate adapter)',
    facade: 'writingCapability.generateCandidate',
    legacyAliases: ['generate_chapter', 'generate_prose', 'chapterWriter'],
    exposure: 'catalog_only',
    evidence: evidence(
      'partial',
      [
        'Workbench',
        'taskRuntimeAdapter fixed orchestration',
        'workbenchChapterWriter',
        'ResultArtifact',
      ],
      ['Workbench composer', '旧生成面板兼容入口'],
      ['src/services/conversation/workbenchChapterWriter.ts', 'src/services/generation'],
      ['ResultArtifact candidate; adopted draft remains host-controlled'],
      ['docs/audit-v2/capability_health.md#AI-03'],
      ['尚无独立 Agent loop、模型快照、allowlist 和真实模型证据'],
    ),
  },
  {
    id: 'writing.continue',
    version: '1',
    domain: 'writing',
    kind: 'subagent',
    description: '基于当前章节上下文继续生成新的候选版本。',
    scope: 'chapter',
    inputSchema: chapterInput,
    outputSchema: candidateOutput,
    permissions: ['novel.read', 'chapter.read'],
    sideEffect: 'proposal',
    confirmationPolicy: 'never',
    executor: 'workbenchChapterWriter (candidate adapter)',
    facade: 'writingCapability.continueCandidate',
    legacyAliases: ['continueChapter', 'generate_chapter'],
    exposure: 'catalog_only',
    evidence: evidence(
      'partial',
      ['Workbench', 'taskGoalRouting', 'writer service', 'ResultArtifact'],
      ['Workbench composer'],
      [
        'src/services/conversation/taskGoalRouting.ts',
        'src/services/conversation/workbenchChapterWriter.ts',
      ],
      ['ResultArtifact candidate'],
      ['docs/architecture-audit-v2/capability_merge_plan.md#M1'],
      ['当前由固定意图路由，不是模型自主选择'],
    ),
  },
  {
    id: 'writing.rewrite',
    version: '1',
    domain: 'writing',
    kind: 'subagent',
    description: '基于明确来源版本和用户指令生成重写候选。',
    scope: 'chapter',
    inputSchema: chapterInput,
    outputSchema: candidateOutput,
    permissions: ['novel.read', 'chapter.read'],
    sideEffect: 'proposal',
    confirmationPolicy: 'never',
    executor: 'workbenchChapterWriter rewrite path (candidate adapter)',
    facade: 'writingCapability.rewriteCandidate',
    legacyAliases: ['polish_chapter', 'rewriteChapter'],
    exposure: 'catalog_only',
    evidence: evidence(
      'partial',
      ['Artifact card modification', 'writer service', 'ResultArtifact'],
      ['ArtifactCard 要求修改', 'Writing Workspace'],
      [
        'src/services/conversation/artifactDecisionService.ts',
        'src/services/conversation/workbenchChapterWriter.ts',
      ],
      ['ResultArtifact candidate with source hash'],
      ['docs/architecture-audit-v2/duplicate_analysis.md#DUP-03'],
      ['独立 rewrite SubAgent prompt/model/budget 尚未定义'],
    ),
  },
  {
    id: 'structure.propose_outline',
    version: '1',
    domain: 'structure',
    kind: 'subagent',
    description: '提出大纲候选，候选需经校验和用户确认后才能激活。',
    scope: 'chapter',
    inputSchema: chapterInput,
    outputSchema: candidateOutput,
    permissions: ['novel.read', 'chapter.read'],
    sideEffect: 'proposal',
    confirmationPolicy: 'never',
    executor: 'outline generation services (facade pending)',
    legacyAliases: ['generate_outline'],
    exposure: 'catalog_only',
    evidence: evidence(
      'partial',
      ['Outline UI/legacy path', 'outline AI service', 'candidate validator'],
      ['大纲页面', 'Workbench candidate path'],
      ['src-tauri/src/outline_commands.rs', 'src/services/outlines'],
      ['SQLite outline versions with explicit active pointer'],
      ['docs/architecture-audit-v2/capability_merge_plan.md#4.1'],
      ['生成与 validator 语义仍混在旧名称中'],
    ),
  },
  {
    id: 'context.propose_summary',
    version: '1',
    domain: 'context',
    kind: 'subagent',
    description: '提出章节总结/上下文更新候选，不直接更新正式记忆。',
    scope: 'chapter',
    inputSchema: chapterInput,
    outputSchema: candidateOutput,
    permissions: ['novel.read', 'chapter.read'],
    sideEffect: 'proposal',
    confirmationPolicy: 'never',
    executor: 'chapter summary/context services (facade pending)',
    legacyAliases: ['summarize_chapter', 'chapterSummaryService'],
    exposure: 'catalog_only',
    evidence: evidence(
      'partial',
      ['adopted draft', 'summary provider', 'ContextRecord candidate'],
      ['章节总结入口', 'Workbench artifact apply'],
      ['src/services/context', 'src/services/conversation/artifactApply.ts'],
      ['SQLite context records bound to adopted draft'],
      ['docs/architecture-audit-v2/capability_merge_plan.md#4.1'],
      ['必须保持 adopted draft/FK/source bundle 一致'],
    ),
  },
  {
    id: 'quality.review',
    version: '1',
    domain: 'quality',
    kind: 'subagent',
    description: '生成只读质量报告，不直接修正文稿或写入正式事实。',
    scope: 'chapter',
    inputSchema: chapterInput,
    outputSchema: candidateOutput,
    permissions: ['novel.read', 'chapter.read'],
    sideEffect: 'proposal',
    confirmationPolicy: 'never',
    executor: 'qualityCheckService + quality gate (adapter pending)',
    legacyAliases: ['check_quality', 'quality_check'],
    exposure: 'catalog_only',
    evidence: evidence(
      'partial',
      ['Writing Workspace/quality entry', 'quality service', 'report Artifact'],
      ['检查面板', '生成后质量检查'],
      ['src/services/quality', 'src-tauri/src/services'],
      ['quality report ResultArtifact or task fact'],
      ['docs/architecture-audit-v2/capability_inventory.md#AI-09'],
      ['报告、门禁、修复 proposal 需拆分为独立动作'],
    ),
  },
  {
    id: 'artifact.review',
    version: '1',
    domain: 'artifact_runtime',
    kind: 'host_protocol',
    description: '为候选产物发起人工审阅授权；不代表正式采用。',
    scope: 'draft',
    inputSchema: {
      type: 'object',
      required: ['artifactId'],
      properties: { artifactId: id('候选产物 ID') },
    },
    outputSchema: { type: 'object', additionalProperties: true },
    permissions: ['novel.read', 'chapter.read'],
    sideEffect: 'proposal',
    confirmationPolicy: 'user_required',
    executor: 'artifactDecisionService + review authorization',
    facade: 'artifactCapability.requestReview',
    legacyAliases: ['publish_candidate', 'reviewArtifact'],
    exposure: 'catalog_only',
    evidence: evidence(
      'working',
      ['ArtifactCard user action', 'artifactDecisionService', 'ReviewAuthorization SQLite facts'],
      ['ArtifactCard 确认审阅'],
      [
        'src/services/conversation/artifactDecisionService.ts',
        'src-tauri/src/services/conversation_service.rs',
      ],
      ['ResultArtifact, artifact_decisions, review_authorizations'],
      ['docs/audit-v2/phase1_validation.md#4.2'],
      [],
      [
        'src/services/conversation/artifactApply.test.ts',
        'tests/e2e/agent-production-closed-loop.spec.ts',
      ],
    ),
  },
  {
    id: 'artifact.apply_approved',
    version: '1',
    domain: 'artifact_runtime',
    kind: 'host_protocol',
    description: '消费用户确认的审阅授权并通过 CAS 事务采用正文。',
    scope: 'draft',
    inputSchema: {
      type: 'object',
      required: ['artifactId', 'authorizationId'],
      properties: { artifactId: id('候选产物 ID'), authorizationId: id('一次性授权 ID') },
    },
    outputSchema: { type: 'object', additionalProperties: true },
    permissions: ['business.write'],
    sideEffect: 'write',
    confirmationPolicy: 'user_required',
    executor: 'adopt_review_authorized_draft + SQLite CAS transaction',
    facade: 'artifactCapability.applyAuthorizedDraft',
    legacyAliases: ['adopt_artifact', 'save_draft'],
    exposure: 'catalog_only',
    evidence: evidence(
      'working',
      ['Review Workspace', 'artifact apply service', 'SQLite draft/adopt transaction'],
      ['Writing Workspace 保存/采用'],
      ['src/services/conversation/artifactApply.ts', 'src-tauri/src/services/chapter_service.rs'],
      ['SQLite chapter_drafts + chapters.adopted_draft_id + authorization facts'],
      ['docs/audit-v2/phase1_validation.md#4.2'],
      ['不能作为模型无确认自由 Tool 暴露'],
      [
        'src/services/conversation/artifactApply.test.ts',
        'tests/e2e/agent-production-closed-loop.spec.ts',
      ],
    ),
  },
] as const;

export const CAPABILITY_CATALOG_VERSION = 'capability_catalog_v1';

export function getCapability(idValue: string): CapabilityDefinition | undefined {
  return CAPABILITY_CATALOG.find((capability) => capability.id === idValue);
}

export function listCapabilitiesByDomain(domain: string): CapabilityDefinition[] {
  return CAPABILITY_CATALOG.filter((capability) => capability.domain === domain);
}

/**
 * The catalog is not an allowlist.  This intentionally returns an empty list
 * until a later migration supplies facade and runtime evidence and explicitly
 * changes exposure to `candidate` or `stable`.
 */
export function listAgentExposedCapabilities(): CapabilityDefinition[] {
  return CAPABILITY_CATALOG.filter(
    (capability) => capability.exposure === 'candidate' || capability.exposure === 'stable',
  );
}
