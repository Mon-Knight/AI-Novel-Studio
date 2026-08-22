/**
 * 设定库 AI 推演候选类型。
 * 候选记录独立于正式设定库，只有用户采纳后才写入正式数据。
 */

export type SettingSuggestionType = 'character' | 'faction' | 'location' | 'rule';

export type SettingSuggestionStatus = 'pending' | 'adopted' | 'edited_adopted' | 'discarded';

export type SettingSuggestionTargetType = 'character' | 'world_setting' | 'rule_system';

export type SettingSuggestionPayload = Record<string, string>;

export interface SettingSuggestionRecord {
  id: string;
  novelId: string;
  suggestionType: SettingSuggestionType;
  worldType: string;
  referenceStyle: string;
  prompt: string;
  resultJson: string;
  item: SettingSuggestionPayload;
  status: SettingSuggestionStatus;
  adoptedTargetId?: string;
  adoptedTargetType?: SettingSuggestionTargetType;
  userInstruction?: string;
  rawOutput?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GenerateSettingSuggestionsInput {
  novelId: string;
  suggestionType: SettingSuggestionType;
  worldType: string;
  referenceStyle: string;
  count: number;
  userInstruction?: string;
  includeWorldSettings: boolean;
  includeExistingAssets: boolean;
}

export interface SettingSuggestionAdoptionResult {
  record: SettingSuggestionRecord;
  targetId?: string;
  targetType?: SettingSuggestionTargetType;
}
