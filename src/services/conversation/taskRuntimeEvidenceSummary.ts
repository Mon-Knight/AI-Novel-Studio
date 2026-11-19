import type { ToolResult } from '../../types/toolRegistry';

/** Bounded, content-free summaries used by the browser-compatible runtime projection. */
export function summarizeArguments(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      if (/prompt|content|body|text|query|goal|candidateText/i.test(key)) {
        return [key, typeof value === 'string' ? { length: value.length } : '[redacted]'];
      }
      if (typeof value === 'string' && value.length > 240) {
        return [key, value.slice(0, 240) + '…'];
      }
      return [key, value];
    }),
  );
}

export function summarizeResult(result: ToolResult): unknown {
  if (!result || typeof result !== 'object') return result;
  const data = result.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    if (typeof record.text === 'string') {
      return { ...result, data: { ...record, text: { length: record.text.length } } };
    }
  }
  return result;
}
