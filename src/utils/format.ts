/**
 * AI Novel Studio - 安全格式化工具
 */

export function fmtNumber(value: unknown, fallback = '0'): string {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toLocaleString();
  if (typeof value === 'string') { const n = Number(value); if (Number.isFinite(n)) return n.toLocaleString(); }
  return fallback;
}

export function fmtWordCount(value: unknown): string {
  return fmtNumber(value) + ' 字';
}

export function fmtDate(value: unknown, fallback = ''): string {
  if (!value) return fallback;
  try { const d = new Date(value as any); if (isNaN(d.getTime())) return fallback; return d.toLocaleDateString('zh-CN'); }
  catch { return fallback; }
}

export function fmtDateTime(value: unknown, fallback = ''): string {
  if (!value) return fallback;
  try { const d = new Date(value as any); if (isNaN(d.getTime())) return fallback; return d.toLocaleString('zh-CN'); }
  catch { return fallback; }
}
