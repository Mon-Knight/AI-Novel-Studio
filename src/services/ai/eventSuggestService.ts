/**
 * AI Novel Studio - AI 事件建议（模拟版）
 */
import { generateId, nowISO } from '../database/db';
import type { Character } from '../../types/character';

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

export interface EventSuggestion {
  title: string; description: string; involvedCharacterIds?: string[]; impact?: string; risk?: string;
}

export const eventSuggestService = {
  async suggestEvents(input: {
    novelId: string; chapterId: string; chapterOutline: string; characters: Character[]; previousSummary?: string;
  }): Promise<EventSuggestion[]> {
    await sleep(800);
    const charIds = input.characters.map((c) => c.id);
    return [
      { title: '初次交锋', description: '主角首次遭遇本章对手，试探实力差距', involvedCharacterIds: charIds.slice(0,2), impact: '建立本章冲突基调', risk: '若实力对比失衡可能影响读者期待' },
      { title: '情报获取', description: '通过对话或观察获得关于主线的重要线索', involvedCharacterIds: charIds.slice(0, 2), impact: '推动主线剧情进展', risk: '信息量过大可能导致伏笔暴露过早' },
      { title: '内部矛盾', description: '主角团队内部因意见分歧产生短暂摩擦', involvedCharacterIds: charIds.slice(0,3), impact: '丰富人物关系层次', risk: '分散主线注意力需控制篇幅' },
    ];
  },
};
