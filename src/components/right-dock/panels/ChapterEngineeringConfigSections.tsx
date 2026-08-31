import type { QualityStrictness } from '../../../types/chapterEngineering';
import { QUALITY_CHECK_OPTIONS, formatQualityTitle } from './chapterEngineeringPanelSupport';
import { ListField, NumberField, TextField } from './ChapterEngineeringFields';
import type { ChapterEngineeringPanelViewProps } from './ChapterEngineeringPanelView';
import { ChapterEngineeringScenePlanView } from './ChapterEngineeringScenePlanView';

export function ChapterEngineeringConfigSections({
  activeTab,
  card,
  scenePlan,
  constraints,
  qualityRules,
  qualityResult,
  visibleQualityItems,
  busy,
  loading,
  compiling,
  jobRunning,
  draftRunning,
  scenePlanRunning,
  scenePlanCandidate,
  updateCard,
  updateConstraints,
  updateWordRange,
  updateQuality,
  updateScene,
  updateSceneBeats,
  addScene,
  removeScene,
  onGenerateScenePlan,
  onSaveScenePlanCandidate,
  toggleQualityCheck,
}: ChapterEngineeringPanelViewProps) {
  return (
    <>
      {activeTab === 'card' && (
        <div className="panel-section">
          <div className="panel-section-title">Chapter Card</div>
          <TextField
            label="章节标题"
            value={card.chapterTitle}
            onChange={(value) => updateCard('chapterTitle', value)}
          />
          <TextField
            label="分卷标题"
            value={card.volumeTitle}
            onChange={(value) => updateCard('volumeTitle', value)}
          />
          <TextField
            label="本章目标"
            value={card.chapterGoal}
            onChange={(value) => updateCard('chapterGoal', value)}
            multiline
          />
          <TextField
            label="开场状态"
            value={card.openingState}
            onChange={(value) => updateCard('openingState', value)}
            multiline
          />
          <TextField
            label="结束状态"
            value={card.endingState}
            onChange={(value) => updateCard('endingState', value)}
            multiline
          />
          <TextField
            label="核心冲突"
            value={card.coreConflict}
            onChange={(value) => updateCard('coreConflict', value)}
            multiline
          />
          <TextField
            label="视角角色"
            value={card.viewpointCharacter}
            onChange={(value) => updateCard('viewpointCharacter', value)}
          />
          <TextField
            label="主要地点"
            value={card.primaryLocation}
            onChange={(value) => updateCard('primaryLocation', value)}
          />
          <NumberField
            label="目标字数"
            value={card.targetWordCount}
            onChange={(value) => updateCard('targetWordCount', value)}
          />
          <ListField
            label="出场角色"
            value={card.appearingCharacters}
            onChange={(value) => updateCard('appearingCharacters', value)}
          />
          <ListField
            label="必须发生"
            value={card.mustHappenEvents}
            onChange={(value) => updateCard('mustHappenEvents', value)}
          />
          <ListField
            label="禁止发生"
            value={card.forbiddenEvents}
            onChange={(value) => updateCard('forbiddenEvents', value)}
          />
          <ListField
            label="已知信息"
            value={card.knownInformation}
            onChange={(value) => updateCard('knownInformation', value)}
          />
          <ListField
            label="未知信息"
            value={card.unknownInformation}
            onChange={(value) => updateCard('unknownInformation', value)}
          />
          <ListField
            label="本章释放信息"
            value={card.releasedInformation}
            onChange={(value) => updateCard('releasedInformation', value)}
          />
          <ListField
            label="保留悬念"
            value={card.reservedMysteries}
            onChange={(value) => updateCard('reservedMysteries', value)}
          />
          <TextField
            label="情绪曲线"
            value={card.emotionalCurve}
            onChange={(value) => updateCard('emotionalCurve', value)}
            multiline
          />
          <TextField
            label="章末钩子"
            value={card.endingHook}
            onChange={(value) => updateCard('endingHook', value)}
            multiline
          />
          <ListField
            label="文风要求"
            value={card.styleRequirements}
            onChange={(value) => updateCard('styleRequirements', value)}
          />
          <ListField
            label="写法禁区"
            value={card.forbiddenWriting}
            onChange={(value) => updateCard('forbiddenWriting', value)}
          />
        </div>
      )}

      {activeTab === 'scenes' && (
        <ChapterEngineeringScenePlanView
          scenePlan={scenePlan}
          scenePlanRunning={scenePlanRunning}
          scenePlanCandidate={scenePlanCandidate}
          busy={busy}
          loading={loading}
          compiling={compiling}
          jobRunning={jobRunning}
          draftRunning={draftRunning}
          updateScene={updateScene}
          updateSceneBeats={updateSceneBeats}
          addScene={addScene}
          removeScene={removeScene}
          onGenerateCandidate={onGenerateScenePlan}
          onSaveCandidate={onSaveScenePlanCandidate}
        />
      )}

      {activeTab === 'constraints' && (
        <div className="panel-section">
          <div className="panel-section-title">Generation Constraints</div>
          <ListField
            label="必须遵守"
            value={constraints.mustFollow}
            onChange={(value) => updateConstraints('mustFollow', value)}
          />
          <ListField
            label="不得改变"
            value={constraints.forbiddenChanges}
            onChange={(value) => updateConstraints('forbiddenChanges', value)}
          />
          <ListField
            label="不得新增"
            value={constraints.forbiddenAdditions}
            onChange={(value) => updateConstraints('forbiddenAdditions', value)}
          />
          <ListField
            label="不得提前发生"
            value={constraints.forbiddenEarlyEvents}
            onChange={(value) => updateConstraints('forbiddenEarlyEvents', value)}
          />
          <ListField
            label="不得提前揭示"
            value={constraints.forbiddenEarlyReveals}
            onChange={(value) => updateConstraints('forbiddenEarlyReveals', value)}
          />
          <ListField
            label="禁用词"
            value={constraints.bannedWords}
            onChange={(value) => updateConstraints('bannedWords', value)}
            rows={3}
          />
          <ListField
            label="禁用句式"
            value={constraints.bannedSentencePatterns}
            onChange={(value) => updateConstraints('bannedSentencePatterns', value)}
            rows={3}
          />
          <TextField
            label="叙事人称"
            value={constraints.narrativePerson}
            onChange={(value) => updateConstraints('narrativePerson', value)}
          />
          <div className="engineering-two-col">
            <NumberField
              label="最少字数"
              value={constraints.wordRange.min}
              onChange={(value) => updateWordRange('min', value)}
            />
            <NumberField
              label="最多字数"
              value={constraints.wordRange.max}
              onChange={(value) => updateWordRange('max', value)}
            />
          </div>
          <TextField
            label="节奏要求"
            value={constraints.pacingRequirement}
            onChange={(value) => updateConstraints('pacingRequirement', value)}
            multiline
          />
          <TextField
            label="对白比例"
            value={constraints.dialogueRatio}
            onChange={(value) => updateConstraints('dialogueRatio', value)}
          />
          <TextField
            label="描写比例"
            value={constraints.descriptionRatio}
            onChange={(value) => updateConstraints('descriptionRatio', value)}
          />
          <TextField
            label="战斗/动作风格"
            value={constraints.combatStyle}
            onChange={(value) => updateConstraints('combatStyle', value)}
          />
          <TextField
            label="信息释放方式"
            value={constraints.informationReleaseMode}
            onChange={(value) => updateConstraints('informationReleaseMode', value)}
            multiline
          />
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
              onChange={(event) =>
                updateQuality('strictness', event.target.value as QualityStrictness)
              }
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
          <ListField
            label="自定义规则"
            value={qualityRules.customRules}
            onChange={(value) => updateQuality('customRules', value)}
          />
          <ListField
            label="自动修复禁区"
            value={qualityRules.autoFixForbidden}
            onChange={(value) => updateQuality('autoFixForbidden', value)}
          />

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
                  <strong>
                    {qualityResult.statistics.critical + qualityResult.statistics.high}
                  </strong>
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
                        <span
                          className={`source-${item.severity === 'critical' || item.severity === 'high' ? 'missing' : item.severity === 'medium' ? 'fallback' : 'used'}`}
                        >
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
    </>
  );
}
