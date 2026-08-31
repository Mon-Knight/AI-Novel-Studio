import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ArtifactDecision,
  ConversationArtifactCard,
  TaskConversationBundle,
} from '../../types/conversation';
import { executeWorkbenchConversationDecision } from './workbenchConversationDecisionService';

function card(
  artifactId: string,
  artifactType: ConversationArtifactCard['artifactType'],
  sourceChapterId?: string,
): ConversationArtifactCard {
  return {
    cardId: `card-${artifactId}`,
    conversationId: 'conversation-1',
    artifactId,
    artifactType,
    title: artifactId,
    summary: '候选',
    status: 'candidate',
    createdAt: '2026-08-31T00:00:00.000Z',
    artifactEvidence: {
      sourceNovelId: 'novel-1',
      sourceChapterId,
      processingStatus: 'valid',
      validationIssues: [],
    },
  };
}

function bundle(artifacts: ConversationArtifactCard[]): TaskConversationBundle {
  return {
    conversation: {
      conversationId: 'conversation-1',
      novelId: 'novel-1',
      title: '任务',
      status: 'waiting_user',
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    },
    turns: [],
    runs: [],
    toolEvents: [],
    artifacts,
    decisions: [],
    authorizations: [],
  };
}

function decision(
  artifact: ConversationArtifactCard,
  kind: ArtifactDecision['decision'],
  applyTransactionId?: string,
): ArtifactDecision {
  return {
    decisionId: `decision-${artifact.artifactId}`,
    artifactId: artifact.artifactId!,
    artifactHash: 'a'.repeat(64),
    cardId: artifact.cardId,
    conversationId: artifact.conversationId,
    decision: kind,
    idempotencyKey: `${artifact.cardId}:${kind}`,
    actor: 'user',
    targetType: artifact.artifactType === 'chapter_text' ? 'chapter' : 'asset',
    targetId: artifact.artifactEvidence?.sourceChapterId ?? 'novel-1',
    applyTransactionId,
    createdAt: '2026-08-31T00:00:01.000Z',
  };
}

test('applies only the exact pending asset through the structured transaction', async () => {
  const pending = card('asset-1', 'setting_candidates');
  const unrelated = card('asset-2', 'character_candidates');
  let payloadArtifactId = '';
  const result = await executeWorkbenchConversationDecision(
    {
      intent: { kind: 'apply_current', target: 'asset', continueAfter: false },
      conversationId: 'conversation-1',
      novelId: 'novel-1',
      bundle: bundle([unrelated, pending]),
      pendingAssetArtifactId: pending.artifactId,
    },
    {
      async applyStructured(payload) {
        payloadArtifactId = payload.artifactId;
        return { decision: decision(pending, 'request_apply', 'apply-1') };
      },
    },
  );

  assert.equal(payloadArtifactId, 'asset-1');
  assert.equal(result.applied, true);
  assert.equal(result.adopted, false);
  assert.match(result.assistantMessage, /已应用到作品/);
});

test('summary application requires the exact pending card and current chapter scope', async () => {
  const summary = card('summary-1', 'chapter_summary', 'chapter-1');
  await assert.rejects(
    executeWorkbenchConversationDecision(
      {
        intent: { kind: 'apply_current', target: 'summary', continueAfter: true },
        conversationId: 'conversation-1',
        novelId: 'novel-1',
        chapterId: 'chapter-other',
        bundle: bundle([summary]),
        pendingSummaryCardId: summary.cardId,
      },
      {
        async applyStructured() {
          throw new Error('must not apply');
        },
      },
    ),
    /当前章节不一致/,
  );
});

test('chapter adoption fails closed when more than one current candidate is unresolved', async () => {
  const first = card('chapter-1a', 'chapter_text', 'chapter-1');
  const second = card('chapter-1b', 'chapter_text', 'chapter-1');
  let adoptionCalls = 0;
  await assert.rejects(
    executeWorkbenchConversationDecision(
      {
        intent: { kind: 'adopt_chapter', target: 'chapter', continueAfter: false },
        conversationId: 'conversation-1',
        novelId: 'novel-1',
        chapterId: 'chapter-1',
        bundle: bundle([first, second]),
      },
      {
        async adoptChapter() {
          adoptionCalls += 1;
          throw new Error('must not adopt');
        },
      },
    ),
    /多个未决正文候选/,
  );
  assert.equal(adoptionCalls, 0);
});

test('explicit chapter command invokes the authorization-preserving adoption service', async () => {
  const chapter = card('chapter-1', 'chapter_text', 'chapter-1');
  const confirmed = decision(chapter, 'confirm');
  let adoptedArtifact = '';
  const result = await executeWorkbenchConversationDecision(
    {
      intent: { kind: 'adopt_chapter', target: 'chapter', continueAfter: false },
      conversationId: 'conversation-1',
      novelId: 'novel-1',
      chapterId: 'chapter-1',
      bundle: bundle([chapter]),
    },
    {
      async adoptChapter(input) {
        adoptedArtifact = input.artifact.artifactId ?? '';
        return {
          decision: confirmed,
          adoption: {
            authorization: {
              authorizationId: 'review-1',
              artifactId: 'chapter-1',
              chapterId: 'chapter-1',
              novelId: 'novel-1',
              decisionId: confirmed.decisionId,
              status: 'consumed',
              issuedAt: '2026-08-31T00:00:01.000Z',
              consumedByDraftId: 'draft-1',
            },
            adoptedDraft: {
              id: 'draft-1',
              novelId: 'novel-1',
              chapterId: 'chapter-1',
              content: '正文',
              source: 'ai_generated',
              versionNo: 1,
              wordCount: 2,
              isAdopted: true,
              createdAt: '2026-08-31T00:00:02.000Z',
              updatedAt: '2026-08-31T00:00:02.000Z',
            },
            summaryFollowUp: {
              status: 'pending_generation',
              nextAction: 'summarize_chapter',
              instruction: '总结本章',
              chapterId: 'chapter-1',
              adoptedDraftId: 'draft-1',
            },
          },
        };
      },
    },
  );

  assert.equal(adoptedArtifact, 'chapter-1');
  assert.equal(result.decision, confirmed);
  assert.equal(result.adopted, true);
  assert.match(result.assistantMessage, /正在准备章节总结/);
});
