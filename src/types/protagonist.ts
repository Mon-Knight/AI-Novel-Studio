/**
 * AI Novel Studio - 主角设定类型定义
 */

export interface Protagonist {
  id: string;
  novelId: string;
  name: string;
  identity?: string;
  personality?: string;
  goal?: string;
  specialAbility?: string;
  abilityLimits?: string;
  forbiddenBehaviors?: string;
  currentState?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveProtagonistInput {
  novelId: string;
  name: string;
  identity?: string;
  personality?: string;
  goal?: string;
  specialAbility?: string;
  abilityLimits?: string;
  forbiddenBehaviors?: string;
  currentState?: string;
}
