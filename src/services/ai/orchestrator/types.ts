import type { AiGenerateRequest } from '../../../types/ai';

export interface OrchestratedScene {
  sceneNo: number;
  title: string;
  location: string;
  characters: string[];
  goal: string;
  conflict: string;
  beats: Array<{ order: number; text: string; required: boolean }>;
  result: string;
  transition: string;
  contextCapsule: string;
  constraints: string[];
  expectedEndState: string;
  targetCharacters: number | undefined;
}

export const MIN_LOCAL_CHAPTER_BEATS = 3;
export const MAX_LOCAL_CHAPTER_BEATS = 5;
export const MAX_LOCAL_SCENE_BEATS = 3;

/**
 * The local model contract is deliberately bounded: one initial generation
 * plus one rewrite of the same Beat. A truncated response is never continued
 * in-place because the model was trained to close one Beat before 1024 tokens.
 */
export const MAX_LOCAL_BEAT_ATTEMPTS = 2;
/** @deprecated Kept for compatibility with existing callers and tests. */
export const MAX_LOCAL_SCENE_ATTEMPTS = MAX_LOCAL_BEAT_ATTEMPTS;
export const MIN_LOCAL_BEAT_CHARACTERS = 500;
export const MAX_LOCAL_BEAT_CHARACTERS = 900;

export const EXTERNAL_BEAT_REPAIR_MIN_TIMEOUT_SECONDS = 300;
export const EXTERNAL_BEAT_REPAIR_PROMPT_BUFFER_CHARACTERS = 100;
export const EXTERNAL_BEAT_REPAIR_PROMPT_HEADROOM_CHARACTERS = 400;
export const EXTERNAL_BEAT_REPAIR_REQUIRED_EVENT_RATIO = 0.65;
export const EXTERNAL_BEAT_REPAIR_RAW_CHARACTER_HEADROOM = 1_100;
export const EXTERNAL_BEAT_REPAIR_RAW_CHARACTER_MINIMUM_BUFFER = 800;
export const EXTERNAL_BEAT_REPAIR_PARAGRAPH_COUNT = 14;
/** Transport retries do not create another logical Beat-repair round. */
export const MAX_EXTERNAL_BEAT_REPAIR_TRANSPORT_ATTEMPTS = 2;
export const EXTERNAL_BEAT_REPAIR_TRANSPORT_BACKOFF_MS = 1_000;

export const CONTINUATION_CONTEXT_TAIL_CHARS = 600;
export const MAX_CONTINUATION_REUSED_RATIO = 0.35;
export const MIN_CONTINUATION_REUSED_CHARS = 160;

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(stringValue).filter(Boolean)
    : stringValue(value)
      ? [stringValue(value)]
      : [];
}

export function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

export function narrativeCharacterCount(text: string): number {
  return (text.match(/[\u4e00-\u9fff]|[A-Za-z0-9]+/g) ?? []).reduce(
    (sum, part) => sum + (/^[A-Za-z0-9]+$/.test(part) ? 1 : part.length),
    0,
  );
}

export function requestSource(request: AiGenerateRequest): string {
  return request.messages.map((message) => `[${message.role}]\n${message.content}`).join('\n\n');
}
