import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentQualityJudge } from './agentQualityJudge';
import { qualityFeedbackMemory } from './qualityFeedbackMemory';
import { creativeAgentHarness } from './agentLoop';
import { novelMemoryManager } from '../memory/novelMemoryManager';
import { agentToolRegistry } from './agentToolRegistry';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number {
    return this.values.size;
  }
  clear(): void {
    this.values.clear();
  }
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

test('AgentQualityJudge: 正文质量多维度裁判与合规审查', async () => {
  // 1. 低质量文本（字数过短/占位符）
  const lowQualityReview = await agentQualityJudge.judgeQuality({
    userGoal: '创作遗迹探险正文',
    prose: '主角走进了遗迹。[待补充]',
    threshold: 80,
  });
  assert.equal(lowQualityReview.passed, false);
  assert.ok(lowQualityReview.overallScore < 60);
  assert.ok(lowQualityReview.suggestions.length > 0);

  // 2. 高质量文学正文
  const highQualityText = `
    幽暗的石阶蜿蜒向下，林清玄轻踩在覆满青苔的石板上，足音细不可闻。
    四周石壁上雕刻着早已失传的古老符文，在荧光苔藓的微芒下若隐若现。他屏住呼吸，指尖轻轻抚过石柱上的剑痕，
    心中默念宗门秘典。前方的幽暗深处隐约传来机关轮轴咬合的微弱机括声，他眼神微敛，隐忍克制住探求终极秘密的冲动，
    只将几枚关键的拓印石收入袖中，随后贴着石壁谨慎后撤。
  `.repeat(2);

  const highQualityReview = await agentQualityJudge.judgeQuality({
    userGoal: '主角进入遗迹探寻线索，隐忍谨慎',
    scenePlan: '进入遗迹 -> 勘查符文 -> 发现线索但隐忍撤退',
    prose: highQualityText,
    threshold: 80,
  });

  assert.equal(highQualityReview.passed, true);
  assert.ok(highQualityReview.overallScore >= 85);
  assert.ok(highQualityReview.characterConsistency >= 85);
  assert.ok(highQualityReview.plotProgression >= 85);
  assert.ok(highQualityReview.styleMatch >= 85);
});

test('QualityFeedbackMemory: 成功生成范例沉淀与经验检索', () => {
  qualityFeedbackMemory.clear();

  const mockReview = {
    id: 'qual-test-01',
    coherence: 92,
    characterConsistency: 95,
    plotProgression: 90,
    styleMatch: 94,
    overallScore: 93,
    suggestions: [],
    passed: true,
    timestamp: new Date().toISOString(),
  };

  const record = qualityFeedbackMemory.recordSuccessfulGeneration({
    userGoal: '遗迹探险与线索探寻',
    inputConditions: {
      sceneGoal: '探秘遗迹',
      sceneBeats: '潜行 -> 探查 -> 撤离',
      povCharacter: '林清玄',
    },
    generationParams: {
      modelName: 'mock-writer',
      temperature: 0.7,
    },
    qualityReview: mockReview,
    proseSnippet: '幽暗的石阶蜿蜒向下...',
  });

  assert.ok(record.id.startsWith('qf-'));
  const matches = qualityFeedbackMemory.findBestGenerationExamples('遗迹探险');
  assert.ok(matches.length >= 1);
  assert.equal(matches[0].qualityReview.overallScore, 93);

  qualityFeedbackMemory.clear();
});

test('CreativeAgentHarness Quality Loop: 高质量正文直接通过质检并落盘记忆与版本', async () => {
  const novelId = 'novel-qual-pass-01';
  novelMemoryManager.reset(novelId);

  const result = await creativeAgentHarness.run(
    '完成第五章第一节创作：主角进入遗迹探寻线索',
    { novelId },
    { maxTurns: 8 },
  );

  assert.equal(result.status, 'completed');
  assert.ok(result.qualityReviews && result.qualityReviews.length >= 1);
  assert.equal(result.qualityReviews[0].passed, true);

  // 验证各环节工具均已执行
  const tools = result.executionRecords.map((r) => r.toolName);
  assert.ok(tools.includes('generate_prose'));
  assert.ok(tools.includes('quality_check'));
  assert.ok(tools.includes('update_memory'));
  assert.ok(tools.includes('save_chapter_version'));

  novelMemoryManager.reset(novelId);
});

test('CreativeAgentHarness Quality Loop: 低质量初稿触发自主重写 (rewrite_prose) 修复闭环', async () => {
  const novelId = 'novel-qual-rewrite-01';
  novelMemoryManager.reset(novelId);

  let proseCallCount = 0;

  // 模拟第一遍返回短文本，第二遍重写返回高质量正文
  agentToolRegistry.registerTool({
    descriptor: {
      name: 'generate_prose',
      description: '生成小说正文',
      parameters: {
        type: 'object',
        properties: {
          novelId: { type: 'string', description: '作品 ID' },
          chapterId: { type: 'string', description: '章节 ID' },
          sceneGoal: { type: 'string', description: '场景目标' },
        },
      },
    },
    execute: async () => {
      proseCallCount += 1;
      if (proseCallCount === 1) {
        // 第一次生成短文本（将导致质检不通过）
        return {
          prose: '主角走进了遗迹。[待补充]',
          wordCount: 15,
        };
      }
      // 第二次重写生成达标正文
      return {
        prose: `
          幽暗的石阶蜿蜒向下，林清玄轻踩在覆满青苔的石板上，足音细不可闻。
          四周石壁上雕刻着早已失传的古老符文，在荧光苔藓的微芒下若隐若现。他屏住呼吸，指尖轻轻抚过石柱上的剑痕。
          前方的幽暗深处隐约传来机关轮轴咬合的微弱机括声，他眼神微敛，隐忍克制住探求终极秘密的冲动，将关键线索妥善记录后谨慎撤退。
        `.repeat(2),
        wordCount: 450,
      };
    },
  });

  try {
    const result = await creativeAgentHarness.run(
      '完成第五章第一节创作',
      { novelId },
      { maxTurns: 10 },
    );

    assert.equal(result.status, 'completed');
    assert.ok(proseCallCount >= 2, '应当触发自主重写');

    // 验证质检记录：首次未通过，第二次通过
    assert.ok(result.qualityReviews && result.qualityReviews.length >= 2);
    assert.equal(result.qualityReviews[0].passed, false);
    assert.equal(result.qualityReviews[1].passed, true);

    // 最终落盘工具依旧正常执行
    const tools = result.executionRecords.map((r) => r.toolName);
    assert.ok(tools.includes('update_memory'));
    assert.ok(tools.includes('save_chapter_version'));
  } finally {
    // 恢复标准 generate_prose 工具
    agentToolRegistry.registerTool({
      descriptor: {
        name: 'generate_prose',
        description: '生成小说正文',
        parameters: {
          type: 'object',
          properties: {
            novelId: { type: 'string', description: '作品 ID' },
            chapterId: { type: 'string', description: '章节 ID' },
            sceneGoal: { type: 'string', description: '场景目标' },
          },
        },
      },
      execute: async () => ({
        prose: '正文生成完成：林清玄步入石阶深处，发现符文线索。',
        wordCount: 300,
      }),
    });
    novelMemoryManager.reset(novelId);
  }
});
