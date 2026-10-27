/**
 * Writing SubAgent 契约（candidate-only，设计稿脚手架）。
 *
 * 设计见 `docs/architecture/writing-subagent-contract.md`。本模块只提供纯函数：
 * 生成契约、复验不变式、读取特性开关。v3.7.0 起桌面端真实 API 模型默认走 SubAgent，
 * mock / 本地模型与浏览器模式继续走确定性 Writer，`localStorage` 置 `'0'` 可关闭；
 * 任何接入必须先经过 `assertWritingSubAgentContract`，保证 SubAgent 只能交付 `chapter_text`
 * 候选，绝不获得正式写入能力。
 */
import type { TaskModelSnapshot } from '../../types/conversation';
import type { ArtifactRevisionSource } from '../../types/artifactRevision';
import type { ContextReadToolName } from '../conversation/taskGoalRouting';
import {
  resolveChapterWordRange,
  type ChapterWordRangePercents,
} from '../conversation/chapterWordRangePolicy';

export const WRITING_SUBAGENT_CONTRACT_VERSION = 'writing_subagent_contract_v1_draft' as const;
export const WRITING_SUBAGENT_ID = 'writing-subagent' as const;
/** DSH 任务类型：写作走 `chapter_write`，润色走 `chapter_polish`（Rust 侧各自绑定唯一候选工具）。 */
export type WritingSubAgentTaskKind = 'chapter_write' | 'chapter_polish';
export const WRITING_SUBAGENT_FLAG_KEY = 'ai_novel_studio_writing_subagent_dsh';

/** 与 legacy 候选回合一致的只读工具；Canonical 名迁移后在此一处替换。 */
export const WRITING_SUBAGENT_READ_TOOLS = [
  'novel.read_context',
  'chapter.read_outline',
  'get_character_states',
  'search_memory',
] as const satisfies readonly ContextReadToolName[];

export type WritingSubAgentReadTool = (typeof WRITING_SUBAGENT_READ_TOOLS)[number];

export type WritingSubAgentCandidateTool = 'generate_chapter' | 'polish_chapter';

export interface WritingSubAgentBudget {
  maxCandidateAttempts: number;
  maxLengthRepairs: number;
  maxIntegrityRepairs: number;
  maxWallClockMs: number;
  maxOutputTokens: number;
}

export const WRITING_SUBAGENT_BUDGET_LIMITS = {
  maxCandidateAttempts: 3,
  maxLengthRepairs: 3,
  maxIntegrityRepairs: 3,
  maxWallClockMs: 15 * 60_000,
  maxOutputTokens: 32_000,
} as const;

export const DEFAULT_WRITING_SUBAGENT_BUDGET: WritingSubAgentBudget = {
  maxCandidateAttempts: 3,
  maxLengthRepairs: 2,
  maxIntegrityRepairs: 2,
  maxWallClockMs: 8 * 60_000,
  maxOutputTokens: 8_000,
};

export interface WritingSubAgentContract {
  contractVersion: typeof WRITING_SUBAGENT_CONTRACT_VERSION;
  agentId: typeof WRITING_SUBAGENT_ID;
  mode: 'candidate_only';
  formalWrites: 'forbidden';
  adoptionPath: 'review_authorization';
  taskKind: WritingSubAgentTaskKind;
  novelId: string;
  chapterId: string;
  goal: string;
  expectedTool: WritingSubAgentCandidateTool;
  expectedArtifactType: 'chapter_text';
  requiredReadTools: readonly WritingSubAgentReadTool[];
  allowedTools: readonly string[];
  wordRange?: { target: number; minimum: number; maximum: number };
  continuity?: { previousChapterId: string; sourceHash?: string };
  /** Exact candidate identity only; the native host re-reads and verifies its full text. */
  revisionSource?: ArtifactRevisionSource;
  budget: WritingSubAgentBudget;
  modelSnapshot: TaskModelSnapshot;
}

export interface PlanWritingSubAgentTurnInput {
  novelId: string;
  chapterId: string;
  goal: string;
  mode: 'generate' | 'polish';
  modelSnapshot: TaskModelSnapshot;
  targetWordCount?: number;
  wordRangePercents?: ChapterWordRangePercents;
  previousChapter?: { chapterId: string; sourceHash?: string };
  revisionSource?: ArtifactRevisionSource;
  budget?: Partial<WritingSubAgentBudget>;
}

/** 由字数区间推导输出预算，且不得超过冻结模型的 maxTokens。 */
export function outputTokenBudgetFor(
  wordRange: { maximum: number } | undefined,
  frozenMaxTokens?: number,
): number {
  const estimate = wordRange
    ? Math.min(
        WRITING_SUBAGENT_BUDGET_LIMITS.maxOutputTokens,
        Math.max(1_000, Math.ceil(wordRange.maximum * 1.3 * 1.3)),
      )
    : DEFAULT_WRITING_SUBAGENT_BUDGET.maxOutputTokens;
  if (!Number.isInteger(frozenMaxTokens) || (frozenMaxTokens ?? 0) <= 0) return estimate;
  return Math.min(estimate, frozenMaxTokens as number);
}

