import type { SettingSuggestionPayload } from '../../types/settingSuggestion';

export function normalizePayload(raw: unknown): SettingSuggestionPayload {
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]),
  );
}
