export const TASK_AUTHORIZATION_ACTION_LABELS = {
  apply_planning: '自动应用规划',
  adopt_chapter_text: '自动采用正文候选',
  apply_summary: '自动应用总结',
} as const;
export const TASK_AUTHORIZATION_STATUS_LABELS = {
  active: '预授权有效',
  revoked: '已撤销',
  expired: '已过期',
  exhausted: '写入额度已用完',
} as const;
