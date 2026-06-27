/**
 * AI Novel Studio - 统一写作上下文读取器
 * v1.0.45: 为右侧功能栏提供统一的正文上下文读取入口
 *
 * 所有需要在 AI 请求中包含当前正文的面板，
 * 都应通过此函数获取上下文，不得各自读取状态。
 */

import type { Chapter } from '../types/chapter';
import type { ChapterDraft } from '../types/ai';
import { hashTextContent } from './contentHash';

// ==================== 类型定义 ====================

export interface WritingContext {
  /** 当前编辑器全文 */
  fullText: string;
  /** 用户选中的文本（textarea selection） */
  selectedText: string;
  /** 光标起始位置（字符偏移） */
  cursorStart: number;
  /** 光标结束位置（字符偏移） */
  cursorEnd: number;
  /** 当前章节 ID */
  chapterId: string;
  /** 当前草稿 ID */
  draftId: string;
  /** 草稿版本号 */
  draftVersion: number;
  /** 作品 ID（novelId） */
  projectId: string;
  /** 作品世界设定 ID（降级为 novelId，后续扩展） */
  worldId: string;
  /** 上下文包 ID（同 novelId，后续版本独立管理） */
  contextPackageId: string;
  /** 正文哈希（用于检测正文是否变更） */
  contentHash: string;
  /** 正文字数 */
  wordCount: number;
  /** 正文是否有未保存修改 */
  isDirty: boolean;
}

export interface WritingContextInput {
  /** 当前编辑器全文 */
  fullText: string;
  /** textarea DOM 元素 ref（用于读取选中文本和光标位置） */
  textareaElement?: HTMLTextAreaElement | null;
  /** 当前章节 */
  chapter?: Chapter;
  /** 当前草稿 */
  currentDraft?: ChapterDraft | null;
  /** 作品 ID */
  novelId?: string;
  /** 正文是否 dirty */
  isDirty?: boolean;
}

// ==================== 工厂函数 ====================

export function getCurrentWritingContext(input: WritingContextInput): WritingContext {
  const chapterId = input.chapter?.id ?? '';
  const draftId = input.currentDraft?.id ?? '';
  const draftVersion = input.currentDraft?.versionNo ?? 0;
  const projectId = input.novelId ?? '';
  const fullText = input.fullText ?? '';
  const isDirty = input.isDirty ?? false;

  // 读取选中文本和光标位置
  let selectedText = '';
  let cursorStart = 0;
  let cursorEnd = 0;
  const ta = input.textareaElement;
  if (ta) {
    selectedText = ta.value.substring(ta.selectionStart, ta.selectionEnd);
    cursorStart = ta.selectionStart;
    cursorEnd = ta.selectionEnd;
  }

  return {
    fullText,
    selectedText,
    cursorStart,
    cursorEnd,
    chapterId,
    draftId,
    draftVersion,
    projectId,
    worldId: projectId, // 降级为 novelId
    contextPackageId: projectId, // 降级为 novelId，后续版本独立管理
    contentHash: hashTextContent(fullText),
    wordCount: countTextWordsLegacy(fullText),
    isDirty,
  };
}

/** 快速判断两个上下文的正文是否一致 */
export function isContextContentSame(a: WritingContext, b: WritingContext): boolean {
  return a.contentHash === b.contentHash && a.chapterId === b.chapterId;
}

/** 判断 AI 输出是否基于旧正文（正文已变更） */
export function isOutputStale(
  outputContentHash: string | undefined,
  currentContext: WritingContext,
): boolean {
  if (!outputContentHash) return false;
  return outputContentHash !== currentContext.contentHash;
}

// ==================== 内部工具 ====================

function countTextWordsLegacy(text: string): number {
  if (!text?.trim()) return 0;
  // 中文字数统计：汉字 + 英文单词
  const chineseChars = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const englishWords = text
    .replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
  return chineseChars + englishWords;
}
