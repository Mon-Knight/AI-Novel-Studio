import { describe, expect, it } from 'vitest';
import { parseCoCreationTurnOutput } from '../../features/co-creation/protocol';

function payload(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    naturalLanguageReply: '这个种子已经足够明确。接下来确认你希望读者获得的核心体验。',
    intent: 'answer_current_question',
    currentStage: 'story_seed',
    extractedInformation: [{
      target: { objectType: 'creative_intent', fieldPath: 'creativeIntent.primaryGoal' },
      value: '写一个关于记忆代价的成长故事',
      fieldState: 'user_confirmed',
      sourceReferences: [{ sourceType: 'author_message', sourceId: 'message-1', excerpt: '记忆就是代价' }],
      confidence: 1,
    }],
    pendingConfirmations: [],
    nextHighValueQuestion: {
      question: '你希望读者最强烈感受到什么？',
      reason: '它会决定叙事节奏和冲突表达。',
      targetFieldPaths: ['creativeIntent.readerExperience'],
    },
    quickReplies: [{ id: 'q1', label: '克制悬疑', value: '克制、悬疑，真相逐步揭开' }],
    changeSuggestions: [{
      target: { objectType: 'world_setting', fieldPath: 'worldSetting.era' },
      originalValue: null,
      suggestedValue: '旧王朝崩解后的第十年',
      fieldState: 'ai_suggested',
      sourceType: 'author_message',
      sourceReferences: [{ sourceType: 'author_message', sourceId: 'message-1' }],
      confidence: 0.8,
      conflicts: [],
    }],
    stageCompletion: {
      stage: 'story_seed', status: 'complete',
      completedRequiredFields: ['storySeed.premise'], missingRequiredFields: [], percentage: 100,
    },
    dataRevision: 3,
    ...overrides,
  };
}

describe('co-creation turn protocol', () => {
  it('parses natural reply and creates authoritative suggestion identity/hash', async () => {
    const result = await parseCoCreationTurnOutput(JSON.stringify(payload()), 3);
    expect(result.naturalLanguageReply).toContain('种子');
    expect(result.changeSuggestions[0].suggestionId).toBeTruthy();
    expect(result.changeSuggestions[0].candidateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.changeSuggestions[0].baseDataRevision).toBe(3);
  });

  it('rejects stale data revisions', async () => {
    await expect(parseCoCreationTurnOutput(JSON.stringify(payload()), 4))
      .rejects.toThrow('错误的数据 revision');
  });

  it('does not let inferred content masquerade as author-confirmed data', async () => {
    const missingSource = payload({
      extractedInformation: [{
        target: { objectType: 'creative_intent', fieldPath: 'creativeIntent.primaryGoal' },
        value: '模型补造的目标', fieldState: 'user_confirmed', sourceReferences: [], confidence: 1,
      }],
    });
    await expect(parseCoCreationTurnOutput(
      JSON.stringify(missingSource), 3, 'story_seed', 'message-1',
    )).rejects.toThrow('必须提供来源引用');

    const forgedSource = payload({
      extractedInformation: [{
        target: { objectType: 'creative_intent', fieldPath: 'creativeIntent.primaryGoal' },
        value: '模型补造的目标', fieldState: 'user_confirmed',
        sourceReferences: [{ sourceType: 'author_message', sourceId: 'another-message' }], confidence: 1,
      }],
    });
    await expect(parseCoCreationTurnOutput(
      JSON.stringify(forgedSource), 3, 'story_seed', 'message-1',
    )).rejects.toThrow('本轮作者来源');
  });

  it('rejects a stage switch and unknown suggestion source type', async () => {
    await expect(parseCoCreationTurnOutput(JSON.stringify(payload()), 3, 'creative_intent'))
      .rejects.toThrow('冻结阶段');
    const changed = payload({
      changeSuggestions: [{
        target: { objectType: 'world_setting', fieldPath: 'worldSetting.era' },
        originalValue: null, suggestedValue: '错误来源', fieldState: 'ai_suggested',
        sourceType: 'fabricated_source', sourceReferences: [], confidence: 0.5, conflicts: [],
      }],
    });
    await expect(parseCoCreationTurnOutput(JSON.stringify(changed), 3, 'story_seed'))
      .rejects.toThrow('sourceType 不受支持');
  });

  it('rejects a target path that does not match its object type', async () => {
    const changed = payload({
      changeSuggestions: [{
        target: { objectType: 'world_setting', fieldPath: 'protagonist.identity' },
        originalValue: null, suggestedValue: '错误目标', fieldState: 'ai_suggested',
        sourceType: 'author_message',
        sourceReferences: [{ sourceType: 'author_message', sourceId: 'message-1' }],
        confidence: 0.5, conflicts: [],
      }],
    });
    await expect(parseCoCreationTurnOutput(JSON.stringify(changed), 3))
      .rejects.toThrow('与目标类型不匹配');
  });

  it('fails closed when the response contains credentials', async () => {
    await expect(parseCoCreationTurnOutput(JSON.stringify(payload({
      naturalLanguageReply: 'Authorization: Bearer abcdefghijklmnop',
    })), 3)).rejects.toThrow('凭据');
  });
});
