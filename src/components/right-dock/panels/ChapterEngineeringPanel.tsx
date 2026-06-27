import { useEffect, useMemo, useState } from 'react';
import { chapterEngineeringService, createDefaultChapterCard, createDefaultGenerationConstraints, createDefaultQualityRules, createDefaultScenePlan } from '../../../services/engineering/chapterEngineeringService';
import { generationContextCompiler } from '../../../services/generation/generationContextCompiler';
import { generationJobService } from '../../../services/generation/generationJobService';
import { generateId } from '../../../services/database/db';
import type { Chapter } from '../../../types/chapter';
import type {
  ChapterCard,
  ChapterEngineeringBundle,
  ChapterEngineeringState,
  GenerationConstraints,
  QualityRules,
  QualityStrictness,
  ScenePlanItem,
} from '../../../types/chapterEngineering';
import type { ChapterGenerationSnapshot } from '../../../types/generationContext';
import type { GenerationJob, GenerationStepResult } from '../../../types/generationJob';

interface ChapterEngineeringPanelProps {
  novelId?: string;
  chapter?: Chapter;
  currentEditorContent?: string;
}

type TabId = 'card' | 'scenes' | 'constraints' | 'quality' | 'snapshot' | 'jobs' | 'versions';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'card', label: '章节卡' },
  { id: 'scenes', label: '场景' },
  { id: 'constraints', label: '约束' },
  { id: 'quality', label: '质检' },
  { id: 'snapshot', label: '快照' },
  { id: 'jobs', label: '任务' },
  { id: 'versions', label: '版本' },
];

const QUALITY_CHECK_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'continuity', label: '连续性' },
  { id: 'constraint', label: '约束遵守' },
  { id: 'character', label: '角色一致' },
  { id: 'style', label: '文风一致' },
  { id: 'information_release', label: '信息释放' },
  { id: 'logic', label: '情节逻辑' },
];

