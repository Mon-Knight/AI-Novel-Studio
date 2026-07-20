/**
 * AI Novel Studio - 大文本分片保存工具
 *
 * 在 Tauri 环境下使用 Rust 后端的分片保存能力，
 * 在浏览器开发模式下使用 localStorage 直接保存（不分片）。
 */

import {
  DEFAULT_CHUNK_SIZE,
  shouldUseLargeTextSave,
  type CreateLargeTextSessionOptions,
  type LargeTextSaveResult,
  type LargeTextUploadResult,
} from '../types/largeTextSave';
import { isTauriRuntime, tauriInvoke } from './tauri/runtime';

// ==================== 类型定义 ====================

interface TauriCreateSessionInput {
  targetType: string;
  targetId?: string;
  fieldName: string;
  title?: string;
  totalChunks: number;
  totalChars: number;
  totalBytes: number;
  contentSha256: string;
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
  chunkSha256: string;
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
  cleanupWarning?: string | null;
}

// ==================== 工具函数 ====================

/** 计算文本字节长度 */
function byteLength(content: string): number {
  return new Blob([content]).size;
}

/** 计算字符长度 */
function charLength(content: string): number {
  let count = 0;
  for (const _character of content) {
    count += 1;
  }
  return count;
}

/** 将文本按字符边界切分成指定大小的分片 */
function splitContent(content: string, chunkSize: number): string[] {
  if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('分片大小必须是正整数');
  }

  const chunks: string[] = [];
  let chunkStart = 0;
  let codeUnitOffset = 0;
  let chunkChars = 0;

  while (codeUnitOffset < content.length) {
    const codePoint = content.codePointAt(codeUnitOffset);
    codeUnitOffset += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    chunkChars += 1;

    if (chunkChars === chunkSize) {
      chunks.push(content.slice(chunkStart, codeUnitOffset));
      chunkStart = codeUnitOffset;
      chunkChars = 0;
    }
  }

  if (chunkStart < content.length) {
    chunks.push(content.slice(chunkStart));
  }

  return chunks;
}

function createAbortError(): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException('保存已取消', 'AbortError');
  }
  const error = new Error('保存已取消');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function tryAbortSession(sessionId: string): Promise<void> {
  if (!sessionId) return;
  try {
    await abortLargeTextSave(sessionId);
  } catch {
    // 保留原始保存错误，缓存可由过期会话清理兜底。
  }
}

function reportFailure(
  options: CreateLargeTextSessionOptions,
  error: unknown,
): LargeTextUploadResult {
  const aborted = isAbortError(error);
  const message = errorMessage(error);
  options.onProgress?.({
    stage: aborted ? 'aborted' : 'error',
    percent: 0,
    message: aborted ? '保存已取消' : `保存失败：${message}`,
    error: aborted ? undefined : message,
  });
  return {
    success: false,
    error: message,
    aborted,
  };
}

function reportDone(
  options: CreateLargeTextSessionOptions,
  totalChars: number,
): void {
  options.onProgress?.({
    stage: 'done',
    percent: 100,
    message: `保存完成（${totalChars} 字符）`,
  });
}

function validateContent(content: string): LargeTextUploadResult | null {
  if (!content && content !== '') {
    return { success: false, error: '保存内容不能为 null/undefined' };
  }
  return null;
}

function successfulDirectResult(content: string): LargeTextUploadResult {
  return {
    success: true,
    totalChars: charLength(content),
    totalBytes: byteLength(content),
    chunkCount: 0,
  };
}

/** 计算 SHA-256。Rust 校验要求整文与每个分片都必须携带哈希。 */
async function computeSha256(content: string): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('当前运行环境不支持 SHA-256，无法安全保存大文本');
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ==================== 分片上传 ====================

/**
 * 只把大文本分片写入临时缓存，并返回后续原子事务使用的会话 ID。
 * 调用方必须继续 finalize/commit，或在失败时 abort 该会话。
 */
export async function uploadLargeTextChunks(
  options: CreateLargeTextSessionOptions,
): Promise<LargeTextUploadResult> {
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

  if (signal?.aborted) {
    return reportFailure(options, createAbortError());
  }

  const invalidContent = validateContent(content);
  if (invalidContent) {
    return invalidContent;
  }

  if (!isTauriRuntime()) {
    onProgress?.({ stage: 'done', percent: 100, message: '浏览器模式：内容由 localStorage 保存' });
    return successfulDirectResult(content);
  }

  const totalChars = charLength(content);
  const totalBytes = byteLength(content);

  if (!shouldUseLargeTextSave(content)) {
    onProgress?.({ stage: 'done', percent: 100, message: '小文本，使用普通保存接口' });
    return successfulDirectResult(content);
  }

  let sessionId = '';

  try {
    onProgress?.({ stage: 'creating', percent: 0, message: '正在准备保存...' });

    if (signal?.aborted) {
      throw createAbortError();
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
      { input: createInput },
    );
    sessionId = createResult.sessionId;

    if (signal?.aborted) {
      throw createAbortError();
    }

    onProgress?.({
      stage: 'uploading',
      percent: 0,
      currentChunk: 0,
      totalChunks: totalChunksCount,
      message: `正在缓存正文：0 / ${totalChunksCount}`,
    });

    for (let i = 0; i < totalChunksCount; i++) {
      if (signal?.aborted) {
        throw createAbortError();
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
        { input: appendInput },
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

    return {
      success: true,
      sessionId,
      totalChars,
      totalBytes,
      chunkCount: totalChunksCount,
    };
  } catch (error: unknown) {
    await tryAbortSession(sessionId);
    return reportFailure(options, error);
  }
}

// ==================== 主保存函数 ====================

/** 上传分片并用通用大文本事务提交数据库。 */
export async function saveLargeTextWithChunks(
  options: CreateLargeTextSessionOptions,
): Promise<LargeTextSaveResult> {
  const uploadResult = await uploadLargeTextChunks(options);
  if (!uploadResult.success || !uploadResult.sessionId) {
    return uploadResult;
  }

  const { sessionId } = uploadResult;
  try {
    options.onProgress?.({
      stage: 'finalizing',
      percent: 85,
      message: '正在写入数据库...',
    });

    if (options.signal?.aborted) {
      throw createAbortError();
    }

    const finalizeInput: TauriFinalizeInput = { sessionId };
    const finalizeResult = await tauriInvoke<TauriFinalizeOutput>(
      'finalize_large_text_save',
      { input: finalizeInput },
    );

    if (finalizeResult.cleanupWarning) {
      console.warn('[LARGE_TEXT_CLEANUP_WARNING]', finalizeResult.cleanupWarning);
    }
    reportDone(options, finalizeResult.totalChars);

    return {
      success: true,
      documentId: finalizeResult.documentId,
      totalChars: finalizeResult.totalChars,
      totalBytes: finalizeResult.totalBytes,
      chunkCount: finalizeResult.chunkCount,
    };
  } catch (error: unknown) {
    await tryAbortSession(sessionId);
    return reportFailure(options, error);
  }
}

// ==================== 取消保存 ====================

/**
 * 取消正在进行的保存
 */
export async function abortLargeTextSave(sessionId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await tauriInvoke<void>('abort_large_text_save', { input: { sessionId } });
}

// ==================== 清理过期会话 ====================

/**
 * 清理超过 24 小时的过期保存会话缓存
 */
export async function cleanupExpiredSessions(): Promise<number> {
  if (!isTauriRuntime()) return 0;
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
