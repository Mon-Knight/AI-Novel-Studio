import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ApplyOutlineCandidateInput,
  OutlineGenerationEvidence,
} from '../../types/outlineGeneration';
const state = vi.hoisted(() => ({ desktop: true, db: vi.fn() }));
vi.mock('../database/db', () => ({ isTauri: () => state.desktop, dbCall: state.db }));
vi.mock('../../utils/contentIntegrity', () => ({
  computeContentSha256: async (body: string) =>
    (await import('node:crypto')).createHash('sha256').update(body).digest('hex'),
}));
import {
  applyNativeOutlineCandidate,
  outlineSourceFromSnapshot,
} from './outlineCandidateApplicationService';
const source: OutlineGenerationEvidence = {
  version: 1,
  novelId: 'novel',
  conversationId: 'task',
  runId: 'run',
  turnId: 'turn',
  cardId: 'card',
  artifactId: 'artifact',
  artifactHash: 'a'.repeat(64),
  request: { kind: 'outline_generate', outlineType: 'master', format: 'editor_text' },
};
const action = {
  kind: 'outline_version' as const,
  outlineType: 'master' as const,
  title: '作者标题',
  content: '作者编辑后的完整大纲',
  saveAsNewVersion: true,
};
function response(input: ApplyOutlineCandidateInput) {
  return {
    receipt: {
      receiptId: 'receipt',
      operationId: input.operationId,
      artifactId: input.source.artifactId,
      artifactHash: input.source.artifactHash,
      baselineBefore: 'b'.repeat(64),
      baselineAfter: 'c'.repeat(64),
      appliedContentHash: 'd'.repeat(64),
      entityType: 'master_outline',
      entityId: 'saved-version',
      authority: 'manual_confirmation',
    },
    decision: {
      decisionId: 'decision',
      artifactId: input.source.artifactId,
      conversationId: input.source.conversationId,
      actor: 'user',
      applyTransactionId: 'receipt',
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  state.desktop = true;
  state.db.mockImplementation(
    async (_command: string, args: { input: ApplyOutlineCandidateInput }) => response(args.input),
  );
});
describe('explicit native outline application', () => {
  it('sends edited body and immutable source to one native transaction, with stable idempotency identity', async () => {
    const first = await applyNativeOutlineCandidate(source, action);
    const second = await applyNativeOutlineCandidate(source, action);
    expect(first.receipt).toEqual(second.receipt);
    expect(state.db).toHaveBeenCalledTimes(2);
    expect(state.db.mock.calls[0][0]).toBe('apply_outline_candidate');
    expect(state.db.mock.calls[0][1]).toEqual(state.db.mock.calls[1][1]);
    expect(state.db.mock.calls[0][1].input).toEqual(expect.objectContaining({ source, action }));
    expect(state.db.mock.calls[0][1].input.operationId).toMatch(/^outline:artifact:[a-f0-9]{64}$/);
    expect(JSON.stringify(state.db.mock.calls[0][1])).not.toContain('authorReviewed');
  });
  it('keeps saving and explicit adoption different, including displayed active-version CAS', async () => {
    const adoption = {
      kind: 'adopt_outline_version' as const,
      outlineType: 'master' as const,
      outlineId: 'saved',
      expectedVersion: 3,
      expectedContentHash: 'd'.repeat(64),
      expectedActive: { id: 'current', version: 2, contentHash: 'e'.repeat(64) },
    };
    await applyNativeOutlineCandidate(source, adoption);
    expect(state.db.mock.calls[0][1].input.action).toEqual(adoption);
    expect(state.db.mock.calls[0][1].input.action).not.toHaveProperty('saveAsNewVersion');
  });
  it('fails closed on missing or cross-scope receipts and never retries a failed application as generation', async () => {
    state.db.mockImplementationOnce(
      async (_command: string, args: { input: ApplyOutlineCandidateInput }) => ({
        ...response(args.input),
        receipt: { ...response(args.input).receipt, artifactId: 'foreign' },
      }),
    );
    await expect(applyNativeOutlineCandidate(source, action)).rejects.toThrow('RECEIPT_INVALID');
    expect(state.db).toHaveBeenCalledOnce();
    state.db.mockRejectedValueOnce(new Error('OUTLINE_BASELINE_CONFLICT'));
    await expect(applyNativeOutlineCandidate(source, action)).rejects.toThrow(
      'OUTLINE_BASELINE_CONFLICT',
    );
    expect(state.db).toHaveBeenCalledTimes(2);
  });
  it('does not execute native formal writes in browser compatibility', async () => {
    state.desktop = false;
    await expect(applyNativeOutlineCandidate(source, action)).rejects.toThrow('浏览器开发兼容');
    expect(state.db).not.toHaveBeenCalled();
  });
  it('restores known native provenance but never turns legacy context into authorization', () => {
    expect(outlineSourceFromSnapshot(undefined)).toBeNull();
    expect(outlineSourceFromSnapshot('{"novelTitle":"历史手工上下文"}')).toBeNull();
    expect(
      outlineSourceFromSnapshot(
        JSON.stringify({ schemaVersion: 'outline_candidate_application_v1', source }),
      ),
    ).toEqual(source);
    expect(() =>
      outlineSourceFromSnapshot('{"schemaVersion":"outline_candidate_application_v1","source":{}}'),
    ).toThrow('SOURCE_INVALID');
    expect(() =>
      outlineSourceFromSnapshot(
        JSON.stringify({
          schemaVersion: 'outline_candidate_application_v1',
          source: { ...source, artifactId: '', request: {} },
        }),
      ),
    ).toThrow('SOURCE_INVALID');
  });
});
