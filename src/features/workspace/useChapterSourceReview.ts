import { useCallback, useEffect, useRef, useState } from 'react';
import type { SaveRuleSystemInput } from '../../types/setting';
import type { WorldRuleChange } from '../../types/worldRules';
import {
  loadChapterSourceReview,
  previewChapterSourceCorrection,
  saveChapterSourceCorrection,
  type ChapterSourceReviewSnapshot,
  type SourceReviewAsset,
} from '../../services/worldRules/chapterSourceReview';

interface ReviewState {
  scope: string;
  snapshot?: ChapterSourceReviewSnapshot;
  error: string;
  refreshing: boolean;
  saving: boolean;
  revision: number;
  savedTitles: string[];
}

function initialState(scope: string): ReviewState {
  return { scope, error: '', refreshing: true, saving: false, revision: 0, savedTitles: [] };
}

export function useChapterSourceReview(novelId: string, chapterId: string, draftId: string) {
  const scope = JSON.stringify([novelId, chapterId, draftId]);
  const [state, setState] = useState(() => initialState(scope));
  const [reload, setReload] = useState(0);
  const epoch = useRef(0);
  const saveLock = useRef(false);
  const latest = useRef(state);
  const currentScope = useRef(scope);
  latest.current = state;
  currentScope.current = scope;
  // Never expose a previous chapter's source during the render before its effect runs.
  const active = state.scope === scope ? state : initialState(scope);
  const snapshot = active.snapshot;
  useEffect(() => {
    const loadEpoch = ++epoch.current;
    const previous = latest.current;
    const retained = previous.scope === scope ? previous.snapshot : undefined;
    saveLock.current = false;
    setState({
      ...initialState(scope),
      snapshot: retained,
      revision: previous.revision + 1,
      savedTitles: previous.scope === scope ? previous.savedTitles : [],
    });
    void loadChapterSourceReview(novelId, chapterId, draftId)
      .then((value) => {
        if (epoch.current !== loadEpoch || currentScope.current !== scope) return;
        if (retained && retained.contentHash !== value.contentHash) {
          throw new Error('CHAPTER_SOURCE_CHANGED: 采用正文已变化，请重新打开核对并预览影响。');
        }
        setState((current) => ({ ...current, snapshot: value, refreshing: false }));
      })
      .catch((reason: unknown) => {
        if (epoch.current !== loadEpoch || currentScope.current !== scope) return;
        setState((current) => ({
          ...current,
          refreshing: false,
          error: reason instanceof Error ? reason.message : '源设定读取失败',
        }));
      });
    return () => {
      epoch.current = loadEpoch + 1;
    };
  }, [novelId, chapterId, draftId, scope, reload]);
  const preview = useCallback(
    async (change: WorldRuleChange) => {
      if (!snapshot || active.refreshing || active.error || currentScope.current !== scope)
        throw new Error('请先成功刷新当前源材料，再预览修改。');
      const token = epoch.current;
      const result = await previewChapterSourceCorrection(snapshot, change);
      if (epoch.current !== token || currentScope.current !== scope)
        throw new Error('源材料已刷新，请重新预览修改。');
      return result;
    },
    [snapshot, active.refreshing, active.error, scope],
  );
  const save = useCallback(
    async (asset: SourceReviewAsset, input: Omit<SaveRuleSystemInput, 'novelId'>) => {
      if (!snapshot || active.refreshing || active.error || currentScope.current !== scope)
        throw new Error('请先成功刷新当前源材料，再预览修改。');
      if (saveLock.current) throw new Error('正在保存源设定，请勿重复提交。');
      const token = epoch.current;
      saveLock.current = true;
      setState((current) => ({ ...current, saving: true }));
      try {
        const saved = await saveChapterSourceCorrection(snapshot, asset, input);
        if (epoch.current !== token || currentScope.current !== scope)
          throw new Error('核对范围已变化，请重新读取正式版本。');
        setState((current) => ({
          ...current,
          savedTitles: [...new Set([...current.savedTitles, saved.title])],
          snapshot: current.snapshot && {
            ...current.snapshot,
            assets: current.snapshot.assets.map((item) =>
              item.kind === asset.kind && item.record.id === saved.id
                ? { ...item, record: saved }
                : item,
            ),
          },
        }));
      } finally {
        if (epoch.current === token && currentScope.current === scope) {
          saveLock.current = false;
          setState((current) => ({ ...current, saving: false }));
        }
      }
    },
    [snapshot, active.refreshing, active.error, scope],
  );
  return {
    snapshot,
    error: active.error,
    refreshing: active.refreshing,
    saving: active.saving,
    revision: active.revision,
    savedTitles: active.savedTitles,
    preview,
    save,
    refresh: () => {
      if (!saveLock.current && !active.refreshing) setReload((value) => value + 1);
    },
  };
}
