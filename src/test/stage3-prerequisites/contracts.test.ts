import { describe, expect, it } from 'vitest';
import {
  assertDirectorDecisionAllowed,
  buildInitializationCandidateBundle,
  compileStage3PrerequisiteSnapshots,
  createDirectorDecisionAudit,
  createDirectorGovernance,
  decideInitializationCandidates,
  freezeCreativeIntent,
} from '../../services/ai-tasks/stage3PrerequisiteService';

const authorEvidence = [{
  evidenceId: 'evidence-author-1',
  sourceType: 'author_input' as const,
  excerpt: '作者明确要求东方奇幻与克制感情线',
}];

async function frozenIntent() {
  return freezeCreativeIntent({
    intentId: 'intent-1',
    novelId: 'novel-1',
    revision: 1,
    createdAt: '2026-07-13T00:00:00.000Z',
    statements: [
      {
        statementId: 'statement-fact',
        kind: 'fact',
        knowledgeClass: 'author_explicit',
        value: '东方奇幻',
        confidence: 1,
        evidence: authorEvidence,
        confirmation: {
          status: 'confirmed',
          confirmedBy: 'author',
          confirmedAt: '2026-07-13T00:00:00.000Z',
        },
      },
      {
        statementId: 'statement-preference',
        kind: 'preference',
        knowledgeClass: 'inferred_preference',
        value: '偏好克制感情线',
        confidence: 0.72,
        evidence: authorEvidence,
        confirmation: { status: 'pending' },
      },
      {
        statementId: 'statement-question',
        kind: 'constraint',
        knowledgeClass: 'requires_confirmation',
        value: '是否允许主角失败结局',
        confidence: 0.4,
        evidence: authorEvidence,
        confirmation: { status: 'pending' },
      },
    ],
  });
}

describe('stage 3 prerequisite contracts', () => {
  it('freezes and versions explicit, inferred and pending creative intent separately', async () => {
    const intent = await frozenIntent();
    expect(intent.schemaVersion).toBe(1);
    expect(intent.status).toBe('frozen');
    expect(intent.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(intent.statements.map((item) => item.knowledgeClass)).toEqual([
      'author_explicit',
      'inferred_preference',
      'requires_confirmation',
    ]);
    expect(intent.statements[1].confirmation.status).toBe('pending');
    expect(intent.statements.every((item) => /^[a-f0-9]{64}$/.test(item.statementHash))).toBe(true);
  });

  it('never allows inferred content to masquerade as author confirmation', async () => {
    await expect(freezeCreativeIntent({
      novelId: 'novel-1',
      revision: 1,
      statements: [{
        statementId: 'inferred',
        kind: 'preference',
        knowledgeClass: 'inferred_preference',
        value: '暗黑风格',
        confidence: 0.6,
        evidence: authorEvidence,
        confirmation: { status: 'confirmed', confirmedAt: '2026-07-13T00:00:00.000Z' },
      }],
    })).rejects.toThrow('作者显式确认');
  });

  it('requires evidence, expected hashes and conflict acknowledgement for per-item confirmation', async () => {
    const intent = await frozenIntent();
    const bundle = await buildInitializationCandidateBundle({
      bundleId: 'bundle-1',
      novelId: 'novel-1',
      revision: 1,
      createdAt: '2026-07-13T00:00:00.000Z',
      intent: { intentId: intent.intentId, revision: intent.revision, contentHash: intent.contentHash },
      items: [{
        candidateId: 'world-1',
        targetType: 'world_setting',
        proposedValue: { title: '天空城', content: '浮空城市群' },
        knowledgeClass: 'requires_confirmation',
        confidence: 0.8,
        evidence: authorEvidence,
        explanation: '作者提出了浮空文明意象',
        conflicts: [{
          code: 'POSSIBLE_DUPLICATE',
          severity: 'warning',
          message: '可能与旧设定重叠',
          evidenceRefs: ['evidence-author-1'],
        }],
        conflictAcknowledged: false,
        confirmation: { status: 'pending' },
        dependsOnCandidateIds: [],
      }],
    });
    await expect(decideInitializationCandidates(bundle, bundle.contentHash, [{
      candidateId: 'world-1',
      expectedCandidateHash: bundle.items[0].candidateHash,
      decision: 'confirm',
    }])).rejects.toThrow('冲突尚未确认');

    const decided = await decideInitializationCandidates(bundle, bundle.contentHash, [{
      candidateId: 'world-1',
      expectedCandidateHash: bundle.items[0].candidateHash,
      decision: 'confirm',
      conflictAcknowledged: true,
    }]);
    expect(decided.revision).toBe(2);
    expect(decided.parentBundleId).toBe('bundle-1');
    expect(decided.items[0].confirmation).toMatchObject({ status: 'confirmed', confirmedBy: 'author' });
    expect(decided.items[0].conflictAcknowledged).toBe(true);
    await expect(decideInitializationCandidates(bundle, 'stale-hash', [])).rejects.toThrow('已变化');
  });

  it('persists budget and permissions as existing snapshot payloads and blocks excess authority', async () => {
    const intent = await frozenIntent();
    const governance = await createDirectorGovernance({
      governanceId: 'governance-1',
      novelId: intent.novelId,
      intent: { intentId: intent.intentId, revision: intent.revision, contentHash: intent.contentHash },
      budget: {
        limits: { maxProviderCalls: 3, maxInputTokens: 20_000, maxOutputTokens: 4_000, maxCostUsd: 1, maxDurationMs: 60_000 },
        used: { providerCalls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 },
        onExceeded: 'block',
      },
      permissions: {
        canSubmitTasks: true,
        canReadCanon: true,
        canProposeCanonChanges: true,
        canApplyCanonChanges: false,
        canChangeProviderConfig: false,
        allowedTaskTypes: ['project_initialization'],
        allowedTargetTypes: ['world_setting', 'rule_system', 'character'],
      },
      createdAt: '2026-07-13T00:00:00.000Z',
    });
    expect(() => assertDirectorDecisionAllowed(governance, 'project_initialization', 'character')).not.toThrow();
    expect(() => assertDirectorDecisionAllowed(governance, 'chapter_generate')).toThrow('未获授权');
    const snapshots = compileStage3PrerequisiteSnapshots(intent, governance);
    expect(snapshots.constraintPayload).toMatchObject({ autoApply: false, taskSystem: 'ai_task_dag' });
    expect(snapshots.contextBudget.onExceeded).toBe('block');

    const audit = await createDirectorDecisionAudit({
      decisionId: 'decision-1',
      taskId: 'task-1',
      governanceId: governance.governanceId,
      intent: governance.intent,
      selectedAction: 'propose_project_initialization',
      alternatives: ['ask_more_questions'],
      rationale: '现有证据足以生成候选，但仍需作者逐项确认',
      evidence: authorEvidence,
      requiresUserConfirmation: true,
      outcome: 'proposed',
      createdAt: '2026-07-13T00:00:00.000Z',
    });
    expect(audit.requiresUserConfirmation).toBe(true);
    expect(audit.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

