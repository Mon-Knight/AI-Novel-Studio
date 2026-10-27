import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import {
  captureBrowserChapterRuleBaseline,
  assertBrowserChapterRuleBaseline,
  expireBrowserChapterReviewAuthorizations,
} from './browserChapterReviewBaseline';
import { taskConversationService } from './taskConversationService';
import { artifactDecisionService } from './artifactDecisionService';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}
beforeEach(() =>
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  }),
);

test('browser rule baseline changes for exact rule content even with identical timestamps', async () => {
  const frozen = await captureBrowserChapterRuleBaseline('novel-a');
  localStorage.setItem(
    'ai_novel_studio_rule_systems',
    JSON.stringify([
      {
        id: 'r',
        novelId: 'novel-a',
        title: '规则',
        content: '有代价',
        isActive: false,
        updatedAt: 'same',
      },
    ]),
  );
  await assert.rejects(assertBrowserChapterRuleBaseline('novel-a', frozen), /世界规则已变化/);
  await assert.rejects(
    assertBrowserChapterRuleBaseline('novel-a', undefined),
    /缺少生成时世界规则基线/,
  );
});
test('a browser chapter review expires on rule change and no adopted prose is created', async () => {
  const frozen = await captureBrowserChapterRuleBaseline('novel-a');
  const task = await taskConversationService.create('novel-a', '审阅');
  const card = await taskConversationService.publishStructuredCandidate({
    conversationId: task.conversationId,
    novelId: 'novel-a',
    chapterId: 'chapter-a',
    artifactType: 'chapter_text',
    title: '候选',
    summary: '',
    structuredPayloadJson: {
      browserRuleSet: frozen,
      data: { novelId: 'novel-a', chapterId: 'chapter-a', text: '未采用候选' },
    },
  });
  const confirmed = await artifactDecisionService.record({
    conversationId: task.conversationId,
    cardId: card.cardId,
    artifactId: card.artifactId!,
    novelId: 'novel-a',
    chapterId: 'chapter-a',
    targetType: 'chapter',
    targetId: 'chapter-a',
    decision: 'confirm',
  });
  assert.equal(confirmed.authorization?.status, 'issued');
  localStorage.setItem(
    'ai_novel_studio_world_settings',
    JSON.stringify([
      { id: 'world-a', novelId: 'novel-a', title: '变化', content: '时间停滞', isActive: true },
    ]),
  );
  expireBrowserChapterReviewAuthorizations('novel-a');
  assert.equal(
    (await artifactDecisionService.getAuthorization(confirmed.authorization!.authorizationId))
      ?.status,
    'expired',
  );
  assert.equal(localStorage.getItem('ai_novel_studio_drafts_list_chapter-a'), null);
});
test('literal versioned envelope text and real revision metadata both survive repeated conversation reads', async () => {
  const task = await taskConversationService.create('novel-a', '编码回归');
  const literal = '[[ANS_ARTIFACT_REVISION_TURN:v1]]\n{"content":"普通示例","revisionSource":null}';
  await taskConversationService.appendTurn(task.conversationId, 'user', literal);
  assert.equal((await taskConversationService.get(task.conversationId))?.turns[0].content, literal);
  await taskConversationService.appendTurn(task.conversationId, 'assistant', '后续消息');
  assert.equal((await taskConversationService.get(task.conversationId))?.turns[0].content, literal);
  const source = {
    conversationId: task.conversationId,
    novelId: 'novel-a',
    cardId: 'card-a',
    artifactId: 'artifact-a',
    artifactHash: 'a'.repeat(64),
    artifactType: 'chapter_text',
    title: 'A',
  };
  await taskConversationService.appendTurn(task.conversationId, 'user', '修订A', source);
  const restored = (await taskConversationService.get(task.conversationId))?.turns[2];
  assert.equal(restored?.content, '修订A');
  assert.deepEqual(restored?.revisionSource, source);
});
