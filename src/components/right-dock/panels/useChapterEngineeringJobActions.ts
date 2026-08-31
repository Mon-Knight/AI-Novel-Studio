import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { generationJobService } from '../../../services/generation/generationJobService';
import type { Chapter } from '../../../types/chapter';
import type { GenerationJob, GenerationStepResult } from '../../../types/generationJob';
import { isActiveGenerationJob, isTerminalGenerationJob } from './chapterEngineeringPanelSupport';

interface UseChapterEngineeringJobActionsOptions {
  chapter?: Chapter;
  effectiveNovelId?: string;
  currentEditorContent?: string;
  dirty: boolean;
  latestJob: GenerationJob | null;
  jobRunEpochRef: MutableRefObject<number>;
  liveNovelIdRef: MutableRefObject<string>;
  liveChapterIdRef: MutableRefObject<string>;
  setLatestJob: Dispatch<SetStateAction<GenerationJob | null>>;
  setJobSteps: Dispatch<SetStateAction<GenerationStepResult[]>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string>>;
}

export function useChapterEngineeringJobActions({
  chapter,
  effectiveNovelId,
  currentEditorContent,
  dirty,
  latestJob,
  jobRunEpochRef,
  liveNovelIdRef,
  liveChapterIdRef,
  setLatestJob,
  setJobSteps,
  setMessage,
  setError,
}: UseChapterEngineeringJobActionsOptions) {
  const [jobRunning, setJobRunning] = useState(false);
  const hasActiveJob = isActiveGenerationJob(latestJob);

  const applyJobUpdate = (incoming: GenerationJob) => {
    setLatestJob((current) => {
      if (current?.id === incoming.id && isTerminalGenerationJob(current)) return current;
      return incoming;
    });
  };

  const handleRunMockJob = async () => {
    if (!chapter?.id || !effectiveNovelId) {
      setError('请先选择章节');
      return;
    }
    if (dirty) {
      setError('请先保存并应用当前工程修改，再启动 Mock 任务。');
      return;
    }
    if (hasActiveJob) {
      setError('当前章节已有生成任务正在运行。');
      return;
    }
    setJobRunning(true);
    setError('');
    setMessage('正在运行 Mock 生成任务...');
    const requestNovelId = effectiveNovelId;
    const requestChapterId = chapter.id;
    const requestEpoch = ++jobRunEpochRef.current;
    try {
      const finalJob = await generationJobService.runMockChapterJob(
        {
          novelId: requestNovelId,
          volumeId: chapter.volumeId,
          chapterId: chapter.id,
          currentEditorContent,
        },
        (job, steps) => {
          if (
            jobRunEpochRef.current === requestEpoch &&
            liveNovelIdRef.current === requestNovelId &&
            liveChapterIdRef.current === requestChapterId
          ) {
            applyJobUpdate(job);
            setJobSteps(steps);
          }
        },
      );
      const steps = await generationJobService.getSteps(finalJob.id);
      if (
        jobRunEpochRef.current !== requestEpoch ||
        liveNovelIdRef.current !== requestNovelId ||
        liveChapterIdRef.current !== requestChapterId
      )
        return;
      applyJobUpdate(finalJob);
      setJobSteps(steps);
      setMessage(`Mock 任务已${finalJob.status === 'completed' ? '完成' : finalJob.status}`);
    } catch (e: unknown) {
      if (
        jobRunEpochRef.current === requestEpoch &&
        liveNovelIdRef.current === requestNovelId &&
        liveChapterIdRef.current === requestChapterId
      ) {
        setError(e instanceof Error ? e.message : 'Mock 生成任务失败');
        setMessage('');
      }
    } finally {
      if (
        jobRunEpochRef.current === requestEpoch &&
        liveNovelIdRef.current === requestNovelId &&
        liveChapterIdRef.current === requestChapterId
      ) {
        setJobRunning(false);
      }
    }
  };

  const handleCancelJob = async () => {
    if (
      !latestJob ||
      latestJob.status === 'completed' ||
      latestJob.status === 'failed' ||
      latestJob.status === 'cancelled'
    )
      return;
    setError('');
    try {
      const cancelled = await generationJobService.cancel(latestJob.id);
      if (cancelled) {
        applyJobUpdate(cancelled);
        setJobSteps(await generationJobService.getSteps(cancelled.id));
        setMessage('任务已取消');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '任务取消失败');
    }
  };

  return {
    applyJobUpdate,
    handleCancelJob,
    handleRunMockJob,
    hasActiveJob,
    jobRunning,
    setJobRunning,
  };
}
