/**
 * AI Novel Studio - 大文本分片保存工具
 *
 * 在 Tauri 环境下使用 Rust 后端的分片保存能力，
 * 在浏览器开发模式下使用 localStorage 直接保存（不分片）。
 */

import {
  DEFAULT_CHUNK_SIZE,
  LARGE_TEXT_THRESHOLD,
  shouldUseLargeTextSave,
  type CreateLargeTextSessionOptions,
  type LargeTextSaveProgress,
  type LargeTextSaveResult,
} from '../types/largeTextSave';

// ==================== 类型定义 ====================

interface TauriCreateSessionInput {
  targetType: string;
  targetId?: string;
  fieldName: string;
  title?: string;
  totalChunks: number;
  totalChars: number;
  totalBytes: number;
  contentSha256?: string;
}

interface TauriCreateSessionOutput {
  sessionId: string;
  cacheDir: string;
}

interface TauriAppendChunkInput {
  sessionId: string;
  chunkIndex: number;
  content: string;
  charCount: number;
  byteCount: number;
  chunkSha256?: string;
}

interface TauriAppendChunkOutput {
  sessionId: string;
  chunkIndex: number;
  savedCount: number;
  totalChunks: number;
}

interface TauriFinalizeInput {
  sessionId: string;
}

interface TauriFinalizeOutput {
  documentId: string;
  totalChars: number;
  totalBytes: number;
  chunkCount: number;
}

interface TauriAbortInput {
  sessionId: string;
}

// ==================== 工具函数 ====================

/** 检测是否在 Tauri 环境中 */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

/** Tauri invoke 包装（无超时限制，用于大文本操作） */
async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/tauri');
  return invoke<T>(cmd, args);
}

/** 计算文本字节长度 */
function byteLength(content: string): number {
  return new Blob([content]).size;
}

/** 计算字符长度 */
function charLength(content: string): number {
  return content.length;
}

/** 将文本按字符边界切分成指定大小的分片 */
function splitContent(content: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  let offset = 0;
  while (offset < content.length) {
    const end = Math.min(offset + chunkSize, content.length);
    // 尝试在 chunkSize 范围内找到完整的 UTF-8 字符边界
    let actualEnd = end;
    if (end < content.length) {
      // 确保不在 surrogate pair 中间切断
      const code = content.charCodeAt(end - 1);
      if (code >= 0xd800 && code <= 0xdbff) {
        actualEnd = end - 1;
      }
    }
    chunks.push(content.slice(offset, actualEnd));
    offset = actualEnd;
  }
  return chunks;
}

/** 计算 SHA-256（仅在浏览器支持时） */
async function computeSha256(content: string): Promise<string | undefined> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(content);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return undefined;
    }
  }
  return undefined;
}

// ==================== 主保存函数 ====================

/**
 * 使用分片方式保存大文本
 *
 * @example
 * ```ts
 * const result = await saveLargeTextWithChunks({
 *   targetType: 'draft',
 *   targetId: chapterId,
 *   fieldName: 'content',
 *   content: largeTextContent,
 *   onProgress: (p) => console.log(p.stage, p.percent),
 * });
 * ```
 */