export function planWritingSubAgentTurn(
  input: PlanWritingSubAgentTurnInput,
): WritingSubAgentContract {
  const range = resolveChapterWordRange(input.targetWordCount, input.wordRangePercents);
  const wordRange = range
    ? { target: range.target, minimum: range.hardMinimum, maximum: range.hardMaximum }
    : undefined;
  const expectedTool: WritingSubAgentCandidateTool =
    input.mode === 'polish' ? 'polish_chapter' : 'generate_chapter';
  const frozenMaxTokens = input.modelSnapshot.options?.maxTokens;
  const requested: WritingSubAgentBudget = {
    ...DEFAULT_WRITING_SUBAGENT_BUDGET,
    ...input.budget,
  };
  const budget: WritingSubAgentBudget = {
    ...requested,
    maxCandidateAttempts: Math.min(3, requested.maxCandidateAttempts),
    maxLengthRepairs: Math.min(2, requested.maxLengthRepairs),
    maxIntegrityRepairs: Math.min(2, requested.maxIntegrityRepairs),
    maxWallClockMs: Math.min(8 * 60_000, requested.maxWallClockMs),
    maxOutputTokens: outputTokenBudgetFor(
      wordRange,
      typeof frozenMaxTokens === 'number' ? frozenMaxTokens : undefined,
    ),
  };
  const contract: WritingSubAgentContract = {
    contractVersion: WRITING_SUBAGENT_CONTRACT_VERSION,
    agentId: WRITING_SUBAGENT_ID,
    mode: 'candidate_only',
    formalWrites: 'forbidden',
    adoptionPath: 'review_authorization',
    taskKind: input.mode === 'polish' ? 'chapter_polish' : 'chapter_write',
    novelId: input.novelId,
    chapterId: input.chapterId,
    goal: input.goal,
    expectedTool,
    expectedArtifactType: 'chapter_text',
    requiredReadTools: [...WRITING_SUBAGENT_READ_TOOLS],
    allowedTools: [...WRITING_SUBAGENT_READ_TOOLS, expectedTool],
    wordRange,
    ...(input.revisionSource ? { revisionSource: { ...input.revisionSource } } : {}),
    continuity: input.previousChapter
      ? {
          previousChapterId: input.previousChapter.chapterId,
          sourceHash: input.previousChapter.sourceHash,
        }
      : undefined,
    budget,
    modelSnapshot: input.modelSnapshot,
  };
  assertWritingSubAgentContract(contract);
  return contract;
}

export class WritingSubAgentContractViolation extends Error {
  readonly code = 'WRITING_SUBAGENT_CONTRACT_VIOLATION';

  constructor(readonly violation: string) {
    super(`Writing SubAgent 契约违反：${violation}`);
    this.name = 'WritingSubAgentContractViolation';
  }
}

const FORBIDDEN_TOOL_PATTERN =
  /^(save|adopt|apply|write|delete|update)_|_(save|adopt|apply|write)$/u;

