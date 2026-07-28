import type { Dispatch, SetStateAction } from 'react';
import type {
  ChapterCard,
  ChapterEngineeringBundle,
  GenerationConstraints,
  QualityRules,
  QualityStrictness,
  ScenePlanItem,
} from '../../../types/chapterEngineering';
import type { ChapterGenerationSnapshot } from '../../../types/generationContext';
import type { GenerationJob, GenerationStepResult } from '../../../types/generationJob';
import type { GetQualityCheckIssuesResult, QualityCheckItem } from '../../../types/qualityCheck';
import {
  TABS,
  QUALITY_CHECK_OPTIONS,
  STEP_LABELS,
  formatDate,
  formatQualityTitle,
  outputNumber,
  stepStatusClass,
  type LoopItem,
  type TabId,
} from './chapterEngineeringPanelSupport';
import { ListField, NumberField, TextField } from './ChapterEngineeringFields';

interface ChapterEngineeringPanelViewProps {
  activeTab: TabId;
  setActiveTab: Dispatch<SetStateAction<TabId>>;
  statusText: string;
  dirty: boolean;
  loopItems: LoopItem[];
  message: string;
  error: string;
  card: ChapterCard;
  scenePlan: ScenePlanItem[];
  constraints: GenerationConstraints;
  qualityRules: QualityRules;
  qualityResult: GetQualityCheckIssuesResult;
  visibleQualityItems: QualityCheckItem[];
  bundle: ChapterEngineeringBundle | null;
  latestSnapshot: ChapterGenerationSnapshot | null;
  latestJob: GenerationJob | null;
  jobSteps: GenerationStepResult[];
  patchGenerationStep?: GenerationStepResult;
  patchApplyStep?: GenerationStepResult;
  hasActiveJob: boolean;
  busy: boolean;
  loading: boolean;
  compiling: boolean;
  jobRunning: boolean;
  draftRunning: boolean;
  updateCard: <K extends keyof ChapterCard>(key: K, value: ChapterCard[K]) => void;
  updateConstraints: <K extends keyof GenerationConstraints>(key: K, value: GenerationConstraints[K]) => void;
  updateWordRange: (key: 'min' | 'max', value?: number) => void;
  updateQuality: <K extends keyof QualityRules>(key: K, value: QualityRules[K]) => void;
  updateScene: <K extends keyof ScenePlanItem>(id: string, key: K, value: ScenePlanItem[K]) => void;
  addScene: () => void;
  removeScene: (id: string) => void;
  toggleQualityCheck: (id: string) => void;
  handleCompileSnapshot: () => Promise<void>;
  handleRunDraftJob: () => Promise<void>;
  handleRunMockJob: () => Promise<void>;
  handleCancelJob: () => Promise<void>;
  handleSaveDraft: () => Promise<void>;
  handleSaveAndApply: () => Promise<void>;
}

