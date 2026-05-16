/**
 * AI Novel Studio - AI 章节总结（模拟版）
 */
import type { ChapterSummarizeResult, SummarizeAdoptedChapterInput } from '../../types/chapterSummary';

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

export const chapterSummarizeService = {
  async summarize(input: SummarizeAdoptedChapterInput): Promise<ChapterSummarizeResult> {
    await sleep(1000);
    return {
      summary: `本章「${input.chapterTitle}」中，主角完成了关键剧情推进。${input.chapterOutline ? '按照大纲设定，' + input.chapterOutline.slice(0, 60) + '……' : ''}本章核心事件在于角色在关键场景中做出选择，为后续剧情埋下伏笔。`,
      keyEvents: ['主角抵达关键场景', '与对立角色发生冲突', '做出关键决策'],
      characterChanges: [
        { characterName: '主角', stateSummary: '经历本章事件后，对周围环境有了更深认识，开始意识到隐藏的线索。', relationshipChanges: '与同伴的信任关系有所加深。', goalChanges: '短期目标更加明确。', healthState: '轻微疲惫', knowledgeState: '获得关键情报线索' },
      ],
      relationshipChanges: [
        { fromCharacterName: '主角', toCharacterName: '主要配角', change: '信任度上升，从陌生人变为临时盟友' },
      ],
      newForeshadows: ['主角的特殊能力可能与主线阴谋有关', '某角色对主角的真实身份有所察觉'],
      resolvedForeshadows: [],
      nextChapterHints: '下一章可以推进主角的调查，揭示本章伏笔的一角，同时保持更多线索隐藏。',
      contextRecords: [
        { contextType: 'chapter_summary', title: `${input.chapterTitle}摘要`, content: `本章核心：${input.chapterOutline?.slice(0, 80) || '主线推进'}。主角在关键场景做出决策，获得重要线索。`, importance: 5 },
        { contextType: 'character_state', title: '主角状态更新', content: '主角短期目标更为明确，对周围环境提高了警觉，获得关键情报线索。', importance: 4 },
        { contextType: 'foreshadow', title: '能力与主线关联', content: '主角的特殊能力可能与主线阴谋存在深层联系，后续需要继续推进此线索。', importance: 4 },
        { contextType: 'plot_progress', title: '剧情进度', content: '本章推进了主线剧情的一环，主要角色关系开始转变。', importance: 3 },
      ],
    };
  },
};