function linesToArray(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function arrayToLines(value: string[]): string {
  return value.join('\n');
}

function formatDate(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  rows = 3,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="panel-field engineering-field">
      <span className="panel-field-label">{label}</span>
      {multiline ? (
        <textarea
          className="panel-textarea"
          value={value}
          rows={rows}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className="panel-input"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (value?: number) => void;
}) {
  return (
    <label className="panel-field engineering-field">
      <span className="panel-field-label">{label}</span>
      <input
        className="panel-input"
        type="number"
        min={0}
        value={value ?? ''}
        onChange={(event) => {
          const next = event.target.value.trim();
          onChange(next ? Number(next) : undefined);
        }}
      />
    </label>
  );
}

function ListField({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <label className="panel-field engineering-field">
      <span className="panel-field-label">{label}</span>
      <textarea
        className="panel-textarea"
        value={arrayToLines(value)}
        rows={rows}
        placeholder={placeholder}
        onChange={(event) => onChange(linesToArray(event.target.value))}
      />
    </label>
  );
}

function renumberScenes(items: ScenePlanItem[]): ScenePlanItem[] {
  return items.map((item, index) => ({ ...item, sceneNo: index + 1 }));
}

function createEmptyScene(sceneNo: number): ScenePlanItem {
  return {
    id: generateId(),
    sceneNo,
    title: `场景 ${sceneNo}`,
    location: '',
    characters: [],
    goal: '',
    conflict: '',
    keyActions: [],
    keyDialogue: '',
    informationRelease: [],
    result: '',
    transition: '',
  };
}

function ChapterEngineeringPanel({ novelId, chapter, currentEditorContent }: ChapterEngineeringPanelProps) {
  const effectiveNovelId = novelId ?? chapter?.novelId;
  const [activeTab, setActiveTab] = useState<TabId>('card');
  const [bundle, setBundle] = useState<ChapterEngineeringBundle | null>(null);
  const [latestSnapshot, setLatestSnapshot] = useState<ChapterGenerationSnapshot | null>(null);
  const [latestJob, setLatestJob] = useState<GenerationJob | null>(null);
  const [jobSteps, setJobSteps] = useState<GenerationStepResult[]>([]);
  const [card, setCard] = useState<ChapterCard>(() => createDefaultChapterCard());
  const [scenePlan, setScenePlan] = useState<ScenePlanItem[]>(() => createDefaultScenePlan());
  const [constraints, setConstraints] = useState<GenerationConstraints>(() => createDefaultGenerationConstraints());
  const [qualityRules, setQualityRules] = useState<QualityRules>(() => createDefaultQualityRules());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [jobRunning, setJobRunning] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setMessage('');
    setError('');

    if (!chapter?.id) {
      setBundle(null);
      setLatestSnapshot(null);
      setLatestJob(null);
      setJobSteps([]);
      setCard(createDefaultChapterCard());
      setScenePlan(createDefaultScenePlan());
      setConstraints(createDefaultGenerationConstraints());
      setQualityRules(createDefaultQualityRules());
      setDirty(false);
      return () => { alive = false; };
    }

    setLoading(true);
    Promise.all([
      chapterEngineeringService.getBundle(chapter.id, chapter),
      generationContextCompiler.getLatestByChapterId(chapter.id),
      generationJobService.getByChapterId(chapter.id),
    ])
      .then(async ([nextBundle, snapshot, jobs]) => {
        if (!alive) return;
        const source = nextBundle.latestDraft ?? nextBundle.activeState;
        setBundle(nextBundle);
        setLatestSnapshot(snapshot);
        const latest = jobs[0] ?? null;
        setLatestJob(latest);
        if (latest) {
          const steps = await generationJobService.getSteps(latest.id);
          if (alive) setJobSteps(steps);
        } else {
          setJobSteps([]);
        }
        setCard(source?.chapterCard ?? createDefaultChapterCard(chapter));
        setScenePlan(source?.scenePlan.length ? source.scenePlan : createDefaultScenePlan(chapter));
        setConstraints(source?.generationConstraints ?? createDefaultGenerationConstraints(chapter));
        setQualityRules(source?.qualityRules ?? createDefaultQualityRules());
        setDirty(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : '章节工程状态读取失败');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
  }, [chapter?.id, chapter?.title, chapter?.goal, chapter?.outline, chapter?.targetWordCount, chapter?.targetWords]);

  const statusText = useMemo(() => {
    const active = bundle?.activeState ? `active v${bundle.activeState.draftVersion}` : '未应用';
    const draft = bundle?.latestDraft ? `草稿 v${bundle.latestDraft.draftVersion}` : '无草稿';
    return `${active} / ${draft}${bundle?.hasUnappliedDraft ? ' / 有未应用草稿' : ''}`;
  }, [bundle]);

  const updateCard = <K extends keyof ChapterCard>(key: K, value: ChapterCard[K]) => {
    setCard((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const updateConstraints = <K extends keyof GenerationConstraints>(key: K, value: GenerationConstraints[K]) => {
    setConstraints((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const updateWordRange = (key: 'min' | 'max', value?: number) => {
    setConstraints((prev) => ({ ...prev, wordRange: { ...prev.wordRange, [key]: value } }));
    setDirty(true);
  };

  const updateQuality = <K extends keyof QualityRules>(key: K, value: QualityRules[K]) => {
    setQualityRules((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const updateScene = <K extends keyof ScenePlanItem>(id: string, key: K, value: ScenePlanItem[K]) => {
    setScenePlan((prev) => prev.map((item) => (item.id === id ? { ...item, [key]: value } : item)));
    setDirty(true);
  };

  const addScene = () => {
    setScenePlan((prev) => [...prev, createEmptyScene(prev.length + 1)]);
    setDirty(true);
  };

  const removeScene = (id: string) => {
    setScenePlan((prev) => renumberScenes(prev.filter((item) => item.id !== id)));
    setDirty(true);
  };

  const persistDraft = async (): Promise<ChapterEngineeringState | null> => {
    if (!chapter?.id || !effectiveNovelId) {
      setError('请先选择章节');
      return null;
    }
    const saved = await chapterEngineeringService.saveDraft({
      novelId: effectiveNovelId,
      volumeId: chapter.volumeId,
      chapterId: chapter.id,
      chapterCard: card,
      scenePlan,
      generationConstraints: constraints,
      qualityRules,
    }, chapter);
    const nextBundle = await chapterEngineeringService.getBundle(chapter.id, chapter);
    setBundle(nextBundle);
    setDirty(false);
    return saved;
  };

  const handleSaveDraft = async () => {
    setBusy(true);
    setError('');
    setMessage('正在保存草稿...');
    try {
      const saved = await persistDraft();
      if (saved) setMessage(`已保存草稿 v${saved.draftVersion}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '章节工程草稿保存失败');
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAndApply = async () => {
    if (!chapter?.id) return;
    setBusy(true);
    setError('');
    setMessage('正在保存并应用...');
    try {
      const target = dirty ? await persistDraft() : (bundle?.latestDraft ?? bundle?.activeState ?? await persistDraft());
      if (!target) return;
      const active = await chapterEngineeringService.activate(target.id, chapter.id, chapter);
      const nextBundle = await chapterEngineeringService.getBundle(chapter.id, chapter);
      setBundle(nextBundle);
      setDirty(false);
      setMessage(`已应用 active v${active.draftVersion}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '章节工程状态应用失败');
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  const handleCompileSnapshot = async () => {
    if (!chapter?.id || !effectiveNovelId) {
      setError('请先选择章节');
      return;
    }
    if (dirty) {
      setError('请先保存并应用当前工程修改，再编译上下文快照。');
      return;
    }
    setCompiling(true);
    setError('');
    setMessage('正在编译上下文快照...');
    try {
      const snapshot = await generationContextCompiler.compileAndSave({
        novelId: effectiveNovelId,
        volumeId: chapter.volumeId,
        chapterId: chapter.id,
        currentEditorContent,
      });
      setLatestSnapshot(snapshot);
      setMessage(`已编译上下文快照 ${snapshot.contextHash}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '上下文快照编译失败');
      setMessage('');
    } finally {
      setCompiling(false);
    }
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
    setJobRunning(true);
    setError('');
    setMessage('正在运行 Mock 生成任务...');
    try {
      const finalJob = await generationJobService.runMockChapterJob({
        novelId: effectiveNovelId,
        volumeId: chapter.volumeId,
        chapterId: chapter.id,
        currentEditorContent,
      }, (job, steps) => {
        setLatestJob(job);
        setJobSteps(steps);
      });
      setLatestJob(finalJob);
      setJobSteps(await generationJobService.getSteps(finalJob.id));
      setMessage(`Mock 任务已${finalJob.status === 'completed' ? '完成' : finalJob.status}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Mock 生成任务失败');
      setMessage('');
    } finally {
      setJobRunning(false);
    }
  };

  const handleCancelJob = async () => {
    if (!latestJob || latestJob.status === 'completed' || latestJob.status === 'failed' || latestJob.status === 'cancelled') return;
    setError('');
    try {
      const cancelled = await generationJobService.cancel(latestJob.id);
      if (cancelled) {
        setLatestJob(cancelled);
        setJobSteps(await generationJobService.getSteps(cancelled.id));
        setMessage('任务已取消');
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '任务取消失败');
    }
  };

  const toggleQualityCheck = (id: string) => {
    const exists = qualityRules.enabledChecks.includes(id);
    updateQuality(
      'enabledChecks',
      exists
        ? qualityRules.enabledChecks.filter((item) => item !== id)
        : [...qualityRules.enabledChecks, id],
    );
  };

  if (!chapter) {
    return (
      <div className="engineering-empty">
        请先在左侧目录树中选择一个章节。
      </div>
    );
  }

  return (
    <div className="engineering-panel">
      <div className="engineering-status">
        <span>{statusText}</span>
        {dirty && <strong>已修改</strong>}
      </div>

      <div className="engineering-tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
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
              className="panel-btn panel-btn-secondary"
              disabled={busy || loading || compiling || jobRunning}
              onClick={handleRunMockJob}
            >
              {jobRunning ? 'Mock 运行中...' : '启动 Mock 任务'}
            </button>
            <button
              type="button"
              className="panel-btn panel-btn-warning"
              disabled={!latestJob || ['completed', 'failed', 'cancelled'].includes(latestJob.status)}
              onClick={handleCancelJob}
            >
              取消任务
            </button>
          </div>
          {!latestJob && <div className="engineering-empty">暂无生成任务。</div>}
          {latestJob && (
            <>
              <div className="engineering-version-row">
                <div>
                  <strong>{latestJob.status}</strong>
                  <span>{latestJob.currentStep || latestJob.jobType}</span>
                </div>
                <small>进度：{latestJob.progressPercent}% / provider：{latestJob.provider || '-'}</small>
                <div className="engineering-job-progress">
                  <span style={{ width: `${Math.max(0, Math.min(100, latestJob.progressPercent))}%` }} />
                </div>
              </div>
              <div className="engineering-step-list">
                {jobSteps.map((step) => (
                  <div className="engineering-step-row" key={step.id}>
                    <div>
                      <strong>{step.stepName}</strong>
                      <span className={`source-${step.status === 'succeeded' ? 'used' : step.status === 'failed' ? 'missing' : 'fallback'}`}>
                        {step.status}
                      </span>
                    </div>
                    {step.outputText && <small>{step.outputText}</small>}
                    {step.errorMessage && <small>{step.errorMessage}</small>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="engineering-actions">
        <button
          type="button"
          className="panel-btn panel-btn-secondary"
          disabled={busy || loading || compiling || jobRunning}
          onClick={handleSaveDraft}
        >
          保存草稿
        </button>
        <button
          type="button"
          className="panel-btn panel-btn-primary"
          disabled={busy || loading || compiling || jobRunning}
          onClick={handleSaveAndApply}
        >
          保存并应用
        </button>
      </div>
    </div>
  );
}

export default ChapterEngineeringPanel;
