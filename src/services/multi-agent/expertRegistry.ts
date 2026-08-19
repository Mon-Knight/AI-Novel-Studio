import type { ExpertType } from '../../types/multiAgent';

export interface ExpertDefinition {
  type: ExpertType;
  label: string;
  shortLabel: string;
}

export const MULTI_AGENT_EXPERTS: readonly ExpertDefinition[] = [
  { type: 'outline', label: '情节结构', shortLabel: '情节' },
  { type: 'character', label: '角色动机', shortLabel: '角色' },
  { type: 'setting', label: '世界设定', shortLabel: '设定' },
  { type: 'logic', label: '逻辑连续性', shortLabel: '逻辑' },
  { type: 'polish', label: '语言表达', shortLabel: '语言' },
  { type: 'quality', label: '整体质量', shortLabel: '质量' },
] as const;

export const MULTI_AGENT_EXPERT_TYPES = MULTI_AGENT_EXPERTS.map((item) => item.type);

export function isExpertType(value: unknown): value is ExpertType {
  return typeof value === 'string' && MULTI_AGENT_EXPERT_TYPES.some((expert) => expert === value);
}

export function getExpertLabel(expert: ExpertType): string {
  return MULTI_AGENT_EXPERTS.find((item) => item.type === expert)?.label ?? expert;
}
