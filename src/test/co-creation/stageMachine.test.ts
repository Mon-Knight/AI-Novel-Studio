import { describe, expect, it } from 'vitest';
import {
  deriveAllStageProgress,
  deriveStageProgress,
  getStageDefinition,
  nextHighValueField,
  selectCurrentStage,
} from '../../features/co-creation/stageMachine';

describe('co-creation stage machine', () => {
  it('advances past stages whose minimum fields are author confirmed', () => {
    const fields = {
      'storySeed.premise': { value: '一个失忆铸剑师追查王朝谎言', state: 'user_confirmed' as const },
      'creativeIntent.primaryGoal': { value: '写成长篇成长故事', state: 'user_confirmed' as const },
      'creativeIntent.genre': { value: '东方奇幻', state: 'user_confirmed' as const },
      'creativeIntent.readerExperience': { value: '克制、悬疑', state: 'user_confirmed' as const },
    };
    expect(selectCurrentStage(fields)).toBe('world_background');
    expect(deriveAllStageProgress(fields).slice(0, 2).map((item) => item.status))
      .toEqual(['complete', 'complete']);
  });

  it('marks AI-filled minimum fields as minimum complete but not author complete', () => {
    const definition = getStageDefinition('rule_system');
    const progress = deriveStageProgress(definition, {
      'ruleSystem.coreMechanism': { value: '借用旧神回声', state: 'ai_suggested' },
      'ruleSystem.cost': { value: '丧失一段记忆', state: 'temporary_assumption' },
      'ruleSystem.boundary': { value: '不能复活死者', state: 'ai_inferred' },
    });
    expect(progress.status).toBe('minimum_complete');
    expect(progress.percentage).toBe(100);
    expect(selectCurrentStage({
      'storySeed.premise': { value: '故事', state: 'user_confirmed' },
      'creativeIntent.primaryGoal': { value: '目标', state: 'user_confirmed' },
      'creativeIntent.genre': { value: '奇幻', state: 'user_confirmed' },
      'creativeIntent.readerExperience': { value: '悬疑', state: 'user_confirmed' },
      'worldSetting.era': { value: '旧纪元', state: 'user_confirmed' },
      'worldSetting.primaryLocation': { value: '边城', state: 'user_confirmed' },
      'worldSetting.socialStructure': { value: '行会', state: 'user_confirmed' },
      'ruleSystem.coreMechanism': { value: '借用旧神回声', state: 'ai_suggested' },
      'ruleSystem.cost': { value: '丧失一段记忆', state: 'temporary_assumption' },
      'ruleSystem.boundary': { value: '不能复活死者', state: 'ai_inferred' },
    }, 'rule_system')).toBe('protagonist');
  });

  it('asks only for the first unconfirmed high-value field', () => {
    const fields = {
      'protagonist.identity': { value: '边城医师', state: 'user_confirmed' as const },
      'protagonist.currentGoal': { value: '救回妹妹', state: 'ai_suggested' as const },
    };
    expect(nextHighValueField('protagonist', fields)).toBe('protagonist.currentGoal');
  });

  it('does not treat blocking conflict fields as minimum complete', () => {
    const fields = {
      'ruleSystem.coreMechanism': { value: '机制存在矛盾', state: 'conflict' as const },
      'ruleSystem.cost': { value: '代价存在矛盾', state: 'conflict' as const },
      'ruleSystem.boundary': { value: '边界存在矛盾', state: 'conflict' as const },
    };
    const progress = deriveStageProgress(getStageDefinition('rule_system'), fields);
    expect(progress.status).toBe('in_progress');
    expect(progress.missingRequiredFields).toHaveLength(3);
  });
});
