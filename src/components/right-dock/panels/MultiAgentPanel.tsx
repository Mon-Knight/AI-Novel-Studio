import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChapterDraft, CreateChapterDraftInput } from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type { DraftResultMetadata } from '../../../types/workspaceSafety';
import type {
  CollaborationRound,
  ExpertType,
  MultiAgentReviewParams,
  MultiAgentReviewResult,
  MultiAgentSessionBundle,
  MultiAgentSessionRecord,
} from '../../../types/multiAgent';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { generateId } from '../../../services/database/db';
import { MULTI_AGENT_EXPERTS } from '../../../services/multi-agent/expertRegistry';
import { hashTextContent } from '../../../utils/contentHash';
import MultiAgentPanelView from './MultiAgentPanelView';
import {
  type MultiAgentRequestLease,
  type MultiAgentRequestTarget,
  useMultiAgentRequestGuard,
} from './useMultiAgentRequestGuard';

export interface MultiAgentPanelService {
  review(params: MultiAgentReviewParams): Promise<MultiAgentReviewResult>;
  getSession(sessionId: string): Promise<MultiAgentSessionBundle | null>;
  listSessionsByChapter(chapterId: string, limit?: number): Promise<MultiAgentSessionRecord[]>;
}

export interface MultiAgentPanelProps {
  novelId?: string;
  chapter?: Chapter;
  currentEditorContent?: string;
  currentDraftId?: string;
  currentDraftVersion?: number;
  currentEditorDirty?: boolean;
  currentContentHash?: string;
  onGenerated?: (draft: ChapterDraft, metadata?: DraftResultMetadata) => unknown;
  onBeforeDocumentChange?: () => Promise<boolean>;
  service: MultiAgentPanelService;
  loadDrafts?: (chapterId: string) => Promise<ChapterDraft[]>;
  createDraft?: (input: CreateChapterDraftInput) => Promise<ChapterDraft>;
}

