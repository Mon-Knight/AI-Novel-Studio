import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import type { ResultArtifactBundle } from '../../types/result-artifact';
import type { ChapterDraft } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type { ReviewAuthorization } from '../../types/conversation';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { volumeRepository } from '../database/volumeRepository';
import { artifactDecisionService } from './artifactDecisionService';
import { taskConversationService } from './taskConversationService';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

function artifactBundle(
  artifactType: ResultArtifactBundle['artifact']['artifactType'],
): ResultArtifactBundle {
  return {
    artifact: {
      artifactId: 'artifact-1',
      taskId: 'task-1',
      attemptId: 'attempt-1',
      sourceInputSnapshotId: 'snapshot-1',
      artifactType,
      schemaVersion: 1,
      rawContentRefId: 'raw-1',
      sourceNovelId: 'novel-1',
      sourceChapterId: artifactType === 'event_candidates' ? 'chapter-1' : undefined,
      sourceDraftId: artifactType === 'event_candidates' ? 'draft-1' : undefined,
      sourceDraftVersion: artifactType === 'event_candidates' ? 7 : undefined,
      sourceBaseContentHash: artifactType === 'event_candidates' ? 'trusted-base-hash' : undefined,
      contentHash: 'trusted-artifact-hash',
      contentLength: 42,
      processingStatus: 'valid',
      createdAt: '2026-08-28T00:00:00Z',
    },
    rawContent: '{}',
    issues: [],
  };
}

function contextCompressionPayload() {
  const compressedText = '作品上下文压缩结果';
  const emptyBucket = { required: [], present: [], missing: [] };
  return {
    providerId: 'ans.novel-context.extractive-v1' as const,
    version: '1.1.0' as const,
    config: { tokenBudget: 4000 },
    novelId: 'novel-1',
    sourceRevision: 'rev-1234abcd-42',
    compressedText,
    coverage: {
      characters: emptyBucket,
      plot: emptyBucket,
      foreshadow: emptyBucket,
      timeline: emptyBucket,
      world: emptyBucket,
      rules: emptyBucket,
      outlines: emptyBucket,
      style: emptyBucket,
      output: emptyBucket,
      tokens: { budget: 4000, used: [...compressedText].length, withinBudget: true },
    },
    valid: true,
  };
}

function setDesktopRuntime(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: globalThis,
  });
}

function setBrowserRuntime(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });
}

function chapter(id: string, orderIndex: number): Chapter {
  return {
    id,
    novelId: 'novel-review',
    title: `第 ${orderIndex + 1} 章`,
    chapterNumber: orderIndex + 1,
    orderIndex,
    sortOrder: orderIndex,
    status: 'draft_generated',
    wordCount: 0,
    currentWords: 0,
    targetWords: 3_000,
    drafts: [],
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
  };
}

function draft(input: {
  id: string;
  chapterId: string;
  content: string;
  isAdopted?: boolean;
}): ChapterDraft {
  return {
    id: input.id,
    novelId: 'novel-review',
    chapterId: input.chapterId,
    content: input.content,
    source: 'ai_generated',
    versionNo: 1,
    wordCount: Array.from(input.content).length,
    isAdopted: input.isAdopted ?? false,
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
  };
}

const previousChapterText = [
  '沈砚走进档案馆，楼梯口的封条仍然完好。',
  '现场人员从楼梯口走来，手里多了一只黑色物证袋。',
  '它是被门缝夹过，或者擦过门框。',
  '如果你们不查现场记录，那就不能排除删改。',
  '十点前带证件到市局，把录音副本交给专案组。',
  '林致远把登记表收回去，十二点后地下资料室将正式封闭。',
  '沈砚没有再看楼梯口，他把相机收进包里。',
  '他沿走廊逐项核对照片和通话时间，并将新发现分开保存。'.repeat(12),
  '他在门外拍下盐痕，随后发现凌晨的通话录音被远程删除。',
  '章末时，封闭的门内传来了缓慢转动锁芯的声音。',
].join('\n');

