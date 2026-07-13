import type {
  CoCreationFieldState,
  CoCreationStage,
  CoCreationStageProgress,
  CoCreationStageStatus,
} from '../../types/coCreation';

export interface CoCreationFieldValue {
  value: unknown;
  state: CoCreationFieldState;
}

export interface CoCreationStageDefinition {
  stage: CoCreationStage;
  label: string;
  description: string;
  minimumRequiredFields: string[];
}

export const CO_CREATION_STAGES: readonly CoCreationStageDefinition[] = [
  {
    stage: 'story_seed',
    label: '故事种子',
    description: '确定故事最核心的一句话设想。',
    minimumRequiredFields: ['storySeed.premise'],
  },
  {
    stage: 'creative_intent',
    label: '创作意图',
    description: '明确题材、核心体验与创作边界。',
    minimumRequiredFields: [
      'creativeIntent.primaryGoal',
      'creativeIntent.genre',
      'creativeIntent.readerExperience',
    ],
  },
  {
    stage: 'world_background',
    label: '世界背景',
    description: '建立故事发生的时代、空间和社会基底。',
    minimumRequiredFields: [
      'worldSetting.era',
      'worldSetting.primaryLocation',
      'worldSetting.socialStructure',
    ],
  },
  {
    stage: 'rule_system',
    label: '规则体系',
    description: '明确能力如何运作、代价和不可突破的边界。',
    minimumRequiredFields: [
      'ruleSystem.coreMechanism',
      'ruleSystem.cost',
      'ruleSystem.boundary',
    ],
  },
  {
    stage: 'protagonist',
    label: '主角设定',
    description: '形成能推动主线的最低完备主角。',
    minimumRequiredFields: [
      'protagonist.identity',
      'protagonist.currentGoal',
      'protagonist.mainStrength',
      'protagonist.coreFlaw',
      'protagonist.mainlineRelation',
    ],
  },
  {
    stage: 'core_conflict',
    label: '核心冲突',
    description: '确定冲突双方、争夺目标和失败代价。',
    minimumRequiredFields: [
      'coreConflict.parties',
      'coreConflict.objective',
      'coreConflict.stakes',
    ],
  },
  {
    stage: 'story_arc',
    label: '故事主线',
    description: '确定主线的启动、转折和终局方向。',
    minimumRequiredFields: [
      'storyArc.incitingIncident',
      'storyArc.midpointTurn',
      'storyArc.climaxDirection',
    ],
  },
  {
    stage: 'outline',
    label: '大纲',
    description: '把主线拆成可执行的卷级或剧情节点。',
    minimumRequiredFields: ['outline.primaryBeats'],
  },
  {
    stage: 'chapter_plan',
    label: '章节计划',
    description: '确定下一章的目标、冲突和结果。',
    minimumRequiredFields: [
      'chapterPlan.goal',
      'chapterPlan.conflict',
      'chapterPlan.outcome',
    ],
  },
  {
    stage: 'chapter_generation',
    label: '章节生成',
    description: '从已确认章节计划进入现有正文生成管线。',
    minimumRequiredFields: ['chapterGeneration.chapterId', 'chapterGeneration.planReady'],
  },
] as const;

const CONFIRMED_STATES = new Set<CoCreationFieldState>(['user_confirmed']);
const PRESENT_STATES = new Set<CoCreationFieldState>([
  'user_confirmed',
  'ai_suggested',
  'ai_inferred',
  'temporary_assumption',
]);

function hasValue(field: CoCreationFieldValue | undefined): boolean {
  if (!field || field.state === 'blank') return false;
  if (field.value === null || field.value === undefined) return false;
  if (typeof field.value === 'string') return field.value.trim().length > 0;
  if (Array.isArray(field.value)) return field.value.length > 0;
  if (typeof field.value === 'object') return Object.keys(field.value as object).length > 0;
  return true;
}

export function deriveStageProgress(
  definition: CoCreationStageDefinition,
  fields: Readonly<Record<string, CoCreationFieldValue | undefined>>,
): CoCreationStageProgress {
  const present = definition.minimumRequiredFields.filter((path) => {
    const field = fields[path];
    return hasValue(field) && PRESENT_STATES.has(field!.state);
  });
  const confirmed = definition.minimumRequiredFields.filter((path) => {
    const field = fields[path];
    return hasValue(field) && CONFIRMED_STATES.has(field!.state);
  });
  const touched = definition.minimumRequiredFields.some((path) => hasValue(fields[path]));
  const missingRequiredFields = definition.minimumRequiredFields.filter((path) => !present.includes(path));
  const percentage = definition.minimumRequiredFields.length === 0
    ? 100
    : Math.round((present.length / definition.minimumRequiredFields.length) * 100);

  let status: CoCreationStageStatus = 'not_started';
  if (confirmed.length === definition.minimumRequiredFields.length) status = 'complete';
  else if (present.length === definition.minimumRequiredFields.length) status = 'minimum_complete';
  else if (present.length > 0 || touched) status = 'in_progress';

  return { stage: definition.stage, status, percentage, missingRequiredFields };
}

export function deriveAllStageProgress(
  fields: Readonly<Record<string, CoCreationFieldValue | undefined>>,
): CoCreationStageProgress[] {
  return CO_CREATION_STAGES.map((definition) => deriveStageProgress(definition, fields));
}

export function selectCurrentStage(
  fields: Readonly<Record<string, CoCreationFieldValue | undefined>>,
  preferredStage?: CoCreationStage,
): CoCreationStage {
  const progress = deriveAllStageProgress(fields);
  const canAdvance = (status: CoCreationStageStatus) => (
    status === 'complete' || status === 'minimum_complete' || status === 'skipped'
  );
  if (preferredStage) {
    const preferred = progress.find((item) => item.stage === preferredStage);
    if (preferred && !canAdvance(preferred.status)) return preferredStage;
  }
  return progress.find((item) => !canAdvance(item.status))?.stage
    ?? 'chapter_generation';
}

export function nextHighValueField(
  stage: CoCreationStage,
  fields: Readonly<Record<string, CoCreationFieldValue | undefined>>,
): string | undefined {
  const definition = CO_CREATION_STAGES.find((item) => item.stage === stage);
  if (!definition) return undefined;
  return definition.minimumRequiredFields.find((path) => {
    const field = fields[path];
    return !hasValue(field) || !CONFIRMED_STATES.has(field!.state);
  });
}

export function getStageDefinition(stage: CoCreationStage): CoCreationStageDefinition {
  const definition = CO_CREATION_STAGES.find((item) => item.stage === stage);
  if (!definition) throw new Error(`未知创作阶段: ${stage}`);
  return definition;
}
