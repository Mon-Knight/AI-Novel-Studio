import type { CoCreationMessage } from '../../types/coCreation';
import { computeContentSha256 } from '../../utils/contentIntegrity';

const KEEP_RECENT_MESSAGES = 8;
const MAX_SUMMARY_CHARS = 8_000;

export interface CoCreationSummaryResult {
  summary?: string;
  summaryHash?: string;
  summarizedThroughSequence?: number;
}

export async function compressCoCreationMessages(
  messages: CoCreationMessage[],
  existingSummary?: string,
): Promise<CoCreationSummaryResult> {
  const completed = messages.filter((message) => message.status === 'completed');
  if (completed.length <= KEEP_RECENT_MESSAGES) {
    return existingSummary
      ? { summary: existingSummary, summaryHash: await computeContentSha256(existingSummary) }
      : {};
  }
  const toSummarize = completed.slice(0, -KEEP_RECENT_MESSAGES);
  const lines = toSummarize.map((message) => {
    const role = message.role === 'user' ? '作者' : 'AI';
    const content = message.content.replace(/\s+/g, ' ').trim().slice(0, 360);
    return `${role}：${content}`;
  });
  const combined = [existingSummary?.trim(), ...lines].filter(Boolean).join('\n');
  const summary = combined.length <= MAX_SUMMARY_CHARS
    ? combined
    : combined.slice(combined.length - MAX_SUMMARY_CHARS);
  return {
    summary,
    summaryHash: await computeContentSha256(summary),
    summarizedThroughSequence: toSummarize[toSummarize.length - 1]?.sequenceNo,
  };
}
