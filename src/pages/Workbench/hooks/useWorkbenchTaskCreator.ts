import { useCallback, useEffect, useRef, useState } from 'react';
import { captureTaskModelSnapshot } from '../../../services/conversation/taskModelSnapshot';
import { loadProjectTaskModel } from '../../../services/conversation/projectTaskModel';
import { submitWorkbenchTask, type WorkbenchTaskSubmissionInput } from '../workbenchTaskSubmission';

interface Input extends Pick<
  WorkbenchTaskSubmissionInput,
  | 'selectedNovelId'
  | 'chapters'
  | 'creatingTask'
  | 'contextPending'
  | 'contextFailed'
  | 'submissionRef'
  | 'validateModelForSend'
  | 'selectChapter'
  | 'createTask'
  | 'startInitializedTask'
> {
  chapterId?: string;
  initialGoal: string;
  setOpen(open: boolean): void;
  onCreated(): void;
}

/** Owns the new-task draft and project model lookup, without issuing any request on open. */
export function useWorkbenchTaskCreator(input: Input) {
  const latest = useRef(input);
  latest.current = input;
  const [goal, setGoal] = useState('');
  const [chapterId, setChapterId] = useState('');
  const [model, setModel] = useState(() => captureTaskModelSnapshot());
  const [modelSourceLabel, setModelSourceLabel] = useState('');
  const [loading, setLoading] = useState(false);
  const [resolvedNovelId, setResolvedNovelId] = useState('');
  const [error, setError] = useState('');
  const requestId = useRef(0);
  const openNovelId = useRef('');
  useEffect(
    () => () => {
      requestId.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (openNovelId.current && openNovelId.current !== input.selectedNovelId) {
      requestId.current += 1;
      openNovelId.current = '';
      setLoading(false);
      latest.current.setOpen(false);
    }
  }, [input.selectedNovelId]);
  const loadModel = useCallback(() => {
    const current = latest.current;
    setModelSourceLabel('正在读取本作品最近会话的模型…');
    setLoading(true);
    setResolvedNovelId('');
    setError('');
    const request = ++requestId.current;
    const novelId = current.selectedNovelId;
    void loadProjectTaskModel(novelId, captureTaskModelSnapshot)
      .then((saved) => {
        if (request !== requestId.current || latest.current.selectedNovelId !== novelId) return;
        setModel(saved.model);
        setModelSourceLabel(saved.sourceLabel);
        setResolvedNovelId(novelId);
      })
      .catch((failure: unknown) => {
        if (request !== requestId.current || latest.current.selectedNovelId !== novelId) return;
        setError(
          failure instanceof Error
            ? failure.message
            : '作品模型读取失败，请重新打开或明确选择本次模型。',
        );
        setModelSourceLabel('作品模型读取失败，请明确选择本次模型');
      })
      .finally(() => {
        if (request === requestId.current) setLoading(false);
      });
  }, []);
  const open = useCallback(
    (initialGoal?: string, initialChapterId?: string) => {
      const current = latest.current;
      setGoal(typeof initialGoal === 'string' ? initialGoal : current.initialGoal);
      setChapterId(initialChapterId ?? current.chapterId ?? '');
      openNovelId.current = current.selectedNovelId;
      current.setOpen(true);
      loadModel();
    },
    [loadModel],
  );
  const close = useCallback(() => {
    const current = latest.current;
    if (current.creatingTask || current.submissionRef.current) return;
    requestId.current += 1;
    openNovelId.current = '';
    setLoading(false);
    current.setOpen(false);
  }, []);
  const changeModel = (value: string) => {
    if (loading || input.creatingTask) return;
    const [providerId, ...modelId] = value.split(':');
    try {
      setModel(captureTaskModelSnapshot(providerId, modelId.join(':')));
      setModelSourceLabel('本次会话手动选择；创建后保存为会话默认模型');
      setResolvedNovelId(input.selectedNovelId);
      setError('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '模型配置不可用。');
    }
  };
  const submit = () =>
    submitWorkbenchTask({
      ...input,
      goal,
      requestedChapterId: chapterId,
      taskModel: model,
      creatingTask: input.creatingTask || loading || resolvedNovelId !== input.selectedNovelId,
      onError: setError,
      onCreated: () => {
        input.onCreated();
        input.setOpen(false);
      },
    });
  return {
    open,
    model,
    formProps: {
      goal,
      chapterId,
      selectedModel: model,
      modelSourceLabel,
      creating: input.creatingTask,
      modelPending: loading,
      modelUnresolved: resolvedNovelId !== input.selectedNovelId,
      onRetryModelSource: loadModel,
      error,
      onGoalChange: setGoal,
      onChapterChange: setChapterId,
      onModelChange: changeModel,
      onSubmit: () => void submit(),
      onCancel: close,
    },
  };
}
