import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { AiStreamEvent } from '../../../types/ai';

export type StreamPreviewStatus = 'idle' | 'streaming' | 'completed' | 'interrupted';

export function useGenerationStreamPreview(
  liveNovelIdRef: MutableRefObject<string>,
  liveChapterIdRef: MutableRefObject<string>,
) {
  const [streamPreview, setStreamPreview] = useState('');
  const [streamPreviewStatus, setStreamPreviewStatus] = useState<StreamPreviewStatus>('idle');
  const streamBufferRef = useRef('');
  const streamFlushTimerRef = useRef<number | undefined>(undefined);

  const flushStreamPreview = useCallback(() => {
    if (streamFlushTimerRef.current !== undefined) {
      window.clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = undefined;
    }
    setStreamPreview(streamBufferRef.current);
  }, []);

  const beginStreamPreview = useCallback(() => {
    streamBufferRef.current = '';
    setStreamPreview('');
    setStreamPreviewStatus('streaming');
  }, []);

  const resetStreamPreview = useCallback(() => {
    streamBufferRef.current = '';
    setStreamPreview('');
    setStreamPreviewStatus('idle');
    if (streamFlushTimerRef.current !== undefined) {
      window.clearTimeout(streamFlushTimerRef.current);
      streamFlushTimerRef.current = undefined;
    }
  }, []);

  const handleStreamEvent = useCallback(
    (event: AiStreamEvent, target: { novelId: string; chapterId: string }) => {
      if (
        liveNovelIdRef.current !== target.novelId ||
        liveChapterIdRef.current !== target.chapterId
      )
        return;
      if (event.type === 'delta') {
        streamBufferRef.current += event.text;
        if (streamFlushTimerRef.current === undefined) {
          streamFlushTimerRef.current = window.setTimeout(flushStreamPreview, 80);
        }
      } else if (event.type === 'completed') {
        flushStreamPreview();
        setStreamPreviewStatus('completed');
      } else if (event.type === 'error') {
        flushStreamPreview();
        setStreamPreviewStatus('interrupted');
      }
    },
    [flushStreamPreview, liveChapterIdRef, liveNovelIdRef],
  );

  useEffect(
    () => () => {
      if (streamFlushTimerRef.current !== undefined) {
        window.clearTimeout(streamFlushTimerRef.current);
      }
    },
    [],
  );

  return {
    streamPreview,
    streamPreviewStatus,
    streamBufferRef,
    setStreamPreviewStatus,
    flushStreamPreview,
    beginStreamPreview,
    resetStreamPreview,
    handleStreamEvent,
  };
}
