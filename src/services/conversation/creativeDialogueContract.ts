import type {
  CandidateToolChoice,
  ContextReadToolName,
  DshTaskKind,
  DshTurnContract,
} from './taskGoalRouting';

export type CreativeWorkflowAction =
  | 'prepare_settings'
  | 'prepare_characters'
  | 'generate_outline'
  | 'generate_chapter'
  | 'polish_chapter'
  | 'summarize_chapter'
  | 'check_quality'
  | 'suggest_events';

export interface CreativePlannedAction {
  action: CreativeWorkflowAction;
  instruction: string;
  chapterId?: string;
}

const WORKFLOW_TOOL: Record<CreativeWorkflowAction, CandidateToolChoice> = {
  prepare_settings: { name: 'expand_settings', artifactType: 'setting_candidates' },
  prepare_characters: { name: 'generate_characters', artifactType: 'character_candidates' },
  generate_outline: { name: 'generate_outline', artifactType: 'outline' },
  generate_chapter: { name: 'generate_chapter', artifactType: 'chapter_text' },
  polish_chapter: { name: 'polish_chapter', artifactType: 'chapter_text' },
  summarize_chapter: { name: 'summarize_chapter', artifactType: 'chapter_summary' },
  check_quality: { name: 'check_quality', artifactType: 'quality_report' },
  suggest_events: { name: 'suggest_events', artifactType: 'event_candidates' },
};

/** A successful model tool request selects the workflow; prose is never reclassified. */
export function buildCreativeWorkflowContract(
  action: CreativeWorkflowAction,
  chapterId?: string,
): DshTurnContract {
  if (!Object.prototype.hasOwnProperty.call(WORKFLOW_TOOL, action)) {
    throw new Error('未知创作工具动作。');
  }
  const selected = WORKFLOW_TOOL[action];
  const taskKinds: Record<CreativeWorkflowAction, DshTaskKind> = {
    prepare_settings: 'setting_expand',
    prepare_characters: 'character_generate',
    generate_outline: chapterId ? 'outline_generate' : 'story_plan_generate',
    generate_chapter: 'chapter_write',
    polish_chapter: 'chapter_polish',
    summarize_chapter: 'chapter_summary',
    check_quality: 'quality_check',
    suggest_events: 'event_suggest',
  };
  const requiredReadTools: ContextReadToolName[] = ['novel.read_context'];
  if (chapterId) requiredReadTools.push('chapter.read_outline');
  if (chapterId && ['prepare_characters', 'suggest_events', 'check_quality'].includes(action)) {
    requiredReadTools.push('get_character_states');
  }
  if (['suggest_events', 'check_quality'].includes(action)) requiredReadTools.push('search_memory');
  return {
    taskKind: taskKinds[action],
    expectedTool: selected.name,
    expectedArtifactType: selected.artifactType,
    requiredReadTools,
  };
}
