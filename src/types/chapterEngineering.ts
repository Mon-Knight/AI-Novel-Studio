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
  reservedMysteries: string[];
  emotionalCurve: string;
  endingHook: string;
  targetWordCount?: number;
  styleRequirements: string[];
  forbiddenWriting: string[];
}

/**
 * Scene-only plans are versioned explicitly so legacy merged Scene+Beat plans
 * cannot be silently reinterpreted or back-filled.
 */
export const SCENE_PLAN_VERSION_V2 = 2 as const;

export interface SceneBeat {
  id: string;
  order: number;
  text: string;
  required: boolean;
  characterIds?: string[];
  /** Planned state immediately before this Beat. Never a substitute for actual prose state. */
  startState?: string;
  /** Planned change produced by this Beat. Never a substitute for actual prose state. */
  stateChange?: string;
  /** Planned prose budget for this Beat, inside the caller's single-call model envelope. */
  targetCharacters?: number;
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
  /**
   * 2 marks a Scene-only plan whose Beats are planned when execution reaches the
   * Scene. Absent means the legacy merged v1 plan.
   */
  planVersion?: typeof SCENE_PLAN_VERSION_V2;
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
