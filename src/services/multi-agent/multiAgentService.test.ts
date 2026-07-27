/**
 * Multi-Agent Service Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { multiAgentService } from './multiAgentService';
import type { ExpertType } from '../../types/multiAgent';

describe('multiAgentService', () => {
  describe('review', () => {
    it('应该执行多专家评审并返回结果', async () => {
      const experts: ExpertType[] = ['outline', 'character', 'logic'];

      const result = await multiAgentService.review({
        novelId: 'test-novel',
        chapterId: 'test-chapter',
        draftId: 'test-draft',
        experts,
        maxRounds: 2,
        acceptanceThreshold: 0.6,
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.finalDraftId);
      assert.ok(result.rounds.length > 0);
      assert.ok(result.rounds.length <= 2);
      assert.ok(result.totalTokensUsed >= 0);
      assert.ok(result.durationMs >= 0);
    });

    it('应该在第一轮就接受高分草稿', async () => {
      const experts: ExpertType[] = ['quality'];

      const result = await multiAgentService.review({
        novelId: 'test-novel',
        chapterId: 'test-chapter',
        draftId: 'test-draft',
        experts,
        maxRounds: 3,
        acceptanceThreshold: 0.5,
      });

      assert.strictEqual(result.success, true);
      // Mock 评分在 70-90 之间，应该在 1-2 轮内接受
      assert.ok(result.rounds.length <= 2);
    });

    it('应该最多执行 maxRounds 轮', async () => {
      const experts: ExpertType[] = ['outline', 'character', 'setting'];

      const result = await multiAgentService.review({
        novelId: 'test-novel',
        chapterId: 'test-chapter',
        draftId: 'test-draft',
        experts,
        maxRounds: 3,
        acceptanceThreshold: 0.9, // 高阈值，难以通过
      });

      assert.strictEqual(result.success, true);
      assert.ok(result.rounds.length <= 3);
    });

    it('应该处理多个专家并行评审', async () => {
      const experts: ExpertType[] = ['outline', 'character', 'setting', 'logic', 'polish', 'quality'];

      const result = await multiAgentService.review({
        novelId: 'test-novel',
        chapterId: 'test-chapter',
        draftId: 'test-draft',
        experts,
        maxRounds: 1,
      });

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.rounds.length, 1);
      assert.strictEqual(result.rounds[0].expertOpinions.length, 6);

      // 验证所有专家都返回了意见
      const expertTypes = result.rounds[0].expertOpinions.map(op => op.expert);
      assert.deepStrictEqual(expertTypes.sort(), experts.sort());
    });

    it('应该计算正确的共识', async () => {
      const experts: ExpertType[] = ['outline', 'character'];

      const result = await multiAgentService.review({
        novelId: 'test-novel',
        chapterId: 'test-chapter',
        draftId: 'test-draft',
        experts,
        maxRounds: 1,
      });

      const consensus = result.rounds[0].consensus;

      assert.ok(consensus.averageScore >= 0 && consensus.averageScore <= 100);
      assert.ok(consensus.acceptanceRate >= 0 && consensus.acceptanceRate <= 1);
      assert.ok(['accept', 'revise', 'regenerate'].includes(consensus.action));
      assert.ok(Array.isArray(consensus.majorConcerns));
    });
  });
});
