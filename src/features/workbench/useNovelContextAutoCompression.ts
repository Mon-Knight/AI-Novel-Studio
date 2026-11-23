import { useEffect, useRef } from 'react';
import { novelContextAutoCompressionService } from '../../services/context/novelContextAutoCompressionService';

/**
 * Subscribes the workbench asset scope preview to automatic novel context
 * compression completions triggered after chapter or volume confirmation.
 */
export function useNovelContextAutoCompression(input: {
  novelId: string;
  onCompressed?: () => void;
}) {
  const { novelId, onCompressed } = input;
  const onCompressedRef = useRef(onCompressed);
  onCompressedRef.current = onCompressed;

  useEffect(() => {
    if (!novelId) return;
    return novelContextAutoCompressionService.subscribe((event) => {
      if (event.novelId === novelId && event.result.status === 'applied') {
        onCompressedRef.current?.();
      }
    });
  }, [novelId]);
}
