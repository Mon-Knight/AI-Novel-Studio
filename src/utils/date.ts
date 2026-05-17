/**
 * AI Novel Studio - 安全日期工具
 */

export function toValidDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

export function formatDate(value: unknown, fallback = '暂无时间'): string {
  const date = toValidDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString('zh-CN');
}

export function formatDateTime(value: unknown, fallback = '暂无时间'): string {
  const date = toValidDate(value);
  if (!date) return fallback;
  return date.toLocaleString('zh-CN');
}

export function toIsoDateOrNow(value: unknown): string {
  const date = toValidDate(value);
  return (date ?? new Date()).toISOString();
}
