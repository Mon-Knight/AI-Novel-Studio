/**
 * AI Novel Studio - 角色类型定义
 */

export interface Character {
  id: string;
  novelId: string;
  name: string;
  role: 'protagonist' | 'supporting' | 'antagonist' | 'minor';
  description: string;
  personality: string;
  goals: string;
  restrictions: string;
  currentState: string;
  relationships: CharacterRelationship[];
  isConfirmed: boolean;
  createdAt: string;
}

export interface CharacterRelationship {
  id: string;
  sourceCharacterId: string;
  targetCharacterId: string;
  targetName: string;
  relationshipType: string;
  description: string;
}

export interface CharacterState {
  id: string;
  characterId: string;
  chapterId: string;
  state: string;
  location: string;
  updatedAt: string;
}
