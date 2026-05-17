/**
 * AI Novel Studio - 安全格式化工具
 */

export function formatNumber(value: unknown, fallback = '0'): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toLocaleString();
  }
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n.toLocaleString();
  }
  return fallback;
}

export function formatWordCount(value: unknown): string {
  return `${formatNumber(value)} 字`;
}

export function formatTokenCount(value: unknown): string {
  return `${formatNumber(value)} tokens`;
}

export function formatFileSize(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${n.toLocaleString()} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatPercent(value: unknown): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '0%';
  return `${n.toFixed(1)}%`;
}