async function withBrowserReviewAdoptionFixture(
  candidateText: string,
  run: (fixture: {
    input: {
      authorizationId: string;
      draftId: string;
      expectedDraftVersion: number;
      expectedContentHash: string;
    };
    authorization: ReviewAuthorization;
    calls: { adopt: number; consume: number };
  }) => Promise<void>,
): Promise<void> {
  setBrowserRuntime();
  const authorization: ReviewAuthorization = {
    authorizationId: 'review-integrity',
    artifactId: 'artifact-integrity',
    chapterId: 'chapter-current',
    novelId: 'novel-review',
    decisionId: 'decision-integrity',
    status: 'issued',
    issuedAt: '2026-08-29T00:00:00.000Z',
  };
  const currentDraft = draft({
    id: 'draft-current',
    chapterId: 'chapter-current',
    content: candidateText,
  });
  const previousDraft = draft({
    id: 'draft-previous',
    chapterId: 'chapter-previous',
    content: previousChapterText,
    isAdopted: true,
  });
  const calls = { adopt: 0, consume: 0 };
  const originals = {
    getAuthorization: artifactDecisionService.getAuthorization,
    getDraftById: draftVersionService.getById,
    getAdoptedDraft: draftVersionService.getAdoptedByChapterId,
    adoptDraft: draftVersionService.adopt,
    getChapters: chapterRepository.getByNovelId,
    getVolumes: volumeRepository.getByNovelId,
    completeAdoption: taskConversationService.completeBrowserReviewAdoption,
  };

  artifactDecisionService.getAuthorization = async (authorizationId) =>
    authorizationId === authorization.authorizationId ? authorization : null;
  draftVersionService.getById = async (chapterId, draftId) =>
    chapterId === currentDraft.chapterId && draftId === currentDraft.id ? currentDraft : null;
  draftVersionService.getAdoptedByChapterId = async (chapterId) =>
    chapterId === previousDraft.chapterId ? previousDraft : null;
  chapterRepository.getByNovelId = async () => [
    chapter('chapter-previous', 0),
    chapter('chapter-current', 1),
  ];
  volumeRepository.getByNovelId = async () => [];
  draftVersionService.adopt = async (draftId, chapterId) => {
    calls.adopt += 1;
    assert.equal(draftId, currentDraft.id);
    assert.equal(chapterId, currentDraft.chapterId);
    return { ...currentDraft, isAdopted: true };
  };
  taskConversationService.completeBrowserReviewAdoption = async (authorizationId, draftId) => {
    calls.consume += 1;
    return {
      ...authorization,
      status: 'consumed',
      consumedAt: '2026-08-29T00:01:00.000Z',
      consumedByDraftId: draftId,
      authorizationId,
    };
  };

  try {
    await run({
      input: {
        authorizationId: authorization.authorizationId,
        draftId: currentDraft.id,
        expectedDraftVersion: currentDraft.versionNo,
        expectedContentHash: await computeContentSha256(currentDraft.content),
      },
      authorization,
      calls,
    });
  } finally {
    artifactDecisionService.getAuthorization = originals.getAuthorization;
    draftVersionService.getById = originals.getDraftById;
    draftVersionService.getAdoptedByChapterId = originals.getAdoptedDraft;
    draftVersionService.adopt = originals.adoptDraft;
    chapterRepository.getByNovelId = originals.getChapters;
    volumeRepository.getByNovelId = originals.getVolumes;
    taskConversationService.completeBrowserReviewAdoption = originals.completeAdoption;
  }
}

