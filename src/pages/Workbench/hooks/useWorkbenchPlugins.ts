import { useCallback, useState } from 'react';
import {
  getCurrentPluginProjection,
  type CurrentPluginProjection,
} from '../../../services/conversation/currentPluginService';

export function useWorkbenchPlugins() {
  const [plugins, setPlugins] = useState<CurrentPluginProjection[]>([]);
  const [showPlugins, setShowPlugins] = useState(false);

  const refreshPlugins = useCallback(async (conversationId?: string, allowProbe = false) => {
    const target = conversationId?.trim() || (allowProbe ? '__ans_plugin_probe__' : undefined);
    const current = await getCurrentPluginProjection(target);
    setPlugins(current);
  }, []);

  return {
    plugins,
    setPlugins,
    showPlugins,
    setShowPlugins,
    refreshPlugins,
  };
}
