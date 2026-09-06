import { useCallback, useEffect, useRef, useState } from 'react';
import { novelRepository } from '../../services/database/novelRepository';
import type { Novel } from '../../types/novel';
import { describeUnknownError } from '../../utils/errorMessage';

/** Read state is independent from an empty library and ignores obsolete refreshes. */
export function useNovelLibrary() {
  const [novels, setNovels] = useState<Novel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const rows = await novelRepository.getAll();
      if (request === generation.current) setNovels(rows);
    } catch (cause) {
      if (request === generation.current) {
        setError(describeUnknownError(cause, '作品读取失败，请重试。'));
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  return { novels, setNovels, loading, error, reload };
}
