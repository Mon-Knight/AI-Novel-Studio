export const MAX_CHAPTER_SCENE_PLAN_ATTEMPTS = 3;
export const CHAPTER_SCENE_PLAN_MAX_OUTPUT_TOKENS = 4_096;
export const CHAPTER_SCENE_PLAN_TEMPERATURE = 0.4;

export function chapterScenePlanThinkingModeForModel(modelName: string): 'disabled' | undefined {
  return /^deepseek-v4-(?:flash|pro)(?:$|[-_.:])/i.test(modelName.trim()) ? 'disabled' : undefined;
}
