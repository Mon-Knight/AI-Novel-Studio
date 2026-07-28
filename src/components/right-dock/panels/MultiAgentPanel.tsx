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
import {
  ACTION_LABELS,
  STATUS_LABELS,
  metric,
  sessionTitle,
} from './multiAgentPanelPresentation';

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
  const [selectedExperts, setSelectedExperts] = useState<ExpertType[]>(
    () => MULTI_AGENT_EXPERTS.map((item) => item.type),
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
  const abortRef = useRef<AbortController | null>(null);

  const refreshHistory = useCallback(async (chapterId: string, preferredSessionId?: string) => {
    setLoadingHistory(true);
    try {
      const sessions = await service.listSessionsByChapter(chapterId, 20);
      setHistory(sessions);
      const targetId = preferredSessionId ?? sessions[0]?.sessionId;
      if (!targetId) {
        setActiveBundle(null);
        return;
      }
      const bundle = await service.getSession(targetId);
      setActiveBundle(bundle);
      setActiveRoundNumber(bundle?.rounds[bundle.rounds.length - 1]?.roundNumber ?? 1);
    } finally {
      setLoadingHistory(false);
    }
  }, [service]);

  useEffect(() => {
    abortRef.current?.abort();
    setLiveResult(null);
    setError('');
    if (!chapter?.id) {
      setHistory([]);
      setActiveBundle(null);
      return;
    }
    let active = true;
    setLoadingHistory(true);
    service.listSessionsByChapter(chapter.id, 20)
      .then(async (sessions) => {
        if (!active) return;
        setHistory(sessions);
        const latest = sessions[0];
        const bundle = latest ? await service.getSession(latest.sessionId) : null;
        if (!active) return;
        setActiveBundle(bundle);
        setActiveRoundNumber(bundle?.rounds[bundle.rounds.length - 1]?.roundNumber ?? 1);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (active) setLoadingHistory(false);
      });
    return () => { active = false; };
  }, [chapter?.id, service]);

  const activeRound = useMemo<CollaborationRound | undefined>(() => (
    activeBundle?.rounds.find((round) => round.roundNumber === activeRoundNumber)
      ?? activeBundle?.rounds[activeBundle.rounds.length - 1]
  ), [activeBundle, activeRoundNumber]);

  const toggleExpert = (expert: ExpertType) => {
    setSelectedExperts((current) => (
      current.includes(expert)
        ? current.filter((item) => item !== expert)
        : MULTI_AGENT_EXPERTS.map((item) => item.type).filter((item) => (
            item === expert || current.includes(item)
          ))
    ));
  };

  const canRun = Boolean(
    novelId
    && chapter?.id
    && currentDraftId
    && currentDraftVersion
    && currentEditorContent.trim()
    && selectedExperts.length > 0
    && !running,
  );

  const executeReview = async (
    chapterId: string,
    buildParams: (signal: AbortSignal) => Promise<MultiAgentReviewParams>,
  ) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError('');
    setLiveResult(null);
    try {
      const result = await service.review(await buildParams(controller.signal));
      setLiveResult(result);
      setActiveBundle(result.session);
      setActiveRoundNumber(result.session.rounds[result.session.rounds.length - 1]?.roundNumber ?? 1);
      await refreshHistory(chapterId, result.session.session.sessionId);
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : String(reason));
        await refreshHistory(chapterId).catch(() => undefined);
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
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

    await executeReview(requestChapter.id, async (signal) => {
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
    await executeReview(chapter.id, async (signal) => {
      const sourceDraft = (await loadDrafts(chapter.id))
        .find((draft) => draft.id === session.sourceDraftId);
      if (!sourceDraft || sourceDraft.contentState?.status === 'unavailable') {
        throw new Error('原评审正文快照不可用，无法继续该协作。');
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
    setError('');
    try {
      const bundle = await service.getSession(sessionId);
      setActiveBundle(bundle);
      setActiveRoundNumber(bundle?.rounds[bundle.rounds.length - 1]?.roundNumber ?? 1);
      if (liveResult?.session.session.sessionId !== sessionId) setLiveResult(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const loadCandidate = async () => {
    const session = activeBundle?.session;
    if (!session?.finalDraftId || !chapter?.id || !onGenerated) return;
    setError('');
    try {
      if (onBeforeDocumentChange && !(await onBeforeDocumentChange())) return;
      const draft = liveResult?.finalDraft.id === session.finalDraftId
        ? liveResult.finalDraft
        : (await loadDrafts(chapter.id)).find((item) => item.id === session.finalDraftId);
      if (!draft) throw new Error('候选草稿不存在或无法读取完整正文。');
      onGenerated(draft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const activeSession = activeBundle?.session;
  const hasCandidate = Boolean(
    activeSession?.finalDraftId
    && activeSession.finalDraftId !== activeSession.sourceDraftId,
  );

  return (
    <div className="multi-agent-panel" data-testid="multi-agent-panel">
      <section className="panel-section">
        <div className="panel-section-title">专家组合</div>
        <div className="multi-agent-expert-selector">
          {MULTI_AGENT_EXPERTS.map((expert) => (
            <label key={expert.type} className="multi-agent-expert-toggle">
              <input
                type="checkbox"
                checked={selectedExperts.includes(expert.type)}
                onChange={() => toggleExpert(expert.type)}
                disabled={running}
              />
              <span>{expert.label}</span>
            </label>
          ))}
        </div>

        <div className="multi-agent-control-grid">
          <label className="panel-field">
            <span className="panel-field-label">最大轮数</span>
            <select
              className="panel-select"
              value={maxRounds}
              onChange={(event) => setMaxRounds(Number(event.target.value))}
              disabled={running}
            >
              <option value={1}>1 轮</option>
              <option value={2}>2 轮</option>
              <option value={3}>3 轮</option>
            </select>
          </label>
          <label className="panel-field">
            <span className="panel-field-label">平均分 {minimumAverageScore}</span>
            <input
              className="multi-agent-range"
              type="range"
              min={60}
              max={90}
              step={1}
              value={minimumAverageScore}
              onChange={(event) => setMinimumAverageScore(Number(event.target.value))}
              disabled={running}
            />
          </label>
        </div>
        <label className="panel-field">
          <span className="panel-field-label">接受率 {Math.round(acceptanceThreshold * 100)}%</span>
          <input
            className="multi-agent-range"
            type="range"
            min={0.5}
            max={1}
            step={0.1}
            value={acceptanceThreshold}
            onChange={(event) => setAcceptanceThreshold(Number(event.target.value))}
            disabled={running}
          />
        </label>

        {currentEditorDirty && (
          <div className="multi-agent-notice">当前正文会先保存为评审快照；候选不会自动载入。</div>
        )}
        {!currentDraftId && <div className="engineering-empty">当前章节没有可评审草稿。</div>}
        {error && <div className="engineering-error" role="alert">{error}</div>}

        <div className="multi-agent-actions">
          {running ? (
            <button
              type="button"
              className="panel-btn panel-btn-warning"
              onClick={() => abortRef.current?.abort()}
            >
              取消评审
            </button>
          ) : (
            <button
              type="button"
              className="panel-btn panel-btn-primary"
              onClick={() => void runReview()}
              disabled={!canRun}
              data-testid="multi-agent-run"
            >
              开始协作评审
            </button>
          )}
        </div>
        {running && <div className="multi-agent-running" aria-live="polite">专家正在并行评审…</div>}
      </section>

      <section className="panel-section">
        <div className="panel-section-title">评审历史</div>
        <select
          className="panel-select"
          value={activeSession?.sessionId ?? ''}
          onChange={(event) => void selectHistory(event.target.value)}
          disabled={loadingHistory || history.length === 0}
        >
          {history.length === 0 && <option value="">暂无记录</option>}
          {history.map((session) => (
            <option key={session.sessionId} value={session.sessionId}>{sessionTitle(session)}</option>
          ))}
        </select>
      </section>

      {activeSession && (
        <section className="panel-section multi-agent-result">
          <div className="multi-agent-result-header">
            <div>
              <div className="multi-agent-result-title">{STATUS_LABELS[activeSession.status]}</div>
              <div className="multi-agent-result-meta">
                {activeSession.currentRound}/{activeSession.maxRounds} 轮 · {activeSession.totalTokensUsed} tokens
              </div>
            </div>
            {activeSession.finalAction && (
              <span className={`multi-agent-action ${activeSession.finalAction}`}>
                {ACTION_LABELS[activeSession.finalAction]}
              </span>
            )}
          </div>

          {hasCandidate && (
            <button type="button" className="panel-btn panel-btn-secondary" onClick={() => void loadCandidate()}>
              载入候选草稿
            </button>
          )}
          {activeSession.status === 'running' && (
            <button
              type="button"
              className="panel-btn panel-btn-primary"
              onClick={() => void resumeReview()}
              disabled={running}
            >
              继续此评审
            </button>
          )}

          {activeBundle && activeBundle.rounds.length > 0 && (
            <>
              <div className="multi-agent-round-tabs" role="tablist" aria-label="评审轮次">
                {activeBundle.rounds.map((round) => (
                  <button
                    key={round.roundNumber}
                    type="button"
                    className={round.roundNumber === activeRound?.roundNumber ? 'active' : ''}
                    onClick={() => setActiveRoundNumber(round.roundNumber)}
                    role="tab"
                    aria-selected={round.roundNumber === activeRound?.roundNumber}
                  >
                    第 {round.roundNumber} 轮
                  </button>
                ))}
              </div>

              {activeRound && (
                <div className="multi-agent-round-detail">
                  <div className="multi-agent-metrics">
                    <div><span>平均分</span><strong>{metric(activeRound.consensus.averageScore)}</strong></div>
                    <div><span>接受率</span><strong>{Math.round(activeRound.consensus.acceptanceRate * 100)}%</strong></div>
                    <div><span>有效专家</span><strong>{activeRound.consensus.successfulExperts}</strong></div>
                  </div>

                  {activeRound.expertOpinions.map((opinion) => (
                    <article key={opinion.opinionId} className={`multi-agent-opinion ${opinion.status}`}>
                      <header>
                        <strong>{MULTI_AGENT_EXPERTS.find((item) => item.type === opinion.expert)?.label}</strong>
                        <span>{opinion.status === 'succeeded' ? `${opinion.score} 分` : '失败'}</span>
                      </header>
                      <p>{opinion.summary}</p>
                      {opinion.errorMessage && <div className="multi-agent-opinion-error">{opinion.errorMessage}</div>}
                      {opinion.issues.length > 0 && (
                        <ul>{opinion.issues.map((item) => <li key={item}>{item}</li>)}</ul>
                      )}
                      {opinion.suggestions.length > 0 && (
                        <div className="multi-agent-suggestions">
                          {opinion.suggestions.map((item) => <p key={item}>{item}</p>)}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}

export default MultiAgentPanel;
