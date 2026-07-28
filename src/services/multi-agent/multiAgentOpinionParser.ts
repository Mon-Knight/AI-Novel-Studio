import { extractJsonObject } from '../ai/jsonUtils';
import type { ExpertOpinion } from '../../types/multiAgent';

interface RawExpertOpinion {
  score?: unknown;
  accepted?: unknown;
  summary?: unknown;
  issues?: unknown;
  suggestions?: unknown;
}

function boundedText(value: unknown, limit: number): string {
  if (typeof value !== 'string') return '';
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function boundedList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const item of value) {
    const normalized = boundedText(item, 500);
    if (normalized) unique.add(normalized);
    if (unique.size === 6) break;
  }
  return [...unique];
}

export function parseExpertOpinion(
  text: string,
): Pick<ExpertOpinion, 'score' | 'accepted' | 'summary' | 'issues' | 'suggestions'> {
  const json = extractJsonObject(text);
  if (!json) throw new Error('专家返回内容不包含 JSON 对象。');

  let raw: RawExpertOpinion;
  try {
    raw = JSON.parse(json) as RawExpertOpinion;
  } catch {
    throw new Error('专家返回 JSON 无法解析。');
  }

  const score = typeof raw.score === 'number' ? raw.score : Number(raw.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) {
    throw new Error('专家评分必须是 0 到 100 的数字。');
  }
  if (typeof raw.accepted !== 'boolean') {
    throw new Error('专家 accepted 字段必须是布尔值。');
  }

  const summary = boundedText(raw.summary, 500);
  if (!summary) throw new Error('专家结论不能为空。');

  return {
    score: Math.round(score),
    accepted: raw.accepted,
    summary,
    issues: boundedList(raw.issues),
    suggestions: boundedList(raw.suggestions),
  };
}
