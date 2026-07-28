export interface ParsedJsonCandidate {
  json: string;
  value: unknown;
  repairedTrailingComma: boolean;
}

function balancedValueAt(text: string, start: number): string | null {
  const first = text[start];
  if (first !== '{' && first !== '[') return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{' || character === '[') {
      stack.push(character);
      continue;
    }
    if (character !== '}' && character !== ']') continue;

    const opener = stack[stack.length - 1];
    const matches = (opener === '{' && character === '}') || (opener === '[' && character === ']');
    if (!matches) return null;
    stack.pop();
    if (stack.length === 0) return text.slice(start, index + 1);
  }
  return null;
}

function withoutTrailingCommas(json: string): string {
  let result = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < json.length; index += 1) {
    const character = json[index];
    if (inString) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }
    if (character === ',') {
      let next = index + 1;
      while (next < json.length && /\s/.test(json[next])) next += 1;
      if (json[next] === '}' || json[next] === ']') continue;
    }
    result += character;
  }
  return result;
}

/**
 * Enumerate complete JSON-looking values without assuming the first code fence
 * or the first brace belongs to the final answer. Each scan is string and
 * escape aware, so braces inside chapter prose do not terminate a candidate.
 */
export function extractJsonCandidates(text: string): string[] {
  const trimmed = text.trim().replace(/^\uFEFF/, '');
  if (!trimmed) return [];

  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string) => {
    const value = candidate.trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  };

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) add(trimmed);

  const fencePattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of trimmed.matchAll(fencePattern)) add(match[1]);

  for (let index = 0; index < trimmed.length; index += 1) {
    if (trimmed[index] !== '{' && trimmed[index] !== '[') continue;
    const candidate = balancedValueAt(trimmed, index);
    if (candidate) add(candidate);
  }
  return candidates;
}

export function parseJsonCandidates(text: string): ParsedJsonCandidate[] {
  const parsed: ParsedJsonCandidate[] = [];
  for (const candidate of extractJsonCandidates(text)) {
    try {
      parsed.push({
        json: candidate,
        value: JSON.parse(candidate) as unknown,
        repairedTrailingComma: false,
      });
      continue;
    } catch {
      // A single trailing comma is a common model formatting defect. Repair
      // commas only when they occur outside strings immediately before ] or }.
    }

    const repaired = withoutTrailingCommas(candidate);
    if (repaired === candidate) continue;
    try {
      parsed.push({
        json: repaired,
        value: JSON.parse(repaired) as unknown,
        repairedTrailingComma: true,
      });
    } catch {
      // Keep strict JSON semantics for every other malformed shape.
    }
  }
  return parsed;
}

export function extractJsonObject(text: string): string | null {
  const parsed = parseJsonCandidates(text);
  if (parsed.length > 0) return parsed[0].json;
  return extractJsonCandidates(text)[0] ?? null;
}

export function safeJsonParse<T>(text: string, fallback: T): T {
  const parsed = parseJsonCandidates(text);
  return parsed.length > 0 ? (parsed[0].value as T) : fallback;
}
