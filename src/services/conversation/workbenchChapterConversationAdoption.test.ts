import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChapterDraft, CreateChapterDraftInput } from '../../types/ai';
import type { ConversationArtifactCard, ReviewAuthorization } from '../../types/conversation';
import type { ResultArtifactBundle } from '../../types/result-artifact';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import type { AdoptReviewAuthorizedDraftInput } from './artifactDecisionService';
import { adoptWorkbenchChapterCandidateFromConversation } from './workbenchChapterConversationAdoption';

const CONTENT = '第一章\n\n雨夜里，门铃响了三次。';

async function fixture() {
  const contentHash = await computeContentSha256(CONTENT);
  const card: ConversationArtifactCard = {
    cardId: 'card-chapter-1',
    conversationId: 'conversation-1',
    artifactId: 'artifact-chapter-1',
    artifactType: 'chapter_text',
    title: '第一章候选',
    summary: '章节候选',
    status: 'candidate',
    createdAt: '2026-08-31T00:00:00.000Z',
    artifactEvidence: {
      sourceNovelId: 'novel-1',
      sourceChapterId: 'chapter-1',
      processingStatus: 'valid',
      validationIssues: [],
    },
  };
  const artifact: ResultArtifactBundle = {
    artifact: {
      artifactId: 'artifact-chapter-1',
      taskId: 'task-1',
      attemptId: 'attempt-1',
      sourceInputSnapshotId: 'snapshot-1',
      artifactType: 'chapter_text',
      schemaVersion: 1,
      rawContentRefId: 'raw-1',
      sourceNovelId: 'novel-1',
      sourceChapterId: 'chapter-1',
      contentHash,
      contentLength: Array.from(CONTENT).length,
      processingStatus: 'valid',
      createdAt: '2026-08-31T00:00:00.000Z',
    },
    rawContent: CONTENT,
    issues: [],
  };
  const authorization: ReviewAuthorization = {
    authorizationId: 'review-1',
    artifactId: 'artifact-chapter-1',
    chapterId: 'chapter-1',
    novelId: 'novel-1',
    decisionId: 'decision-1',
    status: 'issued',
    issuedAt: '2026-08-31T00:00:01.000Z',
  };
  const draft: ChapterDraft = {
    id: 'draft-1',
    novelId: 'novel-1',
    chapterId: 'chapter-1',
    content: CONTENT,
    source: 'ai_generated',
    versionNo: 1,
    wordCount: 12,
    isAdopted: false,
    createdAt: '2026-08-31T00:00:02.000Z',
    updatedAt: '2026-08-31T00:00:02.000Z',
  };
  return { artifact, authorization, card, draft };
}

test('explicit conversation adoption retains decision, draft, and atomic authorization gates', async () => {
  const { artifact, authorization, card, draft } = await fixture();
  const calls: string[] = [];
  let draftInput: CreateChapterDraftInput | undefined;
  let adoptInput: AdoptReviewAuthorizedDraftInput | undefined;

  const result = await adoptWorkbenchChapterCandidateFromConversation(
    {
      conversationId: 'conversation-1',
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      artifact: card,
    },
    {
      async getArtifact() {
        calls.push('artifact');
        return artifact;
      },
      async recordDecision(input) {
        calls.push('decision');
        assert.equal(input.decision, 'confirm');
        assert.equal(input.targetType, 'chapter');
        return {
          decision: {
            decisionId: 'decision-1',
            artifactId: 'artifact-chapter-1',
            artifactHash: artifact.artifact.contentHash,
            cardId: 'card-chapter-1',
            conversationId: 'conversation-1',
            decision: 'confirm',
            idempotencyKey: 'card-chapter-1:confirm',
            actor: 'user',
            targetType: 'chapter',
            targetId: 'chapter-1',
            createdAt: '2026-08-31T00:00:01.000Z',
          },
          authorization,
        };
      },
      async createDraft(input) {
        calls.push('draft');
        draftInput = input;
        return draft;
      },
      async adoptDraft(input) {
        calls.push('adopt');
        adoptInput = input;
        return {
          authorization: { ...authorization, status: 'consumed', consumedByDraftId: draft.id },
          adoptedDraft: { ...draft, isAdopted: true },
          summaryFollowUp: {
            status: 'pending_generation',
            nextAction: 'summarize_chapter',
            instruction: '总结本章',
            chapterId: 'chapter-1',
            adoptedDraftId: draft.id,
          },
        };
      },
    },
  );

  assert.deepEqual(calls, ['artifact', 'decision', 'draft', 'adopt']);
  assert.equal(draftInput?.content, CONTENT);
  assert.equal(draftInput?.source, 'ai_generated');
  assert.equal(draftInput?.operationId, 'workbench-dialogue-adopt-review-1');
  assert.equal(draftInput?.aiTaskId, 'task-1');
  assert.equal(adoptInput?.authorizationId, 'review-1');
  assert.equal(adoptInput?.draftId, 'draft-1');
  assert.equal(adoptInput?.expectedContentHash, await computeContentSha256(CONTENT));
  assert.equal(result.decision.decisionId, 'decision-1');
  assert.equal(result.adoption.adoptedDraft.isAdopted, true);
});

test('scope mismatch fails before recording a user decision', async () => {
  const { artifact, card } = await fixture();
  let readCalls = 0;
  let decisionCalls = 0;
  await assert.rejects(
    adoptWorkbenchChapterCandidateFromConversation(
      {
        conversationId: 'conversation-1',
        novelId: 'novel-1',
        chapterId: 'chapter-other',
        artifact: card,
      },
      {
        async getArtifact() {
          readCalls += 1;
          return artifact;
        },
        async recordDecision() {
          decisionCalls += 1;
          throw new Error('must not record');
        },
      },
    ),
    /范围不一致/,
  );
  assert.equal(readCalls, 0);
  assert.equal(decisionCalls, 0);
});

test('content hash mismatch fails before authorization or draft persistence', async () => {
  const { artifact, card } = await fixture();
  artifact.artifact.contentHash = '0'.repeat(64);
  let decisionCalls = 0;
  let draftCalls = 0;
  await assert.rejects(
    adoptWorkbenchChapterCandidateFromConversation(
      {
        conversationId: 'conversation-1',
        novelId: 'novel-1',
        chapterId: 'chapter-1',
        artifact: card,
      },
      {
        async getArtifact() {
          return artifact;
        },
        async recordDecision() {
          decisionCalls += 1;
          throw new Error('must not record');
        },
        async createDraft() {
          draftCalls += 1;
          throw new Error('must not save');
        },
      },
    ),
    /哈希校验失败/,
  );
  assert.equal(decisionCalls, 0);
  assert.equal(draftCalls, 0);
});
