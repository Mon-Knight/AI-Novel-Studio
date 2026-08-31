import { useCallback, useEffect, useRef, useState } from 'react';
import {
  workbenchAssetScopeService,
  type WorkbenchAssetScopeSummary,
} from '../../../services/conversation/workbenchAssetScopeService';
import { describeUnknownError } from '../../../utils/errorMessage';

export function useWorkbenchAssetScope(input: {
  novelId: string;
  chapterId?: string;
  volumeId?: string;
  refreshKey?: string;
}) {
  const [summary, setSummary] = useState<WorkbenchAssetScopeSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    if (!input.novelId) {
      setSummary(null);
      setLoading(false);
      setError('');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const next = await workbenchAssetScopeService.load({
        novelId: input.novelId,
        chapterId: input.chapterId,
        volumeId: input.volumeId,
      });
      if (request !== requestRef.current) return;
      setSummary(next);
    } catch (reason) {
      if (request !== requestRef.current) return;
      setSummary(null);
      setError(describeUnknownError(reason, '可用创作上下文读取失败'));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [input.chapterId, input.novelId, input.volumeId]);

  useEffect(() => {
    void refresh();
  }, [input.refreshKey, refresh]);

  return { summary, loading, error, refresh };
}
