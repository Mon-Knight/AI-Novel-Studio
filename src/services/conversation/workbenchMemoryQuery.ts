const MAX_QUERY_CHARACTERS = 1_000;

/** A retrieval query is not the user's instruction; never replace the latter. */
export function buildWorkbenchMemoryQuery(goal: string): string {
  const normalized = goal.replace(/\s+/gu, ' ').trim();
  const characters = Array.from(normalized);
  if (characters.length <= MAX_QUERY_CHARACTERS) return normalized;
  // Keep both the leading request and the final qualifications, without an AI
  // call or changing the Registry / Provider budget. Iteration is codepoint-safe.
  return `${characters.slice(0, 700).join('')} ${characters.slice(-299).join('')}`;
}
