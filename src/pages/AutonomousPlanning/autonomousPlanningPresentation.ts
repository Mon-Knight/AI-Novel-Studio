import type {
  AutonomousAgentType,
  AutonomousStoryBrief,
  AutonomousStoryPlan,
} from '../../types/autonomousCreation';
import type { Novel } from '../../types/novel';

export type PlanTab =
  'overview' | 'volumes' | 'characters' | 'world' | 'conflicts' | 'pacing' | 'chapters';

export const AGENT_LABELS: Record<AutonomousAgentType, string> = {
  plot_planner: 'Plot Planner',
  character_evolution: 'Character Evolution',
  world_builder: 'World Builder',
  conflict_generator: 'Conflict Generator',
  pacing_controller: 'Pacing Controller',
  chapter_batch_planner: 'Chapter Batch Planner',
};

export const STATUS_LABELS: Record<AutonomousStoryPlan['status'], string> = {
  running: '生成中',
  ready: '待确认',
  failed: '可恢复',
  cancelled: '已取消',
  applied: '已应用',
};

export const TABS: Array<{ id: PlanTab; label: string }> = [
  { id: 'overview', label: '总览' },
  { id: 'volumes', label: '分卷' },
  { id: 'characters', label: '人物弧' },
  { id: 'world', label: '世界' },
  { id: 'conflicts', label: '冲突' },
  { id: 'pacing', label: '节奏' },
  { id: 'chapters', label: '章节' },
];

export function defaultBrief(novel: Novel): AutonomousStoryBrief {
  const targetWords = novel.targetWordCount || 720_000;
  return {
    premise:
      novel.description?.trim() ||
      `${novel.title}的主角被卷入一场会改变其生活与世界秩序的长期危机。`,
    genre: novel.genre?.trim() || '长篇小说',
    targetChapterCount: Math.max(12, Math.min(500, Math.round(targetWords / 2_400))),
    targetWordsPerChapter: 2_400,
    readerPromise: '持续升级的冲突、清晰的人物成长和跨卷伏笔回收。',
    endingPreference: '核心矛盾得到回答，主角完成有代价且不可逆的成长。',
    constraints: ['所有重要胜利必须付出代价', '不使用无铺垫的万能能力'],
  };
}

export function progressPercent(plan: AutonomousStoryPlan): number {
  if (plan.status === 'ready' || plan.status === 'applied') return 100;
  if (plan.stage === 'foundation') return 8;
  if (plan.stage === 'creative_dimensions') return plan.characters.length > 0 ? 32 : 18;
  if (plan.stage === 'chapter_batches') {
    const volumeProgress =
      plan.volumes.length > 0 ? plan.progress.completedVolumeIds.length / plan.volumes.length : 0;
    return Math.round(40 + volumeProgress * 58);
  }
  return 0;
}