export async function saveLargeTextWithChunks(
  options: CreateLargeTextSessionOptions,
): Promise<LargeTextSaveResult> {
  const {
    targetType,
    targetId,
    fieldName,
    title,
    content,
    chunkSize = DEFAULT_CHUNK_SIZE,
    onProgress,
    signal,
  } = options;

  // 检查是否已取消
  if (signal?.aborted) {
    return { success: false, error: '保存已取消', aborted: true };
  }

  // 检查内容是否为空（空内容允许保存）
  if (!content && content !== '') {
    return { success: false, error: '保存内容不能为 null/undefined' };
  }

  // 浏览器模式：直接返回（由调用方通过 localStorage 保存）
  if (!isTauri()) {
    onProgress?.({ stage: 'done', percent: 100, message: '浏览器模式：内容由 localStorage 保存' });
    return { success: true, totalChars: charLength(content), totalBytes: byteLength(content), chunkCount: 0 };
  }

  const totalChars = charLength(content);
  const totalBytes = byteLength(content);

  // 小文本直接返回（由调用方通过普通接口保存）
  if (!shouldUseLargeTextSave(content) && totalBytes < LARGE_TEXT_THRESHOLD) {
    onProgress?.({ stage: 'done', percent: 100, message: '小文本，使用普通保存接口' });
    return { success: true, totalChars, totalBytes, chunkCount: 0 };
  }

  let sessionId = '';

  try {
    // ============ 阶段 1: 创建保存会话 ============
    onProgress?.({ stage: 'creating', percent: 0, message: '正在准备保存...' });

    if (signal?.aborted) {
      throw new DOMException('保存已取消', 'AbortError');
    }

    const chunks = splitContent(content, chunkSize);
    const totalChunksCount = chunks.length;

    const contentSha256 = await computeSha256(content);

    const createInput: TauriCreateSessionInput = {
      targetType,
      targetId: targetId || undefined,
      fieldName,
      title: title || undefined,
      totalChunks: totalChunksCount,
      totalChars,
      totalBytes,
      contentSha256,
    };

    const createResult = await tauriInvoke<TauriCreateSessionOutput>(
      'create_large_text_save_session',
      createInput as unknown as Record<string, unknown>,
    );
    sessionId = createResult.sessionId;

    if (signal?.aborted) {
      await tauriInvoke<void>('abort_large_text_save', {
        sessionId,
      });
      throw new DOMException('保存已取消', 'AbortError');
    }

    // ============ 阶段 2: 上传分片 ============
    onProgress?.({
      stage: 'uploading',
      percent: 0,
      currentChunk: 0,
      totalChunks: totalChunksCount,
      message: `正在缓存正文：0 / ${totalChunksCount}`,
    });

    for (let i = 0; i < totalChunksCount; i++) {
      if (signal?.aborted) {
        await tauriInvoke<void>('abort_large_text_save', {
          sessionId,
        });
        throw new DOMException('保存已取消', 'AbortError');
      }

      const chunk = chunks[i];
      const chunkSha256 = await computeSha256(chunk);

      const appendInput: TauriAppendChunkInput = {
        sessionId,
        chunkIndex: i,
        content: chunk,
        charCount: charLength(chunk),
        byteCount: byteLength(chunk),
        chunkSha256,
      };

      const appendResult = await tauriInvoke<TauriAppendChunkOutput>(
        'append_large_text_chunk',
        appendInput as unknown as Record<string, unknown>,
      );

      const percent = Math.round(((i + 1) / totalChunksCount) * 80); // 上传占 0-80%

      onProgress?.({
        stage: 'uploading',
        percent,
        currentChunk: i + 1,
        totalChunks: totalChunksCount,
        message: `正在缓存正文：${appendResult.savedCount} / ${totalChunksCount}`,
      });
    }

    // ============ 阶段 3: 完成保存（写入数据库） ============
    onProgress?.({
      stage: 'finalizing',
      percent: 85,
      message: '正在写入数据库...',
    });

    if (signal?.aborted) {
      await tauriInvoke<void>('abort_large_text_save', {
        sessionId,
      });
      throw new DOMException('保存已取消', 'AbortError');
    }

    const finalizeInput: TauriFinalizeInput = { sessionId };
    const finalizeResult = await tauriInvoke<TauriFinalizeOutput>(
      'finalize_large_text_save',
      finalizeInput as unknown as Record<string, unknown>,
    );

    // ============ 阶段 4: 完成 ============
    onProgress?.({
      stage: 'done',
      percent: 100,
      message: `保存完成（${totalChars} 字符）`,
    });

    return {
      success: true,
      documentId: finalizeResult.documentId,
      totalChars: finalizeResult.totalChars,
      totalBytes: finalizeResult.totalBytes,
      chunkCount: finalizeResult.chunkCount,
    };
  } catch (error: unknown) {
    const isAborted = error instanceof DOMException && error.name === 'AbortError';

    // 尝试清理
    if (sessionId && !isAborted) {
      try {
        await tauriInvoke<void>('abort_large_text_save', {
          sessionId,
        });
      } catch {
        // 清理失败不影响错误报告
      }
    }

    const errorMessage =
      error instanceof Error ? error.message : String(error);

    onProgress?.({
      stage: isAborted ? 'aborted' : 'error',
      percent: 0,
      message: isAborted ? '保存已取消' : `保存失败：${errorMessage}`,
      error: isAborted ? undefined : errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
      aborted: isAborted,
    };
  }
}

// ==================== 取消保存 ====================

/**
 * 取消正在进行的保存
 */
export async function abortLargeTextSave(sessionId: string): Promise<void> {
  if (!isTauri()) return;
  await tauriInvoke<void>('abort_large_text_save', { sessionId });
}

// ==================== 清理过期会话 ====================

/**
 * 清理超过 24 小时的过期保存会话缓存
 */
export async function cleanupExpiredSessions(): Promise<number> {
  if (!isTauri()) return 0;
  return tauriInvoke<number>('cleanup_expired_large_text_save_sessions');
}

// ==================== 便捷包装 ====================

/**
 * 智能保存：自动判断使用大文本保存还是普通保存
 *
 * @returns { useLargeText, result } - useLargeText 指示是否走了大文本链路
 */
export async function smartSaveText(
  options: CreateLargeTextSessionOptions,
  normalSaveFn?: () => Promise<void>,
): Promise<{ useLargeText: boolean; result: LargeTextSaveResult }> {
  if (shouldUseLargeTextSave(options.content)) {
    const result = await saveLargeTextWithChunks(options);
    return { useLargeText: true, result };
  }

  // 小文本走普通保存
  if (normalSaveFn) {
    try {
      await normalSaveFn();
      return {
        useLargeText: false,
        result: { success: true, totalChars: charLength(options.content), totalBytes: byteLength(options.content), chunkCount: 0 },
      };
    } catch (error: unknown) {
      return {
        useLargeText: false,
        result: {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  return {
    useLargeText: false,
    result: { success: true, totalChars: charLength(options.content), totalBytes: byteLength(options.content), chunkCount: 0 },
  };
}
