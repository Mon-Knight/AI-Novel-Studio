/**
 * AI Novel Studio - AI 正文润色（Mock）
 */
import type { RunPolishInput, PolishMode } from '../../types/polish';

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

const modeMarkers: Record<PolishMode, string> = {
  keep_plot: '【润色版：保持剧情不变，优化表达】',
  enhance_description: '【润色版：增强描写，丰富细节】',
  reduce_redundancy: '【润色版：精简冗余，提升节奏】',
  strengthen_conflict: '【润色版：强化冲突，突出张力】',
  adjust_pacing: '【润色版：调整节奏，平滑推进】',
  unify_style: '【润色版：统一文风，保持一致性】',
  fix_language: '【润色版：修正语言问题，优化可读性】',
  custom: '【润色版：按自定义要求优化】',
};

export const polishAiService = {
  async runPolish(input: RunPolishInput): Promise<string> {
    await sleep(1500);
    const marker = modeMarkers[input.options.mode] || modeMarkers.keep_plot;
    const original = input.draftContent || '（空正文）';
    const processed = original
      .replace(/他说/g, '他低声说')
      .replace(/她说/g, '她轻声说');
    const extra = input.options.customInstruction
      ? `\n\n// 自定义要求已应用：${input.options.customInstruction}`
      : '';
    return `${marker}\n\n${processed}\n\n// 润色完成。保留了核心剧情、人物关系和关键事件。${extra}`;
  },
};
