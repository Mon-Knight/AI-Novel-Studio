import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCurrentPluginProjection,
  safePluginErrorText,
  type CurrentPluginProjection,
} from '../../../services/conversation/currentPluginService';
import type { TaskModelSnapshot } from '../../../types/conversation';

export type WorkbenchPluginRefreshSource = 'foreground' | 'background';

interface VisibleRefreshRequest {
  id: number;
  source: WorkbenchPluginRefreshSource;
}

export function useWorkbenchPlugins(taskCreatorOpen = false) {
  const [plugins, setPlugins] = useState<CurrentPluginProjection[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(true);
  const [pluginsError, setPluginsError] = useState('');
  const [showPlugins, setShowPlugins] = useState(false);
  const requestSequenceRef = useRef(0);
  const visibleRequestRef = useRef<VisibleRefreshRequest | null>(null);
  const activeForegroundRequestRef = useRef<number | null>(null);
  const taskCreatorOpenRef = useRef(taskCreatorOpen);
  const previousTaskCreatorOpenRef = useRef(taskCreatorOpen);
  taskCreatorOpenRef.current = taskCreatorOpen;

  useEffect(() => {
    const opened = taskCreatorOpen && !previousTaskCreatorOpenRef.current;
    previousTaskCreatorOpenRef.current = taskCreatorOpen;
    if (!opened) return;

    // A background refresh may have started while the creator was closed. Once
    // the creator opens, that request is no longer allowed to own the visible
    // loading state; otherwise its late finally block can leave the creator
    // showing a permanent "refreshing" state.
    if (visibleRequestRef.current?.source === 'background') {
      visibleRequestRef.current = null;
      setPluginsLoading(false);
    }
  }, [taskCreatorOpen]);

  const refreshPlugins = useCallback(
    async (
      conversationId?: string,
      allowProbe = false,
      modelSnapshot?: TaskModelSnapshot,
      source: WorkbenchPluginRefreshSource = 'foreground',
    ) => {
      const isBackground = source === 'background';
      const requestId = requestSequenceRef.current + 1;
      requestSequenceRef.current = requestId;
      const target = conversationId?.trim() || (allowProbe ? '__ans_plugin_probe__' : undefined);
      const publishToVisibleState =
        !isBackground ||
        (!taskCreatorOpenRef.current && activeForegroundRequestRef.current === null);
      if (publishToVisibleState) {
        visibleRequestRef.current = { id: requestId, source };
        setPluginsLoading(true);
        setPluginsError('');
      }
      if (!isBackground) activeForegroundRequestRef.current = requestId;

      const ownsVisibleState = () => {
        const request = visibleRequestRef.current;
        return request?.id === requestId && (!isBackground || !taskCreatorOpenRef.current);
      };

      try {
        const current = await getCurrentPluginProjection(target, modelSnapshot);
        if (ownsVisibleState()) setPlugins(current);
        return current;
      } catch (error) {
        if (ownsVisibleState()) {
          setPluginsError(safePluginErrorText(error, 'Runtime 模型目录刷新失败，请稍后重试。'));
        }
        throw error;
      } finally {
        const ownsRequest = visibleRequestRef.current?.id === requestId;
        // The open-state effect normally releases a background owner as soon
        // as the creator opens. Keep this id check as a late-completion guard
        // for a render/effect and Promise continuation that cross each other.
        if (ownsRequest && (ownsVisibleState() || isBackground)) {
          visibleRequestRef.current = null;
          setPluginsLoading(false);
        }
        if (!isBackground && activeForegroundRequestRef.current === requestId) {
          activeForegroundRequestRef.current = null;
        }
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
