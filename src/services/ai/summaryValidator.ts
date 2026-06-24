/**
 * AI Novel Studio - 章节总结一致性校验
 * v1.7.13: 本地校验总结是否与正文一致
 */
import type { ChapterSummarizeResult, ChapterSummaryValidation } from '../../types/chapterSummary';

/**
 * 对章节总结进行一致性校验。
 * 本地算法，不调用 AI，快速检测明显矛盾。
 */
export function validateSummary(
  draftContent: string,
  summaryResult: ChapterSummarizeResult,
): ChapterSummaryValidation {
  const problems: ChapterSummaryValidation['problems'] = [];
  const draftLower = draftContent.toLowerCase();

  // 1. 检查 keyEvents 中的关键实体是否在正文中出现
  for (const event of summaryResult.keyEvents) {
    const keywords = extractKeywords(event);
    const missing = keywords.filter((kw) => kw.length >= 2 && !draftLower.includes(kw.toLowerCase()));
    if (missing.length >= keywords.length * 0.6 && keywords.length >= 3) {
      problems.push({ type: 'fabrication', message: `关键事件「${event.slice(0, 40)}」中的关键信息可能在正文中不存在。` });
    }
  }

  // 2. 检查角色变化中提到的人物名是否在正文出现
  for (const cc of summaryResult.characterChanges) {
    const name = cc.characterName;
    if (name && name.length >= 2 && !draftLower.includes(name.toLowerCase())) {
      problems.push({ type: 'character_error', message: `角色「${name}」未在正文中出现，但总结中记录了其状态变化。` });
    }
  }

  // 3. 检查 settingChanges 中的设定是否在正文有依据
  if (summaryResult.settingChanges) {
    for (const sc of summaryResult.settingChanges) {
      const keywords = extractKeywords(sc);
      const missing = keywords.filter((kw) => kw.length >= 2 && !draftLower.includes(kw.toLowerCase()));
      if (missing.length >= keywords.length * 0.5 && keywords.length >= 2) {
        problems.push({ type: 'setting_error', message: `设定变更「${sc.slice(0, 40)}」在正文中可能缺乏依据。` });
      }
    }
  }

  // 4. 检查 nextChapterHook 是否基于正文已有线索
  if (summaryResult.nextChapterHook && summaryResult.nextChapterHook.length > 20) {
    const hookWords = extractKeywords(summaryResult.nextChapterHook);
    const foundCount = hookWords.filter((kw) => kw.length >= 2 && draftLower.includes(kw.toLowerCase())).length;
    if (hookWords.length >= 3 && foundCount < hookWords.length * 0.3) {
      problems.push({ type: 'speculation', message: '下一章衔接建议可能基于推测而非正文已有线索。' });
    }
  }

  const score = Math.max(0, 100 - problems.length * 12);
  const passed = problems.length === 0;

  return { passed, score, problems, safeToContext: score >= 70 };
}

/** 从中文文本中提取关键词（简单分词） */
function extractKeywords(text: string): string[] {
  // 移除标点，按常见分隔符拆分
  const cleaned = text.replace(/[，。！？、；：""''「」『』【】（）《》\s,.!?;:'"()[\]{}]+/g, ' ');
  const segments = cleaned.split(' ');
  // 过滤短词和纯数字
  return segments.filter((s) => s.length >= 2 && !/^\d+$/.test(s));
}

/** 计算文本简单哈希 */
export function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < Math.min(content.length, 10000); i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return 'h_' + (hash >>> 0).toString(16).padStart(8, '0');
}