function MultiAgentPanel({
  novelId,
  chapter,
  currentEditorContent = '',
  currentDraftId,
  currentDraftVersion,
  currentEditorDirty = false,
  currentContentHash,
  onGenerated,
  onBeforeDocumentChange,
  service,
  loadDrafts = (chapterId) => draftVersionService.getByChapterId(chapterId),
  createDraft = (input) => draftVersionService.create(input),
}: MultiAgentPanelProps) {
  const [selectedExperts, setSelectedExperts] = useState<ExpertType[]>(() =>
    MULTI_AGENT_EXPERTS.map((item) => item.type),
  );
  const [maxRounds, setMaxRounds] = useState(3);
  const [acceptanceThreshold, setAcceptanceThreshold] = useState(0.7);
  const [minimumAverageScore, setMinimumAverageScore] = useState(75);
  const [history, setHistory] = useState<MultiAgentSessionRecord[]>([]);
  const [activeBundle, setActiveBundle] = useState<MultiAgentSessionBundle | null>(null);
  const [activeRoundNumber, setActiveRoundNumber] = useState(1);
  const [liveResult, setLiveResult] = useState<MultiAgentReviewResult | null>(null);
  const [running, setRunning] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState('');
  const historyEpochRef = useRef(0);
  const {
    begin: beginRequest,
    cancelActive,
    isTargetLive,
  } = useMultiAgentRequestGuard({
    novelId,
    chapterId: chapter?.id,
  });

  const refreshHistory = useCallback(
    async (
      target: MultiAgentRequestTarget,
      preferredSessionId?: string,
      request?: MultiAgentRequestLease,
    ) => {
      if (!isTargetLive(target) || (request && !request.isLive())) return;
      const historyEpoch = ++historyEpochRef.current;
      setLoadingHistory(true);
      try {
        const sessions = await service.listSessionsByChapter(target.chapterId ?? '', 20);
        if (
          historyEpochRef.current !== historyEpoch ||
          !isTargetLive(target) ||
          (request && !request.isLive())
        ) {
          return;
        }
        setHistory(sessions);
        const targetId = preferredSessionId ?? sessions[0]?.sessionId;
        if (!targetId) {
          setActiveBundle(null);
          return;
        }
        const bundle = await service.getSession(targetId);
        if (
          historyEpochRef.current !== historyEpoch ||
          !isTargetLive(target) ||
          (request && !request.isLive())
        ) {
          return;
        }
        setActiveBundle(bundle);
        setActiveRoundNumber(bundle?.rounds[bundle.rounds.length - 1]?.roundNumber ?? 1);
      } finally {
        if (historyEpochRef.current === historyEpoch && isTargetLive(target)) {
          setLoadingHistory(false);
        }
      }
    },
    [isTargetLive, service],
  );

  useEffect(() => {
    const target = { novelId, chapterId: chapter?.id };
    const historyEpoch = ++historyEpochRef.current;
    setRunning(false);
    setLiveResult(null);
    setError('');
    if (!chapter?.id) {
      setHistory([]);
      setActiveBundle(null);
      setLoadingHistory(false);
      return;
    }
    setLoadingHistory(true);
    service
      .listSessionsByChapter(chapter.id, 20)
      .then(async (sessions) => {
        if (historyEpochRef.current !== historyEpoch || !isTargetLive(target)) return;
        setHistory(sessions);
        const latest = sessions[0];
        const bundle = latest ? await service.getSession(latest.sessionId) : null;
        if (historyEpochRef.current !== historyEpoch || !isTargetLive(target)) return;
        setActiveBundle(bundle);
        setActiveRoundNumber(bundle?.rounds[bundle.rounds.length - 1]?.roundNumber ?? 1);
      })
      .catch((reason) => {
        if (historyEpochRef.current === historyEpoch && isTargetLive(target)) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      })
      .finally(() => {
        if (historyEpochRef.current === historyEpoch && isTargetLive(target)) {
          setLoadingHistory(false);
        }
      });
    return () => {
      historyEpochRef.current += 1;
    };
  }, [chapter?.id, isTargetLive, novelId, service]);

  const activeRound = useMemo<CollaborationRound | undefined>(
    () =>
      activeBundle?.rounds.find((round) => round.roundNumber === activeRoundNumber) ??
      activeBundle?.rounds[activeBundle.rounds.length - 1],
    [activeBundle, activeRoundNumber],
  );

  const toggleExpert = (expert: ExpertType) => {
    setSelectedExperts((current) =>
      current.includes(expert)
        ? current.filter((item) => item !== expert)
        : MULTI_AGENT_EXPERTS.map((item) => item.type).filter(
            (item) => item === expert || current.includes(item),
          ),
    );
  };

  const canRun = Boolean(
    novelId &&
    chapter?.id &&
    currentDraftId &&
    currentDraftVersion &&
    currentEditorContent.trim() &&
    selectedExperts.length > 0 &&
    !running,
  );

  const executeReview = async (
    target: Required<MultiAgentRequestTarget>,
    buildParams: (signal: AbortSignal, assertLive: () => void) => Promise<MultiAgentReviewParams>,
  ) => {
    const request = beginRequest(target);
    setRunning(true);
    setError('');
    setLiveResult(null);
    try {
      const params = await buildParams(request.signal, request.assertLive);
      request.assertLive();
      const result = await service.review(params);
      request.assertLive();
      if (
        result.session.session.novelId !== target.novelId ||
        result.session.session.chapterId !== target.chapterId
      ) {
        throw new Error('协作评审返回了错误的作品或章节。');
      }
      setLiveResult(result);
      setActiveBundle(result.session);
      setActiveRoundNumber(
        result.session.rounds[result.session.rounds.length - 1]?.roundNumber ?? 1,
      );
      await refreshHistory(target, result.session.session.sessionId, request);
    } catch (reason) {
      if (request.isLive()) {
        setError(reason instanceof Error ? reason.message : String(reason));
        await refreshHistory(target, undefined, request).catch(() => undefined);
      }
    } finally {
      if (request.finish()) setRunning(false);
    }
  };

  const runReview = async () => {
    if (!canRun || !novelId || !chapter || !currentDraftId || !currentDraftVersion) return;
    const requestNovelId = novelId;
    const requestChapter = chapter;
    const requestDraftId = currentDraftId;
    const requestDraftVersion = currentDraftVersion;
    const requestContent = currentEditorContent;
    const requestContentHash = currentContentHash || hashTextContent(requestContent);
    const operationId = 'multi-agent-' + generateId();

    const target = { novelId: requestNovelId, chapterId: requestChapter.id };
    await executeReview(target, async (signal, assertLive) => {
      let sourceDraftId = requestDraftId;
      let sourceDraftVersion = requestDraftVersion;
      if (currentEditorDirty) {
        const snapshot = await createDraft({
          novelId: requestNovelId,
          chapterId: requestChapter.id,
          title: requestChapter.title + ' - 协作评审快照',
          content: requestContent,
          source: 'user_edited',
          operationId: operationId + '-source',
          note: 'Multi-Agent 评审正文快照',
        });
        assertLive();
        if (snapshot.novelId !== requestNovelId || snapshot.chapterId !== requestChapter.id) {
          throw new Error('评审快照返回了错误的作品或章节。');
        }
        sourceDraftId = snapshot.id;
        sourceDraftVersion = snapshot.versionNo;
        const applied = onGenerated?.(snapshot, {
          resultId: snapshot.id,
          novelId: requestNovelId,
          chapterId: requestChapter.id,
          sourceDraftId: requestDraftId,
          sourceRevision: requestDraftVersion,
          baseContentHash: requestContentHash,
          source: 'multi_agent',
        });
        if (applied === false) {
          throw new Error('当前编辑目标已经变化，评审快照已保存但未启动协作。');
        }
      }

      return {
        novelId: requestNovelId,
        chapterId: requestChapter.id,
        draftId: sourceDraftId,
        draftVersion: sourceDraftVersion,
        draftContent: requestContent,
        chapterTitle: requestChapter.title,
        chapterOutline: requestChapter.outline,
        chapterGoal: requestChapter.goal,
        experts: selectedExperts,
        maxRounds,
        acceptanceThreshold,
        minimumAverageScore,
        minimumSuccessfulExperts: Math.max(1, Math.ceil(selectedExperts.length * 0.67)),
        operationId,
        signal,
      };
    });
  };

  const resumeReview = async () => {
    const session = activeBundle?.session;
    if (!session || session.status !== 'running' || !chapter || running) return;
    if (session.novelId !== novelId || session.chapterId !== chapter.id || !novelId) {
      setError('原评审记录不属于当前作品或章节。');
      return;
    }
    const target = { novelId, chapterId: chapter.id };
    await executeReview(target, async (signal, assertLive) => {
      const sourceDraft = (await loadDrafts(chapter.id)).find(
        (draft) => draft.id === session.sourceDraftId,
      );
      assertLive();
      if (!sourceDraft || sourceDraft.contentState?.status === 'unavailable') {
        throw new Error('原评审正文快照不可用，无法继续该协作。');
      }
      if (sourceDraft.novelId !== novelId || sourceDraft.chapterId !== chapter.id) {
        throw new Error('原评审正文快照不属于当前作品或章节。');
      }
      return {
        novelId: session.novelId,
        chapterId: session.chapterId,
        draftId: session.sourceDraftId,
        draftVersion: session.sourceDraftVersion,
        draftContent: sourceDraft.content,
        contentHash: session.sourceContentHash,
        chapterTitle: chapter.title,
        chapterOutline: chapter.outline,
        chapterGoal: chapter.goal,
        experts: session.expertTypes,
        maxRounds: session.maxRounds,
        acceptanceThreshold: session.acceptanceThreshold,
        minimumAverageScore: session.minimumAverageScore,
        minimumSuccessfulExperts: session.minimumSuccessfulExperts,
        operationId: session.operationId,
        signal,
      };
    });
  };

  const selectHistory = async (sessionId: string) => {
    const target = { novelId, chapterId: chapter?.id };
    const historyEpoch = ++historyEpochRef.current;
    setError('');
    try {
      const bundle = await service.getSession(sessionId);
      if (historyEpochRef.current !== historyEpoch || !isTargetLive(target)) return;
      if (
        bundle &&
        (bundle.session.novelId !== target.novelId || bundle.session.chapterId !== target.chapterId)
      ) {
        throw new Error('评审历史不属于当前作品或章节。');
      }
      setActiveBundle(bundle);
      setActiveRoundNumber(bundle?.rounds[bundle.rounds.length - 1]?.roundNumber ?? 1);
      if (liveResult?.session.session.sessionId !== sessionId) setLiveResult(null);
    } catch (reason) {
      if (historyEpochRef.current === historyEpoch && isTargetLive(target)) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  };

  const loadCandidate = async () => {
    const session = activeBundle?.session;
    if (!session?.finalDraftId || !chapter?.id || !novelId || !onGenerated) return;
    const target = { novelId, chapterId: chapter.id };
    const candidateDraftId = session.finalDraftId;
    if (session.novelId !== novelId || session.chapterId !== chapter.id) {
      setError('候选草稿不属于当前作品或章节。');
      return;
    }
    setError('');
    try {
      if (onBeforeDocumentChange && !(await onBeforeDocumentChange())) return;
      if (!isTargetLive(target)) return;
      const draft =
        liveResult?.finalDraft.id === candidateDraftId
          ? liveResult.finalDraft
          : (await loadDrafts(chapter.id)).find((item) => item.id === candidateDraftId);
      if (!isTargetLive(target)) return;
      if (!draft) throw new Error('候选草稿不存在或无法读取完整正文。');
      if (
        draft.id !== candidateDraftId ||
        draft.novelId !== novelId ||
        draft.chapterId !== chapter.id
      ) {
        throw new Error('候选草稿返回了错误的作品或章节。');
      }
      onGenerated(draft);
    } catch (reason) {
      if (isTargetLive(target)) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    }
  };

  const activeSession = activeBundle?.session;
  const hasCandidate = Boolean(
    activeSession?.finalDraftId && activeSession.finalDraftId !== activeSession.sourceDraftId,
  );

  return (
    <MultiAgentPanelView
      selectedExperts={selectedExperts}
      maxRounds={maxRounds}
      acceptanceThreshold={acceptanceThreshold}
      minimumAverageScore={minimumAverageScore}
      history={history}
      activeBundle={activeBundle}
      activeRound={activeRound}
      activeSession={activeSession}
      running={running}
      loadingHistory={loadingHistory}
      currentEditorDirty={currentEditorDirty}
      currentDraftId={currentDraftId}
      error={error}
      canRun={canRun}
      hasCandidate={hasCandidate}
      onToggleExpert={toggleExpert}
      onMaxRoundsChange={setMaxRounds}
      onAcceptanceThresholdChange={setAcceptanceThreshold}
      onMinimumAverageScoreChange={setMinimumAverageScore}
      onRun={() => void runReview()}
      onCancel={cancelActive}
      onSelectHistory={(sessionId) => void selectHistory(sessionId)}
      onLoadCandidate={() => void loadCandidate()}
      onResumeReview={() => void resumeReview()}
      onSelectRound={setActiveRoundNumber}
    />
  );
}

export default MultiAgentPanel;
