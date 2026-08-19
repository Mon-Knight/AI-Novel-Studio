import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { aiSettingsService } from '../../../services/ai/aiClient';
import {
  generateChapterScenePlanCandidates,
  type ChapterScenePlanCandidate,
} from '../../../services/ai/chapterScenePlanService';
import { chapterEngineeringService } from '../../../services/engineering/chapterEngineeringService';
import { generationContextCompiler } from '../../../services/generation/generationContextCompiler';
import type { Chapter } from '../../../types/chapter';
import type {
  ChapterEngineeringBundle,
  ChapterEngineeringState,
  ScenePlanItem,
} from '../../../types/chapterEngineering';
import type { TabId } from './chapterEngineeringPanelSupport';

type PersistDraft = (
  scenePlanOverride?: ScenePlanItem[],
) => Promise<ChapterEngineeringState | null>;

interface UseChapterScenePlanCandidateOptions {
  chapter?: Chapter;
  effectiveNovelId?: string;
  currentEditorContent?: string;
  dirty: boolean;
  persistDraft: PersistDraft;
  setActiveTab: Dispatch<SetStateAction<TabId>>;
  setBundle: Dispatch<SetStateAction<ChapterEngineeringBundle | null>>;
  setScenePlan: Dispatch<SetStateAction<ScenePlanItem[]>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
}

interface BoundChapterScenePlanCandidate {
  novelId: string;
  chapterId: string;
  requestEpoch: number;
  value: ChapterScenePlanCandidate;
}

export function useChapterScenePlanCandidate({
  chapter,
  effectiveNovelId,
  currentEditorContent,
  dirty,
  persistDraft,
  setActiveTab,
  setBundle,
  setScenePlan,
  setDirty,
  setBusy,
  setMessage,
  setError,
}: UseChapterScenePlanCandidateOptions) {
  const [running, setRunning] = useState(false);
  const [candidate, setCandidate] = useState<BoundChapterScenePlanCandidate | null>(null);
  const liveNovelIdRef = useRef(effectiveNovelId ?? '');
  const liveChapterIdRef = useRef(chapter?.id ?? '');
  const requestEpochRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);
  liveNovelIdRef.current = effectiveNovelId ?? '';
  liveChapterIdRef.current = chapter?.id ?? '';

  useEffect(() => {
    requestEpochRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setRunning(false);
    setCandidate(null);
    return () => {
      requestEpochRef.current += 1;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, [effectiveNovelId, chapter?.id]);

  const isRequestCurrent = (
    requestNovelId: string,
    requestChapterId: string,
    requestEpoch: number,
    controller: AbortController,
  ) =>
    !controller.signal.aborted &&
    requestEpochRef.current === requestEpoch &&
    liveNovelIdRef.current === requestNovelId &&
    liveChapterIdRef.current === requestChapterId;

  const isCandidateCurrent = (target: BoundChapterScenePlanCandidate) =>
    requestEpochRef.current === target.requestEpoch &&
    liveNovelIdRef.current === target.novelId &&
    liveChapterIdRef.current === target.chapterId;

  const generateCandidate = async () => {
    if (!chapter?.id || !effectiveNovelId) {
      setError('请先选择章节');
      return;
    }
    if (dirty) {
      setError('请先保存并应用当前工程修改，再生成 Scene/Beat 候选。');
      return;
    }
    const requestNovelId = effectiveNovelId;
    const requestChapterId = chapter.id;
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const requestEpoch = ++requestEpochRef.current;
    setRunning(true);
    setCandidate(null);
    setError('');
    setMessage('正在使用全局 Provider 生成 Scene/Beat 候选...');
    try {
      if (!isRequestCurrent(requestNovelId, requestChapterId, requestEpoch, controller)) return;
      const snapshot = await generationContextCompiler.compileAndSave({
        novelId: requestNovelId,
        volumeId: chapter.volumeId,
        chapterId: requestChapterId,
        currentEditorContent,
      });
      if (!isRequestCurrent(requestNovelId, requestChapterId, requestEpoch, controller)) return;
      if (snapshot.novelId !== requestNovelId || snapshot.chapterId !== requestChapterId) {
        throw new Error('Scene/Beat 上下文快照与当前章节不一致，请重新生成。');
      }
      const nextCandidate = await generateChapterScenePlanCandidates({
        novelId: requestNovelId,
        chapterId: requestChapterId,
        operationId: `scene-plan:${requestChapterId}:${Date.now()}`,
        settings: aiSettingsService.getSettings(),
        snapshot,
        chapter,
        signal: controller.signal,
      });
      if (!isRequestCurrent(requestNovelId, requestChapterId, requestEpoch, controller)) return;
      setCandidate({
        novelId: requestNovelId,
        chapterId: requestChapterId,
        requestEpoch,
        value: nextCandidate,
      });
      setActiveTab('scenes');
      setMessage(`已生成 ${nextCandidate.scenes.length} 个 Scene 候选，请确认后保存或应用。`);
    } catch (error: unknown) {
      if (isRequestCurrent(requestNovelId, requestChapterId, requestEpoch, controller)) {
        setError(error instanceof Error ? error.message : 'Scene/Beat 候选生成失败');
        setMessage('');
      }
    } finally {
      if (isRequestCurrent(requestNovelId, requestChapterId, requestEpoch, controller)) {
        abortControllerRef.current = null;
        setRunning(false);
      }
    }
  };

  const saveCandidate = async (apply: boolean) => {
    if (!chapter?.id || !candidate) return;
    if (!isCandidateCurrent(candidate)) {
      setCandidate(null);
      setError('Scene/Beat 候选所属章节已变化，请重新生成。');
      setMessage('');
      return;
    }
    setBusy(true);
    setError('');
    setMessage(apply ? '正在保存并应用 Scene/Beat 候选...' : '正在保存 Scene/Beat 候选草稿...');
    try {
      const saved = await persistDraft(candidate.value.scenes);
      if (!saved) return;
      if (!isCandidateCurrent(candidate)) return;
      if (saved.novelId !== candidate.novelId || saved.chapterId !== candidate.chapterId) {
        throw new Error('Scene/Beat 候选保存结果与当前章节不一致。');
      }
      setScenePlan(candidate.value.scenes);
      if (apply) {
        if (!isCandidateCurrent(candidate)) return;
        const active = await chapterEngineeringService.activate(
          saved.id,
          candidate.chapterId,
          chapter,
        );
        if (!isCandidateCurrent(candidate)) return;
        const nextBundle = await chapterEngineeringService.getBundle(candidate.chapterId, chapter);
        if (!isCandidateCurrent(candidate)) return;
        setBundle(nextBundle);
        setDirty(false);
        setCandidate(null);
        setMessage(`Scene/Beat 候选已应用 active v${active.draftVersion}`);
      } else {
        setMessage(`Scene/Beat 候选已保存为草稿 v${saved.draftVersion}`);
      }
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Scene/Beat 候选保存失败');
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  return {
    scenePlanRunning: running,
    scenePlanCandidate: candidate?.value.scenes ?? null,
    handleGenerateScenePlan: generateCandidate,
    handleSaveScenePlanCandidate: saveCandidate,
  };
}