afterEach(() => {
  clearMocks();
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('desktop structured apply sends persisted artifact identity to the atomic Rust command', async () => {
  setDesktopRuntime();
  let commandInput: Record<string, unknown> | undefined;
  mockIPC((command, args) => {
    if (command === 'get_result_artifact') return artifactBundle('event_candidates');
    if (command === 'apply_structured_artifact') {
      commandInput = (args as { input: Record<string, unknown> }).input;
      return {
        decisionId: 'decision-persisted',
        artifactId: 'artifact-1',
        artifactHash: 'trusted-artifact-hash',
        cardId: 'card-1',
        conversationId: 'conversation-1',
        decision: 'request_apply',
        idempotencyKey: 'card-1:request_apply:atomic-v1',
        actor: 'user',
        targetType: 'asset',
        targetId: 'chapter-1',
        baseRevision: 'trusted-base-hash',
        applyTransactionId: 'apply-1',
        createdAt: '2026-08-28T00:00:00Z',
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  const result = await artifactDecisionService.applyStructured({
    conversationId: 'conversation-1',
    cardId: 'card-1',
    artifactId: 'artifact-1',
    decision: 'request_apply',
    targetType: 'asset',
    targetId: 'chapter-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    baseRevision: 'client-forged-base',
  });

  assert.equal(result.decision.applyTransactionId, 'apply-1');
  assert.equal(commandInput?.artifactHash, 'trusted-artifact-hash');
  assert.equal(commandInput?.baseRevision, 'trusted-base-hash');
  assert.equal(commandInput?.novelId, 'novel-1');
  assert.equal(commandInput?.chapterId, 'chapter-1');
  assert.equal(commandInput?.targetId, 'chapter-1');
  assert.equal(commandInput?.idempotencyKey, 'card-1:request_apply:atomic-v1');
});

test('desktop reports and unsupported structured artifacts never invoke the apply command', async () => {
  setDesktopRuntime();
  let bundle = artifactBundle('quality_report');
  let applyCalls = 0;
  mockIPC((command) => {
    if (command === 'get_result_artifact') return bundle;
    if (command === 'apply_structured_artifact') applyCalls += 1;
    return undefined;
  });
  const input = {
    conversationId: 'conversation-1',
    cardId: 'card-1',
    artifactId: 'artifact-1',
    decision: 'request_apply' as const,
    targetType: 'asset',
    targetId: 'novel-1',
    novelId: 'novel-1',
  };

  await assert.rejects(artifactDecisionService.applyStructured(input), /报告不能应用/);
  bundle = artifactBundle('generic_json');
  await assert.rejects(artifactDecisionService.applyStructured(input), /不支持原子应用/);
  assert.equal(applyCalls, 0);
});

test('desktop routes the recognized context compression payload to atomic Rust apply', async () => {
  setDesktopRuntime();
  const bundle = artifactBundle('generic_json');
  bundle.structuredPayloadJson = contextCompressionPayload();
  let commandInput: Record<string, unknown> | undefined;
  mockIPC((command, args) => {
    if (command === 'get_result_artifact') return bundle;
    if (command === 'apply_structured_artifact') {
      commandInput = (args as { input: Record<string, unknown> }).input;
      return {
        decisionId: 'decision-compression',
        artifactId: bundle.artifact.artifactId,
        artifactHash: bundle.artifact.contentHash,
        cardId: 'card-compression',
        conversationId: 'conversation-compression',
        decision: 'request_apply',
        idempotencyKey: 'card-compression:request_apply:atomic-v1',
        actor: 'user',
        targetType: 'asset',
        targetId: 'novel-1',
        applyTransactionId: 'apply-compression',
        createdAt: '2026-08-28T00:00:00Z',
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  const result = await artifactDecisionService.applyStructured({
    conversationId: 'conversation-compression',
    cardId: 'card-compression',
    artifactId: bundle.artifact.artifactId,
    decision: 'request_apply',
    targetType: 'asset',
    targetId: 'novel-1',
    novelId: 'novel-1',
  });

  assert.equal(result.decision.applyTransactionId, 'apply-compression');
  assert.equal(commandInput?.novelId, 'novel-1');
  assert.equal(commandInput?.chapterId, undefined);
  assert.equal(commandInput?.targetId, 'novel-1');
});

test('browser structured apply records a stable unsupported decision without domain writes', async () => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {},
  });
  const originalRecord = artifactDecisionService.record;
  let recordedConflict: string | undefined;
  artifactDecisionService.record = async (input) => {
    recordedConflict = input.conflictCode;
    return {
      decision: {
        decisionId: 'decision-browser',
        artifactId: input.artifactId,
        artifactHash: 'browser-hash',
        cardId: input.cardId,
        conversationId: input.conversationId,
        decision: 'request_apply',
        idempotencyKey: `${input.cardId}:request_apply`,
        actor: 'user',
        targetType: input.targetType,
        targetId: input.targetId,
        conflictCode: input.conflictCode,
        createdAt: '2026-08-28T00:00:00Z',
      },
    };
  };
  try {
    const result = await artifactDecisionService.applyStructured({
      conversationId: 'conversation-browser',
      cardId: 'card-browser',
      artifactId: 'artifact-browser',
      decision: 'request_apply',
      targetType: 'asset',
      targetId: 'novel-1',
      novelId: 'novel-1',
    });
    assert.equal(recordedConflict, 'BROWSER_APPLY_UNSUPPORTED');
    assert.equal(result.decision.conflictCode, 'BROWSER_APPLY_UNSUPPORTED');
  } finally {
    artifactDecisionService.record = originalRecord;
  }
});

test('AI review adoption accepts a clean final editor draft and consumes authorization afterward', async () => {
  await withBrowserReviewAdoptionFixture(
    '锁芯在门内停下。沈砚确认走廊仍然安全，随后带着录音副本前往市局。',
    async ({ input, calls }) => {
      const result = await artifactDecisionService.adoptReviewAuthorizedDraft(input);

      assert.equal(result.adoptedDraft.isAdopted, true);
      assert.equal(result.authorization.status, 'consumed');
      assert.deepEqual(calls, { adopt: 1, consume: 1 });
    },
  );
});

test('AI review adoption fails closed on a polluted tail before adopting or consuming authorization', async () => {
  await withBrowserReviewAdoptionFixture(
    '沈砚停在门前，确认锁芯没有再动。经典三级',
    async ({ input, authorization, calls }) => {
      await assert.rejects(
        artifactDecisionService.adoptReviewAuthorizedDraft(input),
        (error: unknown) => {
          const integrityError = error as Error & { code?: string };
          assert.equal(integrityError.code, 'WORKBENCH_CHAPTER_INTEGRITY_FAILED');
          assert.match(integrityError.message, /chapter_tail_pollution/);
          return true;
        },
      );
      assert.equal(authorization.status, 'issued');
      assert.deepEqual(calls, { adopt: 0, consume: 0 });
    },
  );
});

test('AI review adoption rejects model meta reasoning before any side effect', async () => {
  const leakedCandidate = [
    '父亲的薄册里，被刮去的也是六时四十分。',
    'Wait. Need continue and remove the newly invented clue.',
    "Let's revise the final paragraphs and preserve the chapter constraints.",
    "Let's craft final prose around the target word count.",
  ].join('\n');

  await withBrowserReviewAdoptionFixture(
    leakedCandidate,
    async ({ input, authorization, calls }) => {
      await assert.rejects(
        artifactDecisionService.adoptReviewAuthorizedDraft(input),
        (error: unknown) => {
          const integrityError = error as Error & { code?: string };
          assert.equal(integrityError.code, 'WORKBENCH_CHAPTER_INTEGRITY_FAILED');
          assert.match(integrityError.message, /chapter_meta_reasoning_leakage/);
          assert.doesNotMatch(integrityError.message, /newly invented clue/);
          return true;
        },
      );
      assert.equal(authorization.status, 'issued');
      assert.deepEqual(calls, { adopt: 0, consume: 0 });
    },
  );
});

test('AI review adoption fails closed on an approximate opening rollback before side effects', async () => {
  const rollbackCandidate = [
    '我只是在判断它是不是被门夹过。',
    '林致远看了他一眼，把物证袋交给现场人员，随后侧身让开通道。',
    '十点以前，市局专案组。别再到现场附近拍东西。',
    '如果你们不把现场记录给我看呢？',
    '那就等正式程序。十二点以后，资料室还在吗？',
  ].join('\n');

  await withBrowserReviewAdoptionFixture(
    rollbackCandidate,
    async ({ input, authorization, calls }) => {
      await assert.rejects(
        artifactDecisionService.adoptReviewAuthorizedDraft(input),
        (error: unknown) => {
          const integrityError = error as Error & { code?: string };
          assert.equal(integrityError.code, 'WORKBENCH_CHAPTER_INTEGRITY_FAILED');
          assert.match(integrityError.message, /chapter_opening_rollback/);
          return true;
        },
      );
      assert.equal(authorization.status, 'issued');
      assert.deepEqual(calls, { adopt: 0, consume: 0 });
    },
  );
});
