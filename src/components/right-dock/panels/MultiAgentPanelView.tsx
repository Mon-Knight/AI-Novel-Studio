import type {
  CollaborationRound,
  ExpertType,
  MultiAgentSessionBundle,
  MultiAgentSessionRecord,
} from '../../../types/multiAgent';
import { MULTI_AGENT_EXPERTS } from '../../../services/multi-agent/expertRegistry';
import { ACTION_LABELS, STATUS_LABELS, metric, sessionTitle } from './multiAgentPanelPresentation';

interface MultiAgentPanelViewProps {
  selectedExperts: ExpertType[];
  maxRounds: number;
  acceptanceThreshold: number;
  minimumAverageScore: number;
  history: MultiAgentSessionRecord[];
  activeBundle: MultiAgentSessionBundle | null;
  activeRound?: CollaborationRound;
  activeSession?: MultiAgentSessionRecord;
  running: boolean;
  loadingHistory: boolean;
  currentEditorDirty: boolean;
  currentDraftId?: string;
  error: string;
  canRun: boolean;
  hasCandidate: boolean;
  onToggleExpert(expert: ExpertType): void;
  onMaxRoundsChange(value: number): void;
  onAcceptanceThresholdChange(value: number): void;
  onMinimumAverageScoreChange(value: number): void;
  onRun(): void;
  onCancel(): void;
  onSelectHistory(sessionId: string): void;
  onLoadCandidate(): void;
  onResumeReview(): void;
  onSelectRound(roundNumber: number): void;
}

function MultiAgentPanelView({
  selectedExperts,
  maxRounds,
  acceptanceThreshold,
  minimumAverageScore,
  history,
  activeBundle,
  activeRound,
  activeSession,
  running,
  loadingHistory,
  currentEditorDirty,
  currentDraftId,
  error,
  canRun,
  hasCandidate,
  onToggleExpert,
  onMaxRoundsChange,
  onAcceptanceThresholdChange,
  onMinimumAverageScoreChange,
  onRun,
  onCancel,
  onSelectHistory,
  onLoadCandidate,
  onResumeReview,
  onSelectRound,
}: MultiAgentPanelViewProps) {
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
                onChange={() => onToggleExpert(expert.type)}
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
              onChange={(event) => onMaxRoundsChange(Number(event.target.value))}
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
              onChange={(event) => onMinimumAverageScoreChange(Number(event.target.value))}
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
            onChange={(event) => onAcceptanceThresholdChange(Number(event.target.value))}
            disabled={running}
          />
        </label>

        {currentEditorDirty && (
          <div className="multi-agent-notice">当前正文会先保存为评审快照；候选不会自动载入。</div>
        )}
        {!currentDraftId && <div className="engineering-empty">当前章节没有可评审草稿。</div>}
        {error && (
          <div className="engineering-error" role="alert">
            {error}
          </div>
        )}

        <div className="multi-agent-actions">
          {running ? (
            <button type="button" className="panel-btn panel-btn-warning" onClick={onCancel}>
              取消评审
            </button>
          ) : (
            <button
              type="button"
              className="panel-btn panel-btn-primary"
              onClick={onRun}
              disabled={!canRun}
              data-testid="multi-agent-run"
            >
              开始协作评审
            </button>
          )}
        </div>
        {running && (
          <div className="multi-agent-running" aria-live="polite">
            专家正在并行评审…
          </div>
        )}
      </section>

      <section className="panel-section">
        <div className="panel-section-title">评审历史</div>
        <select
          className="panel-select"
          value={activeSession?.sessionId ?? ''}
          onChange={(event) => onSelectHistory(event.target.value)}
          disabled={loadingHistory || history.length === 0}
        >
          {history.length === 0 && <option value="">暂无记录</option>}
          {history.map((session) => (
            <option key={session.sessionId} value={session.sessionId}>
              {sessionTitle(session)}
            </option>
          ))}
        </select>
      </section>

      {activeSession && (
        <section className="panel-section multi-agent-result">
          <div className="multi-agent-result-header">
            <div>
              <div className="multi-agent-result-title">{STATUS_LABELS[activeSession.status]}</div>
              <div className="multi-agent-result-meta">
                {activeSession.currentRound}/{activeSession.maxRounds} 轮 ·{' '}
                {activeSession.totalTokensUsed} tokens
              </div>
            </div>
            {activeSession.finalAction && (
              <span className={`multi-agent-action ${activeSession.finalAction}`}>
                {ACTION_LABELS[activeSession.finalAction]}
              </span>
            )}
          </div>

          {hasCandidate && (
            <button
              type="button"
              className="panel-btn panel-btn-secondary"
              onClick={onLoadCandidate}
            >
              载入候选草稿
            </button>
          )}
          {activeSession.status === 'running' && (
            <button
              type="button"
              className="panel-btn panel-btn-primary"
              onClick={onResumeReview}
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
                    onClick={() => onSelectRound(round.roundNumber)}
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
                    <div>
                      <span>平均分</span>
                      <strong>{metric(activeRound.consensus.averageScore)}</strong>
                    </div>
                    <div>
                      <span>接受率</span>
                      <strong>{Math.round(activeRound.consensus.acceptanceRate * 100)}%</strong>
                    </div>
                    <div>
                      <span>有效专家</span>
                      <strong>{activeRound.consensus.successfulExperts}</strong>
                    </div>
                  </div>

                  {activeRound.expertOpinions.map((opinion) => (
                    <article
                      key={opinion.opinionId}
                      className={`multi-agent-opinion ${opinion.status}`}
                    >
                      <header>
                        <strong>
                          {MULTI_AGENT_EXPERTS.find((item) => item.type === opinion.expert)?.label}
                        </strong>
                        <span>
                          {opinion.status === 'succeeded' ? `${opinion.score} 分` : '失败'}
                        </span>
                      </header>
                      <p>{opinion.summary}</p>
                      {opinion.errorMessage && (
                        <div className="multi-agent-opinion-error">{opinion.errorMessage}</div>
                      )}
                      {opinion.issues.length > 0 && (
                        <ul>
                          {opinion.issues.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      )}
                      {opinion.suggestions.length > 0 && (
                        <div className="multi-agent-suggestions">
                          {opinion.suggestions.map((item) => (
                            <p key={item}>{item}</p>
                          ))}
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

export default MultiAgentPanelView;
