import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtifactCard } from './WorkbenchComponents';
import type { ConversationArtifactCard } from '../../types/conversation';

for (const [status, label, action] of [
  ['issued', '待审阅 · 尚未采用', 'workbench-artifact-continue-review'],
  ['consumed', '已采用', 'workbench-artifact-view-adopted'],
  ['expired', '审阅授权已失效', 'workbench-artifact-continue-review'],
] as const) {
  test(
    'chapter card derives ' + status + ' from authorization instead of a generic confirm label',
    () => {
      const artifact: ConversationArtifactCard = {
        cardId: 'card-a',
        artifactId: 'artifact-a',
        conversationId: 'task-a',
        artifactType: 'chapter_text',
        title: '章节候选A',
        summary: '',
        status: 'confirmed',
        createdAt: '',
        latestDecision: {
          decisionId: 'decision-a',
          artifactId: 'artifact-a',
          artifactHash: 'hash',
          cardId: 'card-a',
          conversationId: 'task-a',
          decision: 'confirm',
          idempotencyKey: 'confirm-a',
          actor: 'user',
          targetType: 'chapter',
          targetId: 'chapter-a',
          createdAt: '',
        },
        reviewAuthorization: {
          authorizationId: 'auth-a',
          artifactId: 'artifact-a',
          chapterId: 'chapter-a',
          novelId: 'novel-a',
          decisionId: 'decision-a',
          status,
          issuedAt: '',
          ...(status === 'consumed' ? { consumedByDraftId: 'draft-a' } : {}),
        },
      };
      const html = renderToStaticMarkup(
        createElement(ArtifactCard, { artifact, onDecide: () => undefined }),
      );
      assert.ok(html.includes(label));
      assert.ok(html.includes(action));
      assert.ok(html.includes('data-review-status="' + status + '"'));
      if (status === 'expired') assert.match(html, /disabled=""/);
      else assert.doesNotMatch(html, /workbench-artifact-reject|workbench-artifact-revise/);
    },
  );
}
