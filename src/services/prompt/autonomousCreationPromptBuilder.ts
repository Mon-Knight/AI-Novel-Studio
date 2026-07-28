import plotPlannerTemplate from '../../../prompts/autonomous_plot_planner.md?raw';
import characterEvolutionTemplate from '../../../prompts/autonomous_character_evolution.md?raw';
import worldBuilderTemplate from '../../../prompts/autonomous_world_builder.md?raw';
import conflictGeneratorTemplate from '../../../prompts/autonomous_conflict_generator.md?raw';
import pacingControllerTemplate from '../../../prompts/autonomous_pacing_controller.md?raw';
import chapterBatchTemplate from '../../../prompts/autonomous_chapter_batch.md?raw';
import type { AiGenerateRequest } from '../../types/ai';
import type {
  AutonomousCharacterPlan,
  AutonomousChapterPlan,
  AutonomousConflictThread,
  AutonomousPacingPoint,
  AutonomousStoryArc,
  AutonomousStoryBible,
  AutonomousStoryBrief,
  AutonomousVolumePlan,
  AutonomousWorldElement,
} from '../../types/autonomousCreation';
import { resolveAutonomousChapterBatchMaxTokens } from '../autonomous-creation/autonomousChapterBatchPolicy';
import type { PlanShape } from '../autonomous-creation/autonomousPlanBuilder';

function requestMessage(marker: string, payload: unknown): string {
  return `${marker}\n【REQUEST_JSON】\n${JSON.stringify(payload)}`;
}

export function buildPlotFoundationRequest(
  brief: AutonomousStoryBrief,
  shape: PlanShape,
): AiGenerateRequest {
  return {
    taskType: 'autonomous_plot_plan',
    messages: [
      {
        role: 'system',
        content: `[AUTONOMOUS_AGENT:PLOT_PLANNER]\n\n${plotPlannerTemplate.trim()}`,
      },
      {
        role: 'user',
        content: requestMessage('[AUTONOMOUS_FOUNDATION_REQUEST]', { brief, shape }),
      },
    ],
    temperature: 0.55,
    maxTokens: 8_000,
    promptTemplateSource: 'prompts/autonomous_plot_planner.md',
  };
}

export function buildCharacterEvolutionRequest(input: {
  brief: AutonomousStoryBrief;
  storyBible: AutonomousStoryBible;
  arcs: AutonomousStoryArc[];
}): AiGenerateRequest {
  return {
    taskType: 'autonomous_character_evolution',
    messages: [
      {
        role: 'system',
        content: `[AUTONOMOUS_AGENT:CHARACTER_EVOLUTION]\n\n${characterEvolutionTemplate.trim()}`,
      },
      { role: 'user', content: requestMessage('[AUTONOMOUS_CHARACTER_REQUEST]', input) },
    ],
    temperature: 0.5,
    maxTokens: 8_000,
    promptTemplateSource: 'prompts/autonomous_character_evolution.md',
  };
}

export function buildWorldBuilderRequest(input: {
  brief: AutonomousStoryBrief;
  storyBible: AutonomousStoryBible;
  arcs: AutonomousStoryArc[];
  volumes: AutonomousVolumePlan[];
}): AiGenerateRequest {
  return {
    taskType: 'autonomous_world_build',
    messages: [
      {
        role: 'system',
        content: `[AUTONOMOUS_AGENT:WORLD_BUILDER]\n\n${worldBuilderTemplate.trim()}`,
      },
      { role: 'user', content: requestMessage('[AUTONOMOUS_WORLD_REQUEST]', input) },
    ],
    temperature: 0.55,
    maxTokens: 8_000,
    promptTemplateSource: 'prompts/autonomous_world_builder.md',
  };
}

export function buildConflictGeneratorRequest(input: {
  brief: AutonomousStoryBrief;
  storyBible: AutonomousStoryBible;
  arcs: AutonomousStoryArc[];
  volumes: AutonomousVolumePlan[];
  characters: AutonomousCharacterPlan[];
}): AiGenerateRequest {
  return {
    taskType: 'autonomous_conflict_generate',
    messages: [
      {
        role: 'system',
        content: `[AUTONOMOUS_AGENT:CONFLICT_GENERATOR]\n\n${conflictGeneratorTemplate.trim()}`,
      },
      { role: 'user', content: requestMessage('[AUTONOMOUS_CONFLICT_REQUEST]', input) },
    ],
    temperature: 0.6,
    maxTokens: 8_000,
    promptTemplateSource: 'prompts/autonomous_conflict_generator.md',
  };
}

export function buildPacingControllerRequest(input: {
  brief: AutonomousStoryBrief;
  storyBible: AutonomousStoryBible;
  arcs: AutonomousStoryArc[];
  volumes: AutonomousVolumePlan[];
}): AiGenerateRequest {
  return {
    taskType: 'autonomous_pacing_control',
    messages: [
      {
        role: 'system',
        content: `[AUTONOMOUS_AGENT:PACING_CONTROLLER]\n\n${pacingControllerTemplate.trim()}`,
      },
      { role: 'user', content: requestMessage('[AUTONOMOUS_PACING_REQUEST]', input) },
    ],
    temperature: 0.35,
    maxTokens: 4_000,
    promptTemplateSource: 'prompts/autonomous_pacing_controller.md',
  };
}

export function buildChapterBatchRequest(input: {
  brief: AutonomousStoryBrief;
  storyBible: AutonomousStoryBible;
  volume: AutonomousVolumePlan;
  arcs: AutonomousStoryArc[];
  characters: AutonomousCharacterPlan[];
  worldElements: AutonomousWorldElement[];
  conflicts: AutonomousConflictThread[];
  pacingPoints: AutonomousPacingPoint[];
  previousChapters: Array<
    Pick<AutonomousChapterPlan, 'chapterNumber' | 'title' | 'goal' | 'endingHook'>
  >;
}): AiGenerateRequest {
  const chapterCount = input.volume.chapterEnd - input.volume.chapterStart + 1;
  const maxTokens = resolveAutonomousChapterBatchMaxTokens(chapterCount);
  return {
    taskType: 'autonomous_chapter_batch',
    messages: [
      {
        role: 'system',
        content: `[AUTONOMOUS_AGENT:CHAPTER_BATCH_PLANNER]\n\n${chapterBatchTemplate.trim()}`,
      },
      { role: 'user', content: requestMessage('[AUTONOMOUS_CHAPTER_BATCH_REQUEST]', input) },
    ],
    temperature: 0.55,
    maxTokens,
    promptTemplateSource: 'prompts/autonomous_chapter_batch.md',
  };
}
