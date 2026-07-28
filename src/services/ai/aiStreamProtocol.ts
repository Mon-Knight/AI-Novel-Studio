import type { AiStreamEvent } from '../../types/ai';

export const AI_STREAM_EVENT_NAME = 'ai-stream-event';
export const AI_STREAM_INTERRUPTED_ERROR =
  'AI 调用失败：流式响应在完成标记前中断，当前残片未保存；请重试。';
export const AI_STREAM_INVALID_ERROR =
  'AI 调用失败：模型服务返回了无效的流式响应，请检查兼容接口或重试。';

const MAX_BUFFERED_SSE_CHARS = 2_000_000;

function findBoundary(value: string): { index: number; length: number } | undefined {
  const candidates = [
    { index: value.indexOf('\r\n\r\n'), length: 4 },
    { index: value.indexOf('\n\n'), length: 2 },
    { index: value.indexOf('\r\r'), length: 2 },
  ].filter((candidate) => candidate.index >= 0);
  return candidates.sort((left, right) => left.index - right.index)[0];
}

function readData(frame: string): string | undefined {
  const dataLines = frame
    .split(/\r\n|\n|\r/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => {
      const value = line.slice(5);
      return value.startsWith(' ') ? value.slice(1) : value;
    });
  return dataLines.length > 0 ? dataLines.join('\n') : undefined;
}

/** Incremental UTF-8/SSE decoder shared by browser streaming and its transport tests. */
export class OpenAiSseDecoder {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private buffer = '';

  push(chunk: Uint8Array): string[] {
    try {
      this.buffer += this.decoder.decode(chunk, { stream: true });
    } catch {
      throw new Error(AI_STREAM_INVALID_ERROR);
    }
    return this.takeFrames(false);
  }

  finish(): string[] {
    try {
      this.buffer += this.decoder.decode();
    } catch {
      throw new Error(AI_STREAM_INVALID_ERROR);
    }
    return this.takeFrames(true);
  }

  private takeFrames(flush: boolean): string[] {
    if (this.buffer.length > MAX_BUFFERED_SSE_CHARS) {
      throw new Error(AI_STREAM_INVALID_ERROR);
    }
    const payloads: string[] = [];
    for (;;) {
      const boundary = findBoundary(this.buffer);
      if (!boundary) break;
      const frame = this.buffer.slice(0, boundary.index);
      this.buffer = this.buffer.slice(boundary.index + boundary.length);
      const data = readData(frame);
      if (data !== undefined) payloads.push(data);
    }
    if (flush && this.buffer.trim()) {
      const data = readData(this.buffer);
      this.buffer = '';
      if (data !== undefined) payloads.push(data);
    }
    return payloads;
  }
}

export function emitAiStreamEvent(
  handler: ((event: AiStreamEvent) => void) | undefined,
  event: AiStreamEvent,
): void {
  if (!handler) return;
  try {
    handler(event);
  } catch {
    // UI observers are deliberately isolated from the transport lifecycle.
  }
}
