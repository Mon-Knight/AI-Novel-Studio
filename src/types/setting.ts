/**
 * AI Novel Studio - 世界设定与规则体系类型定义
 */

import type { WorldRuleSaveGuard } from './worldRules';

export interface WorldSetting {
  id: string;
  novelId: string;
  title: string;
  content: string;
  structuredJson?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RuleCategory = 'magic' | 'technology' | 'cultivation' | 'combat' | 'social' | 'other';

export const RuleCategoryLabels: Record<RuleCategory, string> = {
  magic: '魔法',
  technology: '科技',
  cultivation: '修炼',
  combat: '战斗',
  social: '社会',
  other: '其他',
};

export interface RuleSystem {
  id: string;
  novelId: string;
  title: string;
  category?: RuleCategory;
  content: string;
  forbiddenRules?: string;
  structuredJson?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeleteRuleSystemInput extends WorldRuleSaveGuard {
  novelId: string;
}

export interface SaveWorldSettingInput extends WorldRuleSaveGuard {
  novelId: string;
  title: string;
  content: string;
  isActive?: boolean;
}

export interface SaveRuleSystemInput extends WorldRuleSaveGuard {
  novelId: string;
  title: string;
  category?: RuleCategory;
  content: string;
  forbiddenRules?: string;
  isActive?: boolean;
}
