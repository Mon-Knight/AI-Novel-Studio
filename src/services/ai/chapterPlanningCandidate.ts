import type { AiExecutionResult, ExecuteAiTaskInput } from './aiExecutionPipeline';

/** Narrow adapter seam so planning services can be verified without a Provider call. */
export type ChapterPlanningTaskExecutor = (input: ExecuteAiTaskInput) => Promise<AiExecutionResult>;

export function parseJsonCandidate(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(withoutFence) as unknown;
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start < 0 || end <= start) return undefined;
    try {
      return JSON.parse(withoutFence.slice(start, end + 1)) as unknown;
    } catch {
      return undefined;
    }
  }
}

export function scenesFromPayload(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const scenes = (value as { scenes?: unknown }).scenes;
  return Array.isArray(scenes) ? scenes : undefined;
}

export function beatsFromPayload(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const beats = (value as { beats?: unknown }).beats;
  return Array.isArray(beats) ? beats : undefined;
}