/** 复验契约不变式；违反即抛错，接入方不得吞掉。 */
export function assertWritingSubAgentContract(contract: WritingSubAgentContract): void {
  if (contract.mode !== 'candidate_only')
    throw new WritingSubAgentContractViolation('mode 必须为 candidate_only');
  if (contract.formalWrites !== 'forbidden') {
    throw new WritingSubAgentContractViolation('formalWrites 必须为 forbidden');
  }
  if (contract.adoptionPath !== 'review_authorization') {
    throw new WritingSubAgentContractViolation('采用只能经 ReviewAuthorization');
  }
  if (contract.expectedArtifactType !== 'chapter_text') {
    throw new WritingSubAgentContractViolation('唯一产物类型为 chapter_text');
  }
  if (!contract.chapterId.trim() || !contract.novelId.trim()) {
    throw new WritingSubAgentContractViolation('必须绑定作品与目标章节');
  }
  if (contract.expectedTool !== 'generate_chapter' && contract.expectedTool !== 'polish_chapter') {
    throw new WritingSubAgentContractViolation('候选工具只能是 generate_chapter 或 polish_chapter');
  }
  const expectedKind: WritingSubAgentTaskKind =
    contract.expectedTool === 'polish_chapter' ? 'chapter_polish' : 'chapter_write';
  if (contract.taskKind !== expectedKind) {
    throw new WritingSubAgentContractViolation('taskKind 必须与候选工具一一对应');
  }
  const source = contract.revisionSource;
  if (source) {
    if (
      source.novelId !== contract.novelId ||
      source.chapterId !== contract.chapterId ||
      source.artifactType !== 'chapter_text' ||
      ![source.conversationId, source.cardId, source.artifactId, source.title].every(
        (value) => typeof value === 'string' && value.trim().length > 0,
      ) ||
      !/^[0-9a-f]{64}$/u.test(source.artifactHash) ||
      (source.runId !== undefined && !source.runId.trim()) ||
      (source.sourceDraftVersion !== undefined &&
        (!Number.isSafeInteger(source.sourceDraftVersion) || source.sourceDraftVersion <= 0))
    ) {
      throw new WritingSubAgentContractViolation('修订必须绑定同作品同章节的精确有效候选身份');
    }
  }
  const expectedAllowed = new Set<string>([...contract.requiredReadTools, contract.expectedTool]);
  const allowed = new Set(contract.allowedTools);
  if (
    allowed.size !== expectedAllowed.size ||
    [...allowed].some((tool) => !expectedAllowed.has(tool))
  ) {
    throw new WritingSubAgentContractViolation('allowedTools 必须恰好等于只读工具加一个候选工具');
  }
  for (const tool of allowed) {
    if (tool !== contract.expectedTool && tool.startsWith('generate_')) {
      throw new WritingSubAgentContractViolation(`不得暴露其他候选工具：${tool}`);
    }
    if (FORBIDDEN_TOOL_PATTERN.test(tool)) {
      throw new WritingSubAgentContractViolation(`不得暴露正式写入工具：${tool}`);
    }
  }
  const { budget } = contract;
  for (const [key, limit] of Object.entries(WRITING_SUBAGENT_BUDGET_LIMITS) as Array<
    [keyof WritingSubAgentBudget, number]
  >) {
    const value = budget[key];
    if (!Number.isInteger(value) || value <= 0 || value > limit) {
      throw new WritingSubAgentContractViolation(`预算 ${key} 必须是 1..${limit} 的整数`);
    }
  }
  if (contract.wordRange && contract.wordRange.minimum > contract.wordRange.maximum) {
    throw new WritingSubAgentContractViolation('字数区间下限不能大于上限');
  }
  if (
    contract.continuity &&
    (!contract.continuity.previousChapterId.trim() ||
      !/^[0-9a-f]{64}$/iu.test(contract.continuity.sourceHash ?? ''))
  ) {
    throw new WritingSubAgentContractViolation('前章连续性必须是精确章节与全文哈希');
  }
  if (contract.budget.maxIntegrityRepairs > 2 || contract.budget.maxLengthRepairs > 2) {
    throw new WritingSubAgentContractViolation('字数与完整性修复都不能超过宿主回合上限');
  }
}

/** 契约在 DSH start 契约里的投影；Rust `validate_turn_contract` 会逐项复验。 */
export function toDshTaskStartContract(contract: WritingSubAgentContract): {
  taskKind: WritingSubAgentTaskKind;
  expectedTool: WritingSubAgentCandidateTool;
  expectedArtifactType: 'chapter_text';
  requiredReadTools: WritingSubAgentReadTool[];
  allowedTools: string[];
  chapterWordRange?: { target: number; minimum: number; maximum: number };
  revisionSource?: ArtifactRevisionSource;
  continuityClaim?: { previousChapterId: string; sourceHash: string };
} {
  assertWritingSubAgentContract(contract);
  return {
    taskKind: contract.taskKind,
    expectedTool: contract.expectedTool,
    expectedArtifactType: 'chapter_text',
    requiredReadTools: [...contract.requiredReadTools],
    allowedTools: [...contract.allowedTools],
    chapterWordRange: contract.wordRange ? { ...contract.wordRange } : undefined,
    ...(contract.revisionSource ? { revisionSource: { ...contract.revisionSource } } : {}),
    ...(contract.continuity?.sourceHash
      ? {
          continuityClaim: {
            previousChapterId: contract.continuity.previousChapterId,
            sourceHash: contract.continuity.sourceHash,
          },
        }
      : {}),
  };
}

function defaultFlagStorage(): Pick<Storage, 'getItem'> | null {
  try {
    const storage = (globalThis as { localStorage?: Pick<Storage, 'getItem'> }).localStorage;
    return storage && typeof storage.getItem === 'function' ? storage : null;
  } catch {
    return null;
  }
}

/**
 * 特性开关（v3.7.0 起默认开放）：
 * - 浏览器模式恒为 false；
 * - `localStorage[WRITING_SUBAGENT_FLAG_KEY]`：`'0'` 显式关闭，`'1'` 显式开启；
 * - 未设置时，桌面端且冻结模型为真实 API 模型（`runtimeMode === 'api'`）默认开启；
 *   mock 与本地模型继续走确定性 Writer（DSH 运行时只接受 API 模型快照）。
 */
export function isWritingSubAgentDshEnabled(input: {
  isTauri: boolean;
  storage?: Pick<Storage, 'getItem'> | null;
  modelRuntimeMode?: TaskModelSnapshot['runtimeMode'];
}): boolean {
  if (!input.isTauri) return false;
  const storage = input.storage === undefined ? defaultFlagStorage() : input.storage;
  let flag: string | null = null;
  if (storage) {
    try {
      flag = storage.getItem(WRITING_SUBAGENT_FLAG_KEY);
    } catch {
      flag = null;
    }
  }
  if (flag === '0') return false;
  if (flag === '1') return true;
  return input.modelRuntimeMode === 'api';
}
