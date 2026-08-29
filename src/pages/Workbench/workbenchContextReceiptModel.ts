import type { ToolCallEvent } from '../../types/conversation';

export type ContextSourceStatus =
  'used' | 'read' | 'snapshot' | 'truncated' | 'omitted' | 'missing' | 'fallback';

export type SnapshotRequestSourceStatus =
  'included' | 'truncated' | 'omitted_empty' | 'omitted_budget' | 'unverified';

export type ContextSourceGroup = 'foundation' | 'structure' | 'controls' | 'continuity';

export interface ContextSourceReceiptItem {
  type: string;
  title: string;
  status: ContextSourceStatus;
  group: ContextSourceGroup;
  count: number;
  detail?: string;
}

export interface ContextEvidenceChain {
  snapshot: {
    usedCount: number;
    sourceCount: number;
    reference?: string;
  };
  provider: {
    status: SnapshotRequestSourceStatus;
    includedCount?: number;
    sourceCount: number;
    reference?: string;
    messageCount?: number;
  };
}

export interface ToolContextReceipt {
  evidence: 'explicit' | 'observed' | 'unavailable';
  sources: ContextSourceReceiptItem[];
  snapshotRequestSourceStatus?: SnapshotRequestSourceStatus;
  evidenceChain?: ContextEvidenceChain;
}

const CONTEXT_CONSUMER_TOOLS = new Set([
  'generate_chapter',
  'generate_outline',
  'generate_characters',
  'suggest_events',
  'expand_settings',
  'polish_chapter',
  'check_quality',
  'summarize_chapter',
  'generate_scene_plan',
  'generate_prose',
  'evaluate_prose',
]);

interface ContextSourceDefinition {
  title: string;
  group: ContextSourceGroup;
  order: number;
}

const CONTEXT_SOURCE_DEFINITIONS: Record<string, ContextSourceDefinition> = {
  novel: { title: '作品基础', group: 'foundation', order: 10 },
  novel_context: { title: '小说上下文', group: 'foundation', order: 15 },
  world_setting: { title: '世界设定', group: 'foundation', order: 20 },
  world_state: { title: '世界状态', group: 'foundation', order: 25 },
  rule_system: { title: '规则设定', group: 'foundation', order: 30 },
  protagonist: { title: '主角设定', group: 'foundation', order: 40 },
  master_outline: { title: '全书大纲', group: 'structure', order: 50 },
  volume_outline: { title: '分卷大纲', group: 'structure', order: 60 },
  chapter_outline: { title: '章节大纲', group: 'structure', order: 70 },
  chapter_info: { title: '章节信息', group: 'structure', order: 75 },
  chapter_engineering: { title: '章节工程', group: 'structure', order: 80 },
  style_profile: { title: '风格方案', group: 'controls', order: 90 },
  output_profile: { title: '输出控制', group: 'controls', order: 100 },
  chapter_character: { title: '本章角色', group: 'continuity', order: 110 },
  character_state: { title: '人物状态', group: 'continuity', order: 120 },
  chapter_event: { title: '本章事件', group: 'continuity', order: 130 },
  context_record: { title: '正式上下文', group: 'continuity', order: 140 },
  memory_context: { title: '长期记忆（Memory）', group: 'continuity', order: 150 },
  adopted_chapter: { title: '前章采用稿', group: 'continuity', order: 160 },
  provisional_candidate: { title: '前章候选', group: 'continuity', order: 170 },
  faction: { title: '势力资产', group: 'continuity', order: 180 },
  location: { title: '地点资产', group: 'continuity', order: 190 },
  reference_material: { title: '参考资料', group: 'continuity', order: 200 },
  current_editor: { title: '当前编辑稿', group: 'continuity', order: 210 },
  user_instruction: { title: '本轮指令', group: 'continuity', order: 220 },
};

const UNKNOWN_SOURCE_DEFINITION: ContextSourceDefinition = {
  title: '其他上下文',
  group: 'continuity',
  order: 999,
};

