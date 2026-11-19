/**
 * Character-budget helpers for the extractive context compression provider.
 * Kept separate so the provider module stays inside its frozen size budget.
 */

export function tokenCount(text: string): number {
  return [...text].length;
}

export function takeUntilBudget(parts: string[], budget: number): string {
  const kept: string[] = [];
  let used = 0;
  for (const part of parts) {
    const next = part.trim();
    if (!next) continue;
    const cost = tokenCount(next) + (kept.length > 0 ? 1 : 0);
    if (used + cost > budget) {
      const remaining = budget - used - (kept.length > 0 ? 1 : 0);
      if (remaining > 8) {
        kept.push(`${[...next].slice(0, remaining).join('').trimEnd()}…`);
      }
      break;
    }
    kept.push(next);
    used += cost;
  }
  return kept.join('\n');
}

export function limitPart(value: string | undefined, limit: number): string {
  const text = value?.trim() ?? '';
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 9))}…[已截断]`;
}
