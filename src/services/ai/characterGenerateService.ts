/**
 * AI Novel Studio - AI 角色生成（模拟版）
 */
import { generateId, nowISO } from '../database/db';
import type { Character, CreateCharacterInput, CharacterCandidate } from '../../types/character';

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

export const characterGenerateService = {
  async generateCandidates(input: {
    novelId: string; chapterId: string; chapterOutline: string; existingCharacters: Character[];
  }): Promise<CharacterCandidate[]> {
    await sleep(800);
    const existing = input.existingCharacters.map((c) => c.name);
    const pool: CharacterCandidate[] = [
      { name: '路明非', roleType: 'protagonist', identity: '卡塞尔学院学生', faction: '卡塞尔学院', relationToProtagonist: '本人', goal: '存活并保护同伴', personality: '内向自卑，关键时刻勇敢', behaviorLimits: '不会主动伤害无辜者', forbiddenBehaviors: '不会背叛同伴', currentState: '刚接受S级身份', chapterFunction: '本章视角人物' },
      { name: '陈墨瞳', roleType: 'supporting', identity: '学生会主席', faction: '卡塞尔学院', relationToProtagonist: '前辈/导师', goal: '维持学生会地位', personality: '果断冷静，责任感强', behaviorLimits: '不会公开对抗校方', forbiddenBehaviors: '不会放弃弱者', currentState: '观察主角中', chapterFunction: '提供关键指引' },
      { name: '楚天骄', roleType: 'antagonist', identity: '龙族裔', faction: '龙族势力', relationToProtagonist: '宿敌', goal: '复活龙王', personality: '高傲冷酷', behaviorLimits: '不会主动暴露身份', forbiddenBehaviors: '不会在公开场合使用龙族之力', currentState: '伪装潜伏', chapterFunction: '本章冲突源' },
      { name: '酒德麻衣', roleType: 'neutral', identity: '执行部探员', faction: '卡塞尔学院', relationToProtagonist: '潜在盟友', goal: '执行学院任务', personality: '洒脱不拘', behaviorLimits: '不会偏离任务目标', forbiddenBehaviors: '不会伤害无辜', currentState: '正在执行任务', chapterFunction: '提供情报' },
    ];
    return pool.filter((c) => !existing.includes(c.name)).slice(0, 3);
  },
};