export function ChapterEngineeringPanelView({
  activeTab,
  setActiveTab,
  statusText,
  dirty,
  loopItems,
  message,
  error,
  card,
  scenePlan,
  constraints,
  qualityRules,
  qualityResult,
  visibleQualityItems,
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
  updateCard,
  updateConstraints,
  updateWordRange,
  updateQuality,
  updateScene,
  addScene,
  removeScene,
  toggleQualityCheck,
  handleCompileSnapshot,
  handleRunDraftJob,
  handleRunMockJob,
  handleCancelJob,
  handleSaveDraft,
  handleSaveAndApply,
}: ChapterEngineeringPanelViewProps) {
  return (
    <div className="engineering-panel" data-testid="engineering-panel">
      <div className="engineering-status">
        <span>{statusText}</span>
        {dirty && <strong>已修改</strong>}
      </div>

      <div className="engineering-loop-grid">
        {loopItems.map((item) => (
          <div className={`engineering-loop-item ${item.status}`} key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>

      <div className="engineering-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            data-testid={`engineering-tab-${tab.id}`}
            className={`engineering-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <div className="engineering-message">正在读取章节工程状态...</div>}
      {error && <div className="engineering-error">{error}</div>}
      {message && <div className="engineering-message">{message}</div>}

      {activeTab === 'card' && (
        <div className="panel-section">
          <div className="panel-section-title">Chapter Card</div>
          <TextField label="章节标题" value={card.chapterTitle} onChange={(value) => updateCard('chapterTitle', value)} />
          <TextField label="分卷标题" value={card.volumeTitle} onChange={(value) => updateCard('volumeTitle', value)} />
          <TextField label="本章目标" value={card.chapterGoal} onChange={(value) => updateCard('chapterGoal', value)} multiline />
          <TextField label="开场状态" value={card.openingState} onChange={(value) => updateCard('openingState', value)} multiline />
          <TextField label="结束状态" value={card.endingState} onChange={(value) => updateCard('endingState', value)} multiline />
          <TextField label="核心冲突" value={card.coreConflict} onChange={(value) => updateCard('coreConflict', value)} multiline />
          <TextField label="视角角色" value={card.viewpointCharacter} onChange={(value) => updateCard('viewpointCharacter', value)} />
          <TextField label="主要地点" value={card.primaryLocation} onChange={(value) => updateCard('primaryLocation', value)} />
          <NumberField label="目标字数" value={card.targetWordCount} onChange={(value) => updateCard('targetWordCount', value)} />
          <ListField label="出场角色" value={card.appearingCharacters} onChange={(value) => updateCard('appearingCharacters', value)} />
          <ListField label="必须发生" value={card.mustHappenEvents} onChange={(value) => updateCard('mustHappenEvents', value)} />
          <ListField label="禁止发生" value={card.forbiddenEvents} onChange={(value) => updateCard('forbiddenEvents', value)} />
          <ListField label="已知信息" value={card.knownInformation} onChange={(value) => updateCard('knownInformation', value)} />
          <ListField label="未知信息" value={card.unknownInformation} onChange={(value) => updateCard('unknownInformation', value)} />
          <ListField label="本章释放信息" value={card.releasedInformation} onChange={(value) => updateCard('releasedInformation', value)} />
          <ListField label="保留悬念" value={card.reservedSecrets} onChange={(value) => updateCard('reservedSecrets', value)} />
          <TextField label="情绪曲线" value={card.emotionalCurve} onChange={(value) => updateCard('emotionalCurve', value)} multiline />
          <TextField label="章末钩子" value={card.endingHook} onChange={(value) => updateCard('endingHook', value)} multiline />
          <ListField label="文风要求" value={card.styleRequirements} onChange={(value) => updateCard('styleRequirements', value)} />
          <ListField label="写法禁区" value={card.forbiddenWriting} onChange={(value) => updateCard('forbiddenWriting', value)} />
        </div>
      )}

      {activeTab === 'scenes' && (
        <div className="panel-section">
          <div className="panel-section-title">Scene Plan</div>
          {scenePlan.map((scene) => (
            <div className="engineering-scene" key={scene.id}>
              <div className="engineering-scene-header">
                <strong>场景 {scene.sceneNo}</strong>
                <button type="button" className="engineering-link-btn" onClick={() => removeScene(scene.id)}>删除</button>
              </div>
              <TextField label="场景标题" value={scene.title} onChange={(value) => updateScene(scene.id, 'title', value)} />
              <TextField label="地点" value={scene.location} onChange={(value) => updateScene(scene.id, 'location', value)} />
              <ListField label="角色" value={scene.characters} onChange={(value) => updateScene(scene.id, 'characters', value)} rows={3} />
              <TextField label="目标" value={scene.goal} onChange={(value) => updateScene(scene.id, 'goal', value)} multiline />
              <TextField label="冲突" value={scene.conflict} onChange={(value) => updateScene(scene.id, 'conflict', value)} multiline />
              <ListField label="关键动作" value={scene.keyActions} onChange={(value) => updateScene(scene.id, 'keyActions', value)} />
              <TextField label="关键对白" value={scene.keyDialogue} onChange={(value) => updateScene(scene.id, 'keyDialogue', value)} multiline />
              <ListField label="释放信息" value={scene.informationRelease} onChange={(value) => updateScene(scene.id, 'informationRelease', value)} />
              <TextField label="结果" value={scene.result} onChange={(value) => updateScene(scene.id, 'result', value)} multiline />
              <TextField label="转场" value={scene.transition} onChange={(value) => updateScene(scene.id, 'transition', value)} multiline />
            </div>
          ))}
          <button type="button" className="panel-btn panel-btn-secondary" onClick={addScene}>新增场景</button>
        </div>
      )}

      {activeTab === 'constraints' && (
        <div className="panel-section">
          <div className="panel-section-title">Generation Constraints</div>
          <ListField label="必须遵守" value={constraints.mustFollow} onChange={(value) => updateConstraints('mustFollow', value)} />
          <ListField label="不得改变" value={constraints.forbiddenChanges} onChange={(value) => updateConstraints('forbiddenChanges', value)} />
          <ListField label="不得新增" value={constraints.forbiddenAdditions} onChange={(value) => updateConstraints('forbiddenAdditions', value)} />
          <ListField label="不得提前发生" value={constraints.forbiddenEarlyEvents} onChange={(value) => updateConstraints('forbiddenEarlyEvents', value)} />
          <ListField label="不得提前揭示" value={constraints.forbiddenEarlyReveals} onChange={(value) => updateConstraints('forbiddenEarlyReveals', value)} />
          <ListField label="禁用词" value={constraints.bannedWords} onChange={(value) => updateConstraints('bannedWords', value)} rows={3} />
          <ListField label="禁用句式" value={constraints.bannedSentencePatterns} onChange={(value) => updateConstraints('bannedSentencePatterns', value)} rows={3} />
          <TextField label="叙事人称" value={constraints.narrativePerson} onChange={(value) => updateConstraints('narrativePerson', value)} />
          <div className="engineering-two-col">
            <NumberField label="最少字数" value={constraints.wordRange.min} onChange={(value) => updateWordRange('min', value)} />
            <NumberField label="最多字数" value={constraints.wordRange.max} onChange={(value) => updateWordRange('max', value)} />
          </div>
          <TextField label="节奏要求" value={constraints.pacingRequirement} onChange={(value) => updateConstraints('pacingRequirement', value)} multiline />
          <TextField label="对白比例" value={constraints.dialogueRatio} onChange={(value) => updateConstraints('dialogueRatio', value)} />
          <TextField label="描写比例" value={constraints.descriptionRatio} onChange={(value) => updateConstraints('descriptionRatio', value)} />
          <TextField label="战斗/动作风格" value={constraints.combatStyle} onChange={(value) => updateConstraints('combatStyle', value)} />
          <TextField label="信息释放方式" value={constraints.informationReleaseMode} onChange={(value) => updateConstraints('informationReleaseMode', value)} multiline />
        </div>
      )}

      {activeTab === 'quality' && (
        <div className="panel-section">
          <div className="panel-section-title">Quality Rules</div>
          <div className="engineering-check-list">
            {QUALITY_CHECK_OPTIONS.map((option) => (
              <label className="engineering-check-row" key={option.id}>
                <input
                  type="checkbox"
                  checked={qualityRules.enabledChecks.includes(option.id)}
                  onChange={() => toggleQualityCheck(option.id)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <label className="panel-field engineering-field">
            <span className="panel-field-label">严格度</span>
            <select
              className="panel-select"
              value={qualityRules.strictness}
              onChange={(event) => updateQuality('strictness', event.target.value as QualityStrictness)}
            >
              <option value="relaxed">宽松</option>
              <option value="normal">标准</option>
              <option value="strict">严格</option>
            </select>
          </label>
          <label className="engineering-check-row">
            <input
              type="checkbox"
              checked={qualityRules.manualReviewRequired}
              onChange={(event) => updateQuality('manualReviewRequired', event.target.checked)}
            />
            <span>需要人工复核</span>
          </label>
          <label className="engineering-check-row">
            <input
              type="checkbox"
              checked={qualityRules.autoFixAllowed}
              onChange={(event) => updateQuality('autoFixAllowed', event.target.checked)}
            />
            <span>允许自动修复</span>
          </label>
          <ListField label="自定义规则" value={qualityRules.customRules} onChange={(value) => updateQuality('customRules', value)} />
          <ListField label="自动修复禁区" value={qualityRules.autoFixForbidden} onChange={(value) => updateQuality('autoFixForbidden', value)} />

          <div className="panel-section-title">Latest Quality Report</div>
          {!qualityResult.report && <div className="engineering-empty">暂无结构化质量报告。</div>}
          {qualityResult.report && (
            <>
              <div className="engineering-quality-summary">
                <div>
                  <span>综合评分</span>
                  <strong>{qualityResult.report.overallScore ?? '-'}</strong>
                </div>
                <div>
                  <span>待处理</span>
                  <strong>{qualityResult.statistics.pending}</strong>
                </div>
                <div>
                  <span>高风险</span>
                  <strong>{qualityResult.statistics.critical + qualityResult.statistics.high}</strong>
                </div>
                <div>
                  <span>已处理</span>
                  <strong>{qualityResult.statistics.resolved}</strong>
                </div>
              </div>
              {qualityResult.report.summary && (
                <div className="engineering-message">{qualityResult.report.summary}</div>
              )}
              {visibleQualityItems.length === 0 && (
                <div className="engineering-empty">当前没有待处理质量问题。</div>
              )}
              {visibleQualityItems.length > 0 && (
                <div className="engineering-step-list">
                  {visibleQualityItems.map((item) => (
                    <div className="engineering-step-row" key={item.id}>
                      <div>
                        <strong>{formatQualityTitle(item)}</strong>
                        <span className={`source-${item.severity === 'critical' || item.severity === 'high' ? 'missing' : item.severity === 'medium' ? 'fallback' : 'used'}`}>
                          {item.severity} / {item.status}
                        </span>
                      </div>
                      <small>{item.title}</small>
                      {item.quote && <small>原文：{item.quote}</small>}
                      {item.suggestion && <small>建议：{item.suggestion}</small>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

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
                  <span>{latestSnapshot.engineeringStateId ? 'active engineering' : 'no engineering'}</span>
                </div>
                <small>创建：{formatDate(latestSnapshot.createdAt)}</small>
              </div>
              <pre className="engineering-snapshot-summary">{latestSnapshot.promptSummary}</pre>
              {latestSnapshot.compiledContext.warnings.length > 0 && (
                <div className="engineering-error">{latestSnapshot.compiledContext.warnings.join('；')}</div>
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
              disabled={!latestJob || ['completed', 'failed', 'cancelled'].includes(latestJob.status)}
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
                <small>进度：{latestJob.progressPercent}% / provider：{latestJob.provider || '-'}</small>
                <div className="engineering-job-progress">
                  <span style={{ width: `${Math.max(0, Math.min(100, latestJob.progressPercent))}%` }} />
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

      <div className="engineering-actions">
        <button
          type="button"
          className="panel-btn panel-btn-secondary"
          disabled={busy || loading || compiling || jobRunning || draftRunning}
          onClick={handleSaveDraft}
        >
          保存草稿
        </button>
        <button
          type="button"
          className="panel-btn panel-btn-primary"
          disabled={busy || loading || compiling || jobRunning || draftRunning}
          onClick={handleSaveAndApply}
        >
          保存并应用
        </button>
      </div>
    </div>
  );
}