const READ_TOOL_SOURCES: Record<string, string> = {
  'novel.read_context': 'novel_context',
  'novel.read': 'novel_context',
  'novel.read@1': 'novel_context',
  'chapter.read_outline': 'chapter_outline',
  'structure.read': 'chapter_outline',
  'structure.read@1': 'chapter_outline',
  'context.read': 'context_record',
  'context.read@1': 'context_record',
  get_character_states: 'character_state',
  search_memory: 'memory_context',
  'memory.search': 'memory_context',
  'memory.search@1': 'memory_context',
  query_world_state: 'world_state',
  query_character_state: 'character_state',
  query_chapter_info: 'chapter_info',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readMemoryItemCount(result: unknown): number | undefined {
  if (!isRecord(result)) return undefined;
  const data = isRecord(result.data) ? result.data : undefined;
  const items = data?.items ?? result.items;
  return Array.isArray(items) ? items.length : undefined;
}

function normalizeStatus(value: unknown): ContextSourceStatus | undefined {
  if (value === 'used' || value === 'missing' || value === 'fallback') return value;
  if (value === 'read' || value === 'observed') return 'read';
  return undefined;
}

function normalizeSourceType(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return /^[a-z][a-z0-9_.-]{0,63}$/u.test(normalized) ? normalized : undefined;
}

function safeVersionToken(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  if (typeof value !== 'string') return undefined;
  const token = value.trim();
  return /^(?:v|rev-)?\d{1,8}$/iu.test(token) ? token : undefined;
}

function compactEvidenceReference(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (/^[0-9a-f]{64}$/u.test(normalized)) {
    return `sha256:${normalized.slice(0, 8)}...${normalized.slice(-4)}`;
  }
  return /^txt_[0-9a-f]{8}$/u.test(normalized) ? normalized : undefined;
}

function safeCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function readSafeDetail(item: Record<string, unknown>): string | undefined {
  const version = safeVersionToken(item.version);
  const revision = safeVersionToken(item.revision);
  const parts: string[] = [];
  if (version) parts.push(/^v/iu.test(version) ? version : `v${version}`);
  if (revision) parts.push(`修订 ${revision.replace(/^rev-/iu, '')}`);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function sourceDefinition(type: string): ContextSourceDefinition {
  return CONTEXT_SOURCE_DEFINITIONS[type] ?? UNKNOWN_SOURCE_DEFINITION;
}

function compareSources(left: ContextSourceReceiptItem, right: ContextSourceReceiptItem): number {
  const leftOrder = sourceDefinition(left.type).order;
  const rightOrder = sourceDefinition(right.type).order;
  return leftOrder - rightOrder || left.status.localeCompare(right.status);
}

function mergeSources(items: ContextSourceReceiptItem[]): ContextSourceReceiptItem[] {
  const merged = new Map<string, ContextSourceReceiptItem>();
  for (const item of items) {
    const key = `${item.group}:${item.type}:${item.status}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, item);
      continue;
    }
    existing.count += item.count;
    if (existing.detail !== item.detail) delete existing.detail;
  }
  return [...merged.values()].sort(compareSources);
}

interface ExplicitSourceBatch {
  items: unknown[];
  snapshotRequestSourceStatus?: SnapshotRequestSourceStatus;
  generationSourceStatuses?: Record<string, SnapshotRequestSourceStatus>;
  requiresProviderEvidence: boolean;
  snapshotReference?: string;
  providerReference?: string;
  messageCount?: number;
}

function normalizeSnapshotRequestSourceStatus(
  value: unknown,
): SnapshotRequestSourceStatus | undefined {
  if (
    value === 'included' ||
    value === 'truncated' ||
    value === 'omitted_empty' ||
    value === 'omitted_budget'
  ) {
    return value;
  }
  return undefined;
}

function generationSnapshotStatus(container: Record<string, unknown>): SnapshotRequestSourceStatus {
  const providerEvidence = isRecord(container.providerRequestEvidence)
    ? container.providerRequestEvidence
    : undefined;
  return (
    normalizeSnapshotRequestSourceStatus(providerEvidence?.providerSourceStatus) ??
    normalizeSnapshotRequestSourceStatus(providerEvidence?.snapshotRequestSourceStatus) ??
    'unverified'
  );
}

function generationProviderStatuses(
  container: Record<string, unknown>,
): Record<string, SnapshotRequestSourceStatus> | undefined {
  const providerEvidence = isRecord(container.providerRequestEvidence)
    ? container.providerRequestEvidence
    : undefined;
  const rawStatuses = isRecord(providerEvidence?.generationSourceStatuses)
    ? providerEvidence.generationSourceStatuses
    : undefined;
  if (!rawStatuses) return undefined;
  const statuses = Object.entries(rawStatuses).flatMap(([rawType, rawStatus]) => {
    const type = normalizeSourceType(rawType);
    const status = normalizeSnapshotRequestSourceStatus(rawStatus);
    return type && status ? ([[type, status]] as const) : [];
  });
  return statuses.length > 0 ? Object.fromEntries(statuses) : undefined;
}

function explicitSourceBatches(result: unknown): ExplicitSourceBatch[] {
  if (!isRecord(result)) return [];
  const data = isRecord(result.data) ? result.data : undefined;
  const batches: ExplicitSourceBatch[] = [];
  for (const container of [result.generationContext, data?.generationContext]) {
    if (!isRecord(container) || !Array.isArray(container.sources)) continue;
    const providerEvidence = isRecord(container.providerRequestEvidence)
      ? container.providerRequestEvidence
      : undefined;
    batches.push({
      items: container.sources,
      snapshotRequestSourceStatus: generationSnapshotStatus(container),
      generationSourceStatuses: generationProviderStatuses(container),
      requiresProviderEvidence: true,
      snapshotReference:
        compactEvidenceReference(container.contextHash) ??
        compactEvidenceReference(providerEvidence?.snapshotContextHash),
      providerReference: compactEvidenceReference(providerEvidence?.messagesSha256),
      messageCount: safeCount(providerEvidence?.messageCount),
    });
  }
  for (const container of [result.contextReceipt, data?.contextReceipt]) {
    if (!isRecord(container) || !Array.isArray(container.sources)) continue;
    batches.push({ items: container.sources, requiresProviderEvidence: false });
  }
  if (Array.isArray(result.contextSources)) {
    batches.push({ items: result.contextSources, requiresProviderEvidence: false });
  }
  if (Array.isArray(data?.contextSources)) {
    batches.push({ items: data.contextSources, requiresProviderEvidence: false });
  }
  return batches;
}

function projectSnapshotSourceStatus(
  status: ContextSourceStatus,
  batch: ExplicitSourceBatch,
  sourceType: string,
): ContextSourceStatus {
  if (status !== 'used' || !batch.requiresProviderEvidence) return status;
  const providerStatus = batch.generationSourceStatuses?.[sourceType];
  const effectiveStatus = providerStatus ?? batch.snapshotRequestSourceStatus;
  if (effectiveStatus === 'included') return 'used';
  if (effectiveStatus === 'truncated') return 'truncated';
  if (effectiveStatus === 'omitted_empty' || effectiveStatus === 'omitted_budget') {
    return 'omitted';
  }
  return 'snapshot';
}

function strictestSnapshotStatus(
  statuses: SnapshotRequestSourceStatus[],
): SnapshotRequestSourceStatus | undefined {
  if (statuses.length === 0) return undefined;
  if (statuses.includes('omitted_budget')) return 'omitted_budget';
  if (statuses.includes('omitted_empty')) return 'omitted_empty';
  if (statuses.includes('truncated')) return 'truncated';
  if (statuses.includes('unverified')) return 'unverified';
  return 'included';
}

function readExplicitSources(result: unknown): {
  sources: ContextSourceReceiptItem[];
  snapshotRequestSourceStatus?: SnapshotRequestSourceStatus;
  evidenceChain?: ContextEvidenceChain;
} {
  const seen = new Set<string>();
  const batches = explicitSourceBatches(result);
  const sources: ContextSourceReceiptItem[] = [];
  let evidenceChain: ContextEvidenceChain | undefined;
  let primaryGenerationBatchSeen = false;
  for (const batch of batches) {
    const isPrimaryGenerationBatch = batch.requiresProviderEvidence && !primaryGenerationBatchSeen;
    if (batch.requiresProviderEvidence) primaryGenerationBatchSeen = true;
    let snapshotUsedCount = 0;
    let providerIncludedCount = 0;
    let sourceCount = 0;
    for (const item of batch.items) {
      if (!isRecord(item)) continue;
      const normalizedStatus = normalizeStatus(item.status);
      if (!normalizedStatus) continue;
      const rawType = normalizeSourceType(item.type);
      if (!rawType) continue;
      const status = projectSnapshotSourceStatus(normalizedStatus, batch, rawType);
      const sourceIdentity =
        typeof item.sourceId === 'string'
          ? item.sourceId
          : typeof item.title === 'string'
            ? item.title
            : '';
      const seenKey = `${status}:${rawType}:${sourceIdentity}`;
      if (seen.has(seenKey)) continue;
      seen.add(seenKey);
      const type = CONTEXT_SOURCE_DEFINITIONS[rawType] ? rawType : 'other';
      const definition = sourceDefinition(type);
      sources.push({
        type,
        title: definition.title,
        status,
        group: definition.group,
        count: 1,
        detail: readSafeDetail(item),
      });
      if (isPrimaryGenerationBatch) {
        sourceCount += 1;
        if (normalizedStatus === 'used') snapshotUsedCount += 1;
        if (status === 'used') providerIncludedCount += 1;
      }
    }
    if (isPrimaryGenerationBatch) {
      const providerStatus = batch.snapshotRequestSourceStatus ?? 'unverified';
      evidenceChain = {
        snapshot: {
          usedCount: snapshotUsedCount,
          sourceCount,
          ...(batch.snapshotReference ? { reference: batch.snapshotReference } : {}),
        },
        provider: {
          status: providerStatus,
          ...(providerStatus !== 'unverified' ? { includedCount: providerIncludedCount } : {}),
          sourceCount,
          ...(batch.providerReference ? { reference: batch.providerReference } : {}),
          ...(batch.messageCount !== undefined ? { messageCount: batch.messageCount } : {}),
        },
      };
    }
  }
  const snapshotStatuses = batches.flatMap((batch) =>
    batch.requiresProviderEvidence && batch.snapshotRequestSourceStatus
      ? [batch.snapshotRequestSourceStatus]
      : [],
  );
  return {
    sources: mergeSources(sources),
    snapshotRequestSourceStatus: strictestSnapshotStatus(snapshotStatuses),
    ...(evidenceChain ? { evidenceChain } : {}),
  };
}

function readObservedSources(
  event: ToolCallEvent,
  runEvents: ToolCallEvent[],
): ContextSourceReceiptItem[] {
  const seen = new Set<string>();
  const sources = runEvents.flatMap((candidate) => {
    const type = READ_TOOL_SOURCES[candidate.toolName];
    if (
      !type ||
      candidate.runId !== event.runId ||
      candidate.sequence >= event.sequence ||
      candidate.status !== 'succeeded' ||
      seen.has(type)
    ) {
      return [];
    }
    seen.add(type);
    const definition = sourceDefinition(type);
    const memoryItemCount =
      type === 'memory_context' ? readMemoryItemCount(candidate.result) : undefined;
    const status: ContextSourceStatus = memoryItemCount === 0 ? 'missing' : 'read';
    return [
      {
        type,
        title: definition.title,
        status,
        group: definition.group,
        count: 1,
        ...(memoryItemCount !== undefined ? { detail: `召回 ${memoryItemCount} 条` } : {}),
      },
    ];
  });
  return mergeSources(sources);
}

export function resolveToolContextReceipt(
  event: ToolCallEvent,
  runEvents: ToolCallEvent[] = [],
): ToolContextReceipt | null {
  const explicit = readExplicitSources(event.result);
  if (explicit.sources.length > 0) {
    return {
      evidence: 'explicit',
      sources: explicit.sources,
      ...(explicit.snapshotRequestSourceStatus
        ? { snapshotRequestSourceStatus: explicit.snapshotRequestSourceStatus }
        : {}),
      ...(explicit.evidenceChain ? { evidenceChain: explicit.evidenceChain } : {}),
    };
  }
  if (event.status !== 'succeeded' || !CONTEXT_CONSUMER_TOOLS.has(event.toolName)) return null;

  const observedSources = readObservedSources(event, runEvents);
  return observedSources.length > 0
    ? { evidence: 'observed', sources: observedSources }
    : { evidence: 'unavailable', sources: [] };
}

const CONTEXT_ENVELOPE_KEYS = new Set(['generationcontext', 'contextreceipt', 'contextsources']);

function compactTechnicalReference(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function sanitizedFieldName(key: string): string {
  return key.replace(/[-_]/gu, '').toLowerCase();
}

function sanitizeToolDetailValue(value: unknown, key = '', depth = 0): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  const field = sanitizedFieldName(key);
  if (typeof value === 'string') {
    if (!field) return `[文本结果已隐藏 · ${value.length} 字符]`;
    if (
      /^(?:apikey|authorization|credentials?|password|secret|accesstoken|refreshtoken)$/u.test(
        field,
      )
    ) {
      return '[敏感字段已隐藏]';
    }
    if (field.includes('hash')) return compactTechnicalReference(value);
    if (field === 'id' || field.endsWith('id') || field.includes('refid')) {
      return compactTechnicalReference(value);
    }
    if (
      field === 'content' ||
      field.endsWith('content') ||
      field === 'text' ||
      field.endsWith('text') ||
      field.includes('transcript') ||
      field.includes('prompt') ||
      field === 'messages' ||
      field === 'raw' ||
      field === 'body'
    ) {
      return `[文本内容已隐藏 · ${value.length} 字符]`;
    }
    if (value.includes('\n') || value.length > 160) {
      return `[长文本已隐藏 · ${value.length} 字符]`;
    }
    return value;
  }
  if (
    field.includes('transcript') ||
    field.includes('prompt') ||
    field === 'messages' ||
    field === 'raw' ||
    field === 'body'
  ) {
    return '[结构化文本已隐藏]';
  }
  if (depth >= 5) return '[嵌套详情已隐藏]';
  if (Array.isArray(value)) {
    const projected = value
      .slice(0, 20)
      .map((item) => sanitizeToolDetailValue(item, key, depth + 1));
    if (value.length > 20) projected.push(`[另有 ${value.length - 20} 项已隐藏]`);
    return projected;
  }
  if (!isRecord(value)) return undefined;

  const projected: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (CONTEXT_ENVELOPE_KEYS.has(sanitizedFieldName(childKey))) continue;
    const sanitized = sanitizeToolDetailValue(childValue, childKey, depth + 1);
    if (sanitized !== undefined) projected[childKey] = sanitized;
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}

export function hideContextReceiptInternals(result: unknown): unknown {
  return sanitizeToolDetailValue(result);
}
