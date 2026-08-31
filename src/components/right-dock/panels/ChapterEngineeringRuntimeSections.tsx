import {
  STEP_LABELS,
  formatDate,
  outputNumber,
  stepStatusClass,
} from './chapterEngineeringPanelSupport';
import type { ChapterEngineeringPanelViewProps } from './ChapterEngineeringPanelView';

export function ChapterEngineeringRuntimeSections({
  activeTab,
  bundle,
  latestSnapshot,
  latestJob,
  jobSteps,
  patchGenerationStep,
  patchApplyStep,
  hasActiveJob,
  busy,
  loading,
  compiling,
  jobRunning,
  draftRunning,
  handleCompileSnapshot,
  handleRunDraftJob,
  handleRunMockJob,
  handleCancelJob,
}: ChapterEngineeringPanelViewProps) {
  return (
    <>
      {activeTab === 'versions' && (
        <div className="panel-section">
          <div className="panel-section-title">Engineering Versions</div>
          {!bundle?.states.length && <div className="engineering-empty">暂无工程版本。</div>}
          {bundle?.states.map((item) => (
            <div className="engineering-version-row" key={item.id}>
              <div>
                <strong>v{item.draftVersion}</strong>
                <span>{item.status}</span>
              </div>
              <small>更新：{formatDate(item.updatedAt)}</small>
              {item.activatedAt && <small>应用：{formatDate(item.activatedAt)}</small>}
            </div>
          ))}
        </div>
      )}

      {activeTab === 'snapshot' && (
        <div className="panel-section">
          <div className="panel-section-title">Generation Snapshot</div>
          <button
            type="button"
            className="panel-btn panel-btn-secondary"
            disabled={busy || loading || compiling}
            onClick={handleCompileSnapshot}
          >
            {compiling ? '正在编译...' : '编译上下文快照'}
          </button>
          {!latestSnapshot && <div className="engineering-empty">暂无上下文快照。</div>}
          {latestSnapshot && (
            <>
              <div className="engineering-version-row">
                <div>
                  <strong>{latestSnapshot.contextHash}</strong>
                  <span>
                    {latestSnapshot.engineeringStateId ? 'active engineering' : 'no engineering'}
                  </span>
                </div>
                <small>创建：{formatDate(latestSnapshot.createdAt)}</small>
              </div>
              <pre className="engineering-snapshot-summary">{latestSnapshot.promptSummary}</pre>
              {latestSnapshot.compiledContext.warnings.length > 0 && (
                <div className="engineering-error">
                  {latestSnapshot.compiledContext.warnings.join('；')}
                </div>
              )}
              <div className="engineering-source-list">
                {latestSnapshot.sources.map((item) => (
                  <div className="engineering-source-row" key={`${item.type}-${item.title}`}>
                    <span>{item.title}</span>
                    <strong className={`source-${item.status}`}>{item.status}</strong>
                    {item.summary && <small>{item.summary}</small>}
                  </div>
                ))}
              </div>
              <textarea
                className="panel-textarea engineering-snapshot-preview"
                value={latestSnapshot.compiledPromptText}
                readOnly
                rows={10}
              />
            </>
          )}
        </div>
      )}

      {activeTab === 'jobs' && (
        <div className="panel-section">
          <div className="panel-section-title">Generation Jobs</div>
          <div className="engineering-job-actions">
            <button
              type="button"
              className="panel-btn panel-btn-primary"
              data-testid="generation-job-start"
              disabled={busy || loading || compiling || jobRunning || draftRunning || hasActiveJob}
              onClick={handleRunDraftJob}
            >
              {draftRunning ? '生成中...' : '生成本章初稿'}
            </button>
            <button
              type="button"
              className="panel-btn panel-btn-secondary"
              data-testid="generation-mock-job-start"
              disabled={busy || loading || compiling || jobRunning || draftRunning || hasActiveJob}
              onClick={handleRunMockJob}
            >
              {jobRunning ? 'Mock 运行中...' : '启动 Mock 任务'}
            </button>
            <button
              type="button"
              className="panel-btn panel-btn-warning"
              data-testid="generation-job-cancel"
              disabled={
                !latestJob || ['completed', 'failed', 'cancelled'].includes(latestJob.status)
              }
              onClick={handleCancelJob}
            >
              取消任务
            </button>
          </div>
          {!latestJob && <div className="engineering-empty">暂无生成任务。</div>}
          {latestJob && (
            <>
              <div
                className="engineering-version-row"
                data-testid="generation-job-status"
                data-job-id={latestJob.id}
                data-job-status={latestJob.status}
                data-error-code={latestJob.errorCode || ''}
              >
                <div>
                  <strong>{latestJob.status}</strong>
                  <span>{latestJob.currentStep || latestJob.jobType}</span>
                </div>
                <small>
                  进度：{latestJob.progressPercent}% / provider：{latestJob.provider || '-'}
                </small>
                <div className="engineering-job-progress">
                  <span
                    style={{ width: `${Math.max(0, Math.min(100, latestJob.progressPercent))}%` }}
                  />
                </div>
              </div>
              {latestJob.errorCode === 'APP_RESTART_INTERRUPTED' && (
                <div className="engineering-error" data-testid="generation-job-recovery">
                  上次运行在此步骤中断。已完成的步骤和草稿仍然保留；请检查后重新生成，不会自动续跑。
                </div>
              )}
              {latestJob.errorMessage && latestJob.errorCode !== 'APP_RESTART_INTERRUPTED' && (
                <div className="engineering-error">{latestJob.errorMessage}</div>
              )}
              <div className="engineering-step-list">
                {jobSteps.map((step) => (
                  <div
                    className="engineering-step-row"
                    key={step.id}
                    data-testid="generation-job-step"
                    data-step-id={step.id}
                    data-step-name={step.stepName}
                    data-step-status={step.status}
                  >
                    <div>
                      <strong>{STEP_LABELS[step.stepName]}</strong>
                      <span className={`source-${stepStatusClass(step.status)}`}>
                        {step.status}
                      </span>
                    </div>
                    {step.outputText && <small>{step.outputText}</small>}
                    {step.errorMessage && <small>{step.errorMessage}</small>}
                  </div>
                ))}
              </div>
              {patchGenerationStep && (
                <div className="engineering-patch-summary">
                  <div>
                    <span>修复建议</span>
                    <strong>{outputNumber(patchGenerationStep, 'patchCount') ?? 0}</strong>
                  </div>
                  <div>
                    <span>低风险</span>
                    <strong>{outputNumber(patchGenerationStep, 'lowRiskCount') ?? 0}</strong>
                  </div>
                  <div>
                    <span>自动应用</span>
                    <strong>{outputNumber(patchApplyStep, 'appliedCount') ?? 0}</strong>
                  </div>
                  <div>
                    <span>待确认</span>
                    <strong>{outputNumber(patchApplyStep, 'skippedCount') ?? 0}</strong>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </>
  );
}
