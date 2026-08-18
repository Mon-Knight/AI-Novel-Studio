export type ChapterEngineeringStateStatus = 'draft' | 'active' | 'archived';

export type QualityStrictness = 'relaxed' | 'normal' | 'strict';

export interface ChapterCard {
  chapterTitle: string;
  volumeTitle: string;
  chapterGoal: string;
  openingState: string;
  endingState: string;
  appearingCharacters: string[];
  viewpointCharacter: string;
  primaryLocation: string;
  coreConflict: string;
  mustHappenEvents: string[];
  forbiddenEvents: string[];
  knownInformation: string[];
  unknownInformation: string[];
  releasedInformation: string[];
  reservedSecrets: string[];
  emotionalCurve: string;
  endingHook: string;
  targetWordCount?: number;
  styleRequirements: string[];
  forbiddenWriting: string[];
}

export interface SceneBeat {
  id: string;
  order: number;
  text: string;
  required: boolean;
  characterIds?: string[];
  stateChange?: string;
}

export interface ScenePlanItem {
  id: string;
  sceneNo: number;
  title: string;
  location: string;
  characters: string[];
  goal: string;
  conflict: string;
  keyActions: string[];
  keyDialogue: string;
  informationRelease: string[];
  result: string;
  transition: string;
  /** Ordered scene-local beats. Legacy fields are retained for editing compatibility. */
  beats: SceneBeat[];
  contextCapsule?: string;
  constraints?: string[];
  expectedEndState?: string;
  targetCharacters?: number;
}

export interface GenerationWordRange {
  min?: number;
  max?: number;
}

export interface GenerationConstraints {
  mustFollow: string[];
  forbiddenChanges: string[];
  forbiddenAdditions: string[];
  forbiddenEarlyEvents: string[];
  forbiddenEarlyReveals: string[];
  bannedWords: string[];
  bannedSentencePatterns: string[];
  narrativePerson: string;
  wordRange: GenerationWordRange;
  pacingRequirement: string;
  dialogueRatio: string;
  descriptionRatio: string;
  combatStyle: string;
  informationReleaseMode: string;
}

export interface QualityRules {
  enabledChecks: string[];
  strictness: QualityStrictness;
  manualReviewRequired: boolean;
  customRules: string[];
  autoFixAllowed: boolean;
  autoFixForbidden: string[];
}

export interface ChapterEngineeringState {
  id: string;
  novelId: string;
  volumeId?: string;
  chapterId: string;
  chapterCard: ChapterCard;
  scenePlan: ScenePlanItem[];
  generationConstraints: GenerationConstraints;
  qualityRules: QualityRules;
  draftVersion: number;
  activeVersion: number;
  status: ChapterEngineeringStateStatus;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
}

export interface ChapterEngineeringBundle {
  activeState?: ChapterEngineeringState;
  latestDraft?: ChapterEngineeringState;
  states: ChapterEngineeringState[];
  hasUnappliedDraft: boolean;
}

export interface SaveChapterEngineeringDraftInput {
  novelId: string;
  volumeId?: string;
  chapterId: string;
  chapterCard: ChapterCard;
  scenePlan: ScenePlanItem[];
  generationConstraints: GenerationConstraints;
  qualityRules: QualityRules;
}
