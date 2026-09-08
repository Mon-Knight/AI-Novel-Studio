import { describe, expect, it } from 'vitest';
import type { TaskModelSnapshot } from '../../types/conversation';
import {
  assertWritingSubAgentContract,
  DEFAULT_WRITING_SUBAGENT_BUDGET,
  isWritingSubAgentDshEnabled,
  outputTokenBudgetFor,
  planWritingSubAgentTurn,
  toDshTaskStartContract,
  WRITING_SUBAGENT_BUDGET_LIMITS,
  WRITING_SUBAGENT_FLAG_KEY,
  WRITING_SUBAGENT_READ_TOOLS,
  WritingSubAgentContractViolation,
} from './writingSubAgentContract';

const snapshot: TaskModelSnapshot = {
  providerId: 'mock',
  modelId: 'mock-writer',
  runtimeMode: 'mock',
  capabilities: [],
  options: {},
  capturedAt: '2026-09-08T00:00:00Z',
};

function plan(overrides: Partial<Parameters<typeof planWritingSubAgentTurn>[0]> = {}) {
  return planWritingSubAgentTurn({
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    goal: '写第一章',
    mode: 'generate',
    modelSnapshot: snapshot,
    targetWordCount: 3000,
    ...overrides,
  });
}

describe('writingSubAgentContract', () => {
  it('plans a candidate-only chapter turn bound to one chapter with read tools plus one candidate tool', () => {
    const contract = plan({ previousChapter: { chapterId: 'chapter-0', sourceHash: 'abc' } });
    expect(contract.mode).toBe('candidate_only');
    expect(contract.formalWrites).toBe('forbidden');
    expect(contract.adoptionPath).toBe('review_authorization');
    expect(contract.taskKind).toBe('chapter_write');
    expect(contract.expectedTool).toBe('generate_chapter');
    expect(contract.expectedArtifactType).toBe('chapter_text');
    expect(contract.requiredReadTools).toEqual([...WRITING_SUBAGENT_READ_TOOLS]);
    expect(contract.allowedTools).toEqual([...WRITING_SUBAGENT_READ_TOOLS, 'generate_chapter']);
    expect(contract.wordRange).toEqual({ target: 3000, minimum: 2400, maximum: 3450 });
    expect(contract.continuity).toEqual({ previousChapterId: 'chapter-0', sourceHash: 'abc' });
    expect(contract.budget.maxOutputTokens).toBe(outputTokenBudgetFor(contract.wordRange));
    expect(contract.modelSnapshot).toBe(snapshot);
  });

  it('projects the contract onto the DSH start contract that Rust re-validates', () => {
    const contract = plan();
    expect(toDshTaskStartContract(contract)).toEqual({
      taskKind: 'chapter_write',
      expectedTool: 'generate_chapter',
      expectedArtifactType: 'chapter_text',
      requiredReadTools: [...WRITING_SUBAGENT_READ_TOOLS],
      allowedTools: [...WRITING_SUBAGENT_READ_TOOLS, 'generate_chapter'],
      chapterWordRange: { target: 3000, minimum: 2400, maximum: 3450 },
    });
    const polish = plan({ mode: 'polish', targetWordCount: undefined });
    expect(toDshTaskStartContract(polish).taskKind).toBe('chapter_polish');
    expect(toDshTaskStartContract(polish).chapterWordRange).toBeUndefined();
  });

  it('switches to polish_chapter for polish mode and keeps every other invariant', () => {
    const contract = plan({ mode: 'polish', targetWordCount: undefined });
    expect(contract.taskKind).toBe('chapter_polish');
    expect(contract.expectedTool).toBe('polish_chapter');
    expect(contract.allowedTools).toEqual([...WRITING_SUBAGENT_READ_TOOLS, 'polish_chapter']);
    expect(contract.wordRange).toBeUndefined();
    expect(contract.budget.maxOutputTokens).toBe(DEFAULT_WRITING_SUBAGENT_BUDGET.maxOutputTokens);
  });

  it('derives an output token budget from the word range and clamps it to the limit', () => {
    expect(outputTokenBudgetFor(undefined)).toBe(DEFAULT_WRITING_SUBAGENT_BUDGET.maxOutputTokens);
    expect(outputTokenBudgetFor({ maximum: 100 })).toBe(1_000);
    expect(outputTokenBudgetFor({ maximum: 3450 })).toBe(Math.ceil(3450 * 1.3 * 1.3));
    expect(outputTokenBudgetFor({ maximum: 100_000 })).toBe(
      WRITING_SUBAGENT_BUDGET_LIMITS.maxOutputTokens,
    );
  });

  it('rejects any attempt to widen the tool surface or escape candidate-only mode', () => {
    const contract = plan();
    const violations: Array<[string, (mutable: typeof contract) => void]> = [
      ['other generate tool', (c) => (c.allowedTools = [...c.allowedTools, 'generate_outline'])],
      ['formal write tool', (c) => (c.allowedTools = [...c.allowedTools, 'save_chapter'])],
      ['missing candidate tool', (c) => (c.allowedTools = [...WRITING_SUBAGENT_READ_TOOLS])],
      ['non-candidate mode', (c) => ((c as { mode: string }).mode = 'apply')],
      ['formal writes allowed', (c) => ((c as { formalWrites: string }).formalWrites = 'allowed')],
      [
        'wrong artifact',
        (c) => ((c as { expectedArtifactType: string }).expectedArtifactType = 'outline'),
      ],
      [
        'task kind / tool mismatch',
        (c) => ((c as { taskKind: string }).taskKind = 'chapter_polish'),
      ],
      ['unbound chapter', (c) => (c.chapterId = ' ')],
      ['budget over limit', (c) => (c.budget = { ...c.budget, maxCandidateAttempts: 99 })],
      ['budget zero', (c) => (c.budget = { ...c.budget, maxWallClockMs: 0 })],
      ['inverted range', (c) => (c.wordRange = { target: 10, minimum: 20, maximum: 10 })],
    ];
    for (const [label, mutate] of violations) {
      const copy = structuredClone(contract);
      mutate(copy);
      expect(() => assertWritingSubAgentContract(copy), label).toThrow(
        WritingSubAgentContractViolation,
      );
    }
    expect(() => plan({ budget: { maxLengthRepairs: 0 } })).toThrow(
      WritingSubAgentContractViolation,
    );
  });

  it('opens the DSH writing path for desktop API models by default and honours explicit overrides', () => {
    const storage = new Map<string, string>();
    const adapter = { getItem: (key: string) => storage.get(key) ?? null };
    const desktop = (
      modelRuntimeMode?: 'api' | 'mock',
      flagStorage: Pick<Storage, 'getItem'> | null = adapter,
    ) => isWritingSubAgentDshEnabled({ isTauri: true, storage: flagStorage, modelRuntimeMode });

    // Default (no flag): only a real API model snapshot enables the SubAgent.
    expect(desktop('api')).toBe(true);
    expect(desktop('mock')).toBe(false);
    expect(desktop(undefined)).toBe(false);
    // Browser mode never runs the DSH path, whatever the flag says.
    storage.set(WRITING_SUBAGENT_FLAG_KEY, '1');
    expect(
      isWritingSubAgentDshEnabled({ isTauri: false, storage: adapter, modelRuntimeMode: 'api' }),
    ).toBe(false);
    // Explicit '1' forces on (used by the opt-in acceptance carriers); explicit '0' forces off.
    expect(desktop('mock')).toBe(true);
    storage.set(WRITING_SUBAGENT_FLAG_KEY, '0');
    expect(desktop('api')).toBe(false);
    // Missing or throwing storage falls back to the runtime-mode default.
    expect(desktop('api', null)).toBe(true);
    expect(desktop('mock', null)).toBe(false);
    expect(
      desktop('api', {
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toBe(true);
  });
});
