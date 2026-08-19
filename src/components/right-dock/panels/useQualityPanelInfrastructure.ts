import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChapterDraft } from '../../../types/ai';
import type { QualityCheckItem, QualityCheckReport } from '../../../types/qualityCheck';
import { qualityCheckService } from '../../../services/quality/qualityCheckService';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { appLogger } from '../../../services/observability/appLogger';
import type { QualityOperationPhase } from './CheckPanelView';

interface UseQualityPanelInfrastructureOptions {
  novelId?: string;
  chapterId?: string;
  reportProp?: QualityCheckReport | null;
  itemsProp?: QualityCheckItem[];
  onChange?: (report: QualityCheckReport | null, items: QualityCheckItem[]) => void;
  onError: (message: string) => void;
}

export function useQualityPanelInfrastructure({
  novelId,
  chapterId,
  reportProp,
  itemsProp,
  onChange,
  onError,
}: UseQualityPanelInfrastructureOptions) {
  const liveChapterIdRef = useRef(chapterId || '');
  liveChapterIdRef.current = chapterId || '';
  const liveNovelIdRef = useRef(novelId || '');
  liveNovelIdRef.current = novelId || '';
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const loadEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const activeOperationRef = useRef<AbortController | null>(null);
  const operationPhaseRef = useRef<QualityOperationPhase>('idle');

  const [report, setReport] = useState<QualityCheckReport | null>(reportProp ?? null);
  const [items, setItems] = useState<QualityCheckItem[]>(itemsProp ?? []);
  const [currentDraft, setCurrentDraft] = useState<ChapterDraft | null>(null);
  const [historyReports, setHistoryReports] = useState<QualityCheckReport[]>([]);
  const [selectedReportId, setSelectedReportId] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [operationPhase, setOperationPhase] = useState<QualityOperationPhase>('idle');

  useEffect(() => {
    if (reportProp !== undefined) setReport(reportProp);
  }, [reportProp]);
  useEffect(() => {
    if (itemsProp !== undefined) setItems(itemsProp);
  }, [itemsProp]);

  const syncUp = useCallback(
    (nextReport: QualityCheckReport | null, nextItems: QualityCheckItem[]) => {
      setReport(nextReport);
      setItems(nextItems);
      onChangeRef.current?.(nextReport, nextItems);
    },
    [],
  );

  const updateOperationPhase = useCallback(
    (controller: AbortController, phase: QualityOperationPhase) => {
      if (activeOperationRef.current !== controller) return;
      operationPhaseRef.current = phase;
      if (mountedRef.current) setOperationPhase(phase);
    },
    [],
  );

  const beginOperation = useCallback(() => {
    if (activeOperationRef.current) return null;
    const controller = new AbortController();
    activeOperationRef.current = controller;
    operationPhaseRef.current = 'available';
    setOperationPhase('available');
    return controller;
  }, []);

  const finishOperation = useCallback((controller: AbortController) => {
    if (activeOperationRef.current !== controller) return;
    activeOperationRef.current = null;
    operationPhaseRef.current = 'idle';
    if (mountedRef.current) setOperationPhase('idle');
  }, []);

  const handleStopOperation = useCallback(() => {
    const controller = activeOperationRef.current;
    if (!controller || operationPhaseRef.current !== 'available') return;
    operationPhaseRef.current = 'cancelling';
    setOperationPhase('cancelling');
    controller.abort();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeOperationRef.current?.abort();
      activeOperationRef.current = null;
      operationPhaseRef.current = 'idle';
    };
  }, []);

  useEffect(() => {
    const controller = activeOperationRef.current;
    if (!controller) return;
    controller.abort();
    activeOperationRef.current = null;
    operationPhaseRef.current = 'idle';
    setOperationPhase('idle');
  }, [novelId, chapterId]);

  const loadLatest = useCallback(async () => {
    if (!novelId || !chapterId) return;
    const requestEpoch = ++loadEpochRef.current;
    const requestNovelId = novelId;
    const requestChapterId = chapterId;
    setCurrentDraft(null);
    setHistoryReports([]);
    setSelectedReportId('');
    try {
      const [draft, result, reports] = await Promise.all([
        draftVersionService.getLatestByChapterId(requestChapterId),
        qualityCheckService.getChapterIssues(requestChapterId),
        qualityCheckService.listReports(requestChapterId),
      ]);
      if (
        loadEpochRef.current !== requestEpoch ||
        liveNovelIdRef.current !== requestNovelId ||
        liveChapterIdRef.current !== requestChapterId
      )
        return;
      if (draft && (draft.novelId !== requestNovelId || draft.chapterId !== requestChapterId)) {
        throw new Error('草稿与质量检查目标不一致');
      }
      setCurrentDraft(draft);
      setHistoryReports(reports);
      setSelectedReportId(result.report?.id || '');
      syncUp(result.report, result.items);
    } catch (error) {
      if (
        loadEpochRef.current !== requestEpoch ||
        liveNovelIdRef.current !== requestNovelId ||
        liveChapterIdRef.current !== requestChapterId
      )
        return;
      appLogger.error('[QualityCheck] failed to load latest report', error);
      onError(error instanceof Error ? error.message : '加载质量检查报告失败');
    }
  }, [novelId, chapterId, onError, syncUp]);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  const latestReportId = historyReports[0]?.id || '';
  const handleHistoryChange = useCallback(
    async (reportId: string) => {
      if (!novelId || !chapterId || !reportId || historyLoading) return;
      const requestNovelId = novelId;
      const requestChapterId = chapterId;
      setHistoryLoading(true);
      onError('');
      try {
        const result =
          reportId === latestReportId
            ? await qualityCheckService.getChapterIssues(requestChapterId)
            : await qualityCheckService.getReportSnapshot(reportId);
        if (
          liveNovelIdRef.current !== requestNovelId ||
          liveChapterIdRef.current !== requestChapterId
        )
          return;
        if (
          result.report?.novelId !== requestNovelId ||
          result.report.chapterId !== requestChapterId
        ) {
          throw new Error('质量报告与当前章节不一致');
        }
        setSelectedReportId(reportId);
        syncUp(result.report, result.items);
      } catch (error) {
        if (
          liveNovelIdRef.current === requestNovelId &&
          liveChapterIdRef.current === requestChapterId
        ) {
          onError(error instanceof Error ? error.message : '加载质量检查历史失败');
        }
      } finally {
        setHistoryLoading(false);
      }
    },
    [chapterId, historyLoading, latestReportId, novelId, onError, syncUp],
  );

  return {
    liveChapterIdRef,
    liveNovelIdRef,
    mountedRef,
    activeOperationRef,
    operationPhase,
    beginOperation,
    finishOperation,
    updateOperationPhase,
    handleStopOperation,
    report,
    items,
    setItems,
    syncUp,
    currentDraft,
    setCurrentDraft,
    historyReports,
    setHistoryReports,
    selectedReportId,
    setSelectedReportId,
    historyLoading,
    latestReportId,
    handleHistoryChange,
  };
}
