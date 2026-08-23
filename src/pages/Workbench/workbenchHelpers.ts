export function statusLabel(status: string): string {
  return (
    {
      queued: '排队中',
      planning: '规划中',
      running: '执行中',
      executing: '执行中',
      evaluating: '检查中',
      checking: '审查中',
      cancel_requested: '取消中',
      cancelled: '已取消',
      completed: '已完成',
      failed: '失败',
      idle: '待命',
    }[status] ?? status
  );
}

export const TOOL_LABELS: Record<string, string> = {
  'novel.read_context': '读取小说上下文',
  'chapter.read_outline': '读取章节大纲',
  search_memory: '检索长期记忆',
  generate_chapter: '生成章节候选',
  generate_outline: '生成大纲候选',
  generate_characters: '生成角色候选',
  suggest_events: '生成事件候选',
  expand_settings: '扩展设定候选',
  polish_chapter: '润色章节候选',
  check_quality: '质量检查报告',
  summarize_chapter: '章节总结候选',
  query_world_state: '查询世界状态',
  query_character_state: '查询人物状态',
  query_chapter_info: '查询章节信息',
  generate_scene_plan: '生成分镜规划',
  generate_prose: '生成正文段落',
  evaluate_prose: '评估正文质量',
};
