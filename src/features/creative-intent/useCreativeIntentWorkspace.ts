import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createAuthorStatement,
  creativeIntentService,
  isCreativeIntentConcurrencyConflict,
  snapshotToCreativeIntentInput,
} from '../../services/ai-tasks/creativeIntentService';
import { novelService } from '../../services/novels/novelService';
import type {
  CreativeIntentRecordV1,
  CreativeIntentStatementInputV1,
} from '../../types/creativeIntent';
import { describeUnknownError } from '../../utils/errorMessage';
import {
  buildFreezeCreativeIntentInput,
  deriveCreativeIntentDraftState,
  serializeCreativeIntentDraft,
} from './creativeIntentDraft';

export type CreativeIntentErrorKind = 'load' | 'freeze' | 'conflict';

export function useCreativeIntentWorkspace(novelId: string | undefined) {
  const [novelTitle, setNovelTitle] = useState('');
  const [loadedNovelId, setLoadedNovelId] = useState<string | null>(null);
  const [record, setRecord] = useState<CreativeIntentRecordV1 | null>(null);
  const [statements, setStatements] = useState<CreativeIntentStatementInputV1[]>([]);
  const [baseline, setBaseline] = useState('[]');
  const [loading, setLoading] = useState(true);
  const [loadReady, setLoadReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [errorKind, setErrorKind] = useState<CreativeIntentErrorKind>('load');
  const [message, setMessage] = useState('');
  const loadGenerationRef = useRef(0);
  const mutationGenerationRef = useRef(0);
  const savingLockRef = useRef(false);
  const activeNovelIdRef = useRef(novelId);
  activeNovelIdRef.current = novelId;

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    mutationGenerationRef.current += 1;
    savingLockRef.current = false;
    setSaving(false);
    setLoadReady(false);
    setNovelTitle('');
    setLoadedNovelId(null);
    setRecord(null);
    setStatements([]);
    setBaseline('[]');
    if (!novelId) {
      setError('缺少作品标识，无法读取创作意图。');
      setErrorKind('load');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const [novel, latest] = await Promise.all([
        novelService.getNovelById(novelId),
        creativeIntentService.getLatest(novelId),
      ]);
      if (generation !== loadGenerationRef.current) return;
      if (!novel) throw new Error('作品不存在或已删除。');
      const nextStatements = latest ? snapshotToCreativeIntentInput(latest.intent) : [];
      setNovelTitle(novel.title);
      setLoadedNovelId(novelId);
      setRecord(latest);
      setStatements(nextStatements);
      setBaseline(serializeCreativeIntentDraft(nextStatements));
      setLoadReady(true);
    } catch (loadError) {
      if (generation !== loadGenerationRef.current) return;
      setErrorKind('load');
      setError(describeUnknownError(loadError, '读取创作意图失败，请重试。'));
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, [novelId]);

  useEffect(() => {
    void load();
    return () => {
      loadGenerationRef.current += 1;
      mutationGenerationRef.current += 1;
      savingLockRef.current = false;
    };
  }, [load]);

  const draftState = useMemo(
    () => deriveCreativeIntentDraftState(statements, baseline, record, loadReady),
    [baseline, loadReady, record, statements],
  );

  const freeze = useCallback(async () => {
    if (!novelId || !loadReady || savingLockRef.current
        || draftState.blockingReasons.length > 0) return;
    const submittedNovelId = novelId;
    const generation = ++mutationGenerationRef.current;
    savingLockRef.current = true;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const frozen = await creativeIntentService.freeze(
        buildFreezeCreativeIntentInput(novelId, record, statements),
      );
      if (generation !== mutationGenerationRef.current
          || activeNovelIdRef.current !== submittedNovelId) return;
      const nextStatements = snapshotToCreativeIntentInput(frozen.intent);
      setRecord(frozen);
      setStatements(nextStatements);
      setBaseline(serializeCreativeIntentDraft(nextStatements));
      setMessage(frozen.idempotentReplay
        ? `第 ${frozen.intent.revision} 版已安全恢复，没有重复写入。`
        : `第 ${frozen.intent.revision} 版创作意图已冻结。`);
    } catch (freezeError) {
      if (generation !== mutationGenerationRef.current
          || activeNovelIdRef.current !== submittedNovelId) return;
      setErrorKind(isCreativeIntentConcurrencyConflict(freezeError) ? 'conflict' : 'freeze');
      setError(describeUnknownError(freezeError, '冻结失败，请检查内容后重试。'));
    } finally {
      if (generation === mutationGenerationRef.current) {
        savingLockRef.current = false;
        setSaving(false);
      }
    }
  }, [draftState.blockingReasons.length, loadReady, novelId, record, statements]);

  const addStatement = useCallback(() => {
    setStatements((current) => [...current, createAuthorStatement()]);
  }, []);

  const changeStatement = useCallback((
    index: number,
    statement: CreativeIntentStatementInputV1,
  ) => {
    setStatements((current) => (
      current.map((item, itemIndex) => itemIndex === index ? statement : item)
    ));
  }, []);

  const removeStatement = useCallback((index: number) => {
    setStatements((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }, []);

  return {
    novelTitle,
    record,
    statements,
    loading: loading || (loadedNovelId !== null && loadedNovelId !== novelId),
    loadReady,
    saving,
    error,
    errorKind,
    message,
    draftState,
    load,
    freeze,
    addStatement,
    changeStatement,
    removeStatement,
  };
}
