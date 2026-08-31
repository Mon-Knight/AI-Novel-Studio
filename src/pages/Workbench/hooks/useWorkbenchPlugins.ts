import { useCallback, useRef, useState } from 'react';
import {
  getCurrentPluginProjection,
  safePluginErrorText,
  type CurrentPluginProjection,
} from '../../../services/conversation/currentPluginService';
import type { TaskModelSnapshot } from '../../../types/conversation';

export function useWorkbenchPlugins() {
  const [plugins, setPlugins] = useState<CurrentPluginProjection[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(true);
  const [pluginsError, setPluginsError] = useState('');
  const [showPlugins, setShowPlugins] = useState(false);
  const latestRequestRef = useRef(0);

  const refreshPlugins = useCallback(
    async (conversationId?: string, allowProbe = false, modelSnapshot?: TaskModelSnapshot) => {
      const requestId = latestRequestRef.current + 1;
      latestRequestRef.current = requestId;
      const target = conversationId?.trim() || (allowProbe ? '__ans_plugin_probe__' : undefined);
      setPluginsLoading(true);
      setPluginsError('');
      try {
        const current = await getCurrentPluginProjection(target, modelSnapshot);
        if (latestRequestRef.current === requestId) setPlugins(current);
        return current;
      } catch (error) {
        if (latestRequestRef.current === requestId) {
          setPluginsError(safePluginErrorText(error, 'Runtime 模型目录刷新失败，请稍后重试。'));
        }
        throw error;
      } finally {
        if (latestRequestRef.current === requestId) setPluginsLoading(false);
      }
    },
    [],
  );

  return {
    plugins,
    setPlugins,
    pluginsLoading,
    pluginsError,
    showPlugins,
    setShowPlugins,
    refreshPlugins,
  };
}
