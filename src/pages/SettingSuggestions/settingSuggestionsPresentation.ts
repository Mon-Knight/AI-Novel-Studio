import type {
  SettingSuggestionRecord,
  SettingSuggestionStatus,
  SettingSuggestionType,
} from '../../types/settingSuggestion';

export const typeLabels: Record<SettingSuggestionType, string> = {
  character: '角色',
  faction: '势力',
  location: '地点',
  rule: '规则',
};

export const statusLabels: Record<SettingSuggestionStatus, string> = {
  pending: '待确认',
  adopted: '已采纳',
  edited_adopted: '编辑后采纳',
  discarded: '已废弃',
};

export const statusClassNames: Record<SettingSuggestionStatus, string> = {
  pending: 'tag-warning',
  adopted: 'tag-success',
  edited_adopted: 'tag-primary',
  discarded: 'tag-default',
};

export const worldTypeOptions = [
  '西方奇幻',
  '东方玄幻',
  '修仙',
  '科幻',
  '赛博朋克',
  '末日',
  '克苏鲁',
  '蒸汽朋克',
  '自定义',
];

export const referenceStyleOptions = [
  '英雄史诗',
  '黑暗奇幻',
  '王国战争',
  '学院成长',
  '领地建设',
  '宗教冲突',
  '魔法工业化',
  '种族战争',
  '自定义',
];

export const fieldLabels: Record<string, string> = {
  name: '名称',
  identity: '身份',
  faction: '所属势力',
  personality: '性格',
  goal: '目标',
  ability: '能力',
  weakness: '弱点',
  current_status: '当前状态',
  plot_role: '剧情作用',
  mainline_relation: '与主线关系',
  type: '类型',
  leader: '领袖',
  resources: '资源',
  allies: '盟友',
  enemies: '敌人',
  territory: '控制区域',
  internal_conflict: '内部矛盾',
  region: '所在区域',
  controlled_by: '控制势力',
  description: '描述',
  danger_level: '危险程度',
  resource: '重要资源',
  history: '关键历史',
  plot_trigger: '可触发剧情',
  content: '规则内容',
  limits: '限制条件',
  scope: '影响范围',
  possible_conflict: '可能冲突',
  plot_usage: '剧情用途',
};

export function formatTarget(record: SettingSuggestionRecord): string {
  if (!record.adoptedTargetId || !record.adoptedTargetType) return '';
  const targetMap: Record<string, string> = {
    character: '角色库',
    world_setting: '世界设定',
    rule_system: '规则体系',
  };
  return `${targetMap[record.adoptedTargetType] || '正式数据'}：${record.adoptedTargetId.slice(0, 8)}`;
}
