import type { Dispatch, SetStateAction } from 'react';
import type {
  ChapterCard,
  ChapterEngineeringBundle,
  GenerationConstraints,
  QualityRules,
  ScenePlanItem,
} from '../../../types/chapterEngineering';
import type { ChapterGenerationSnapshot } from '../../../types/generationContext';
import type { GenerationJob, GenerationStepResult } from '../../../types/generationJob';
import type { GetQualityCheckIssuesResult, QualityCheckItem } from '../../../types/qualityCheck';
import { TABS, type LoopItem, type TabId } from './chapterEngineeringPanelSupport';
import { ChapterEngineeringConfigSections } from './ChapterEngineeringConfigSections';
import { ChapterEngineeringRuntimeSections } from './ChapterEngineeringRuntimeSections';

export interface ChapterEngineeringPanelViewProps {
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
  scenePlanRunning: boolean;
  scenePlanCandidate: ScenePlanItem[] | null;
  updateCard: <K extends keyof ChapterCard>(key: K, value: ChapterCard[K]) => void;
  updateConstraints: <K extends keyof GenerationConstraints>(
    key: K,
    value: GenerationConstraints[K],
  ) => void;
  updateWordRange: (key: 'min' | 'max', value?: number) => void;
  updateQuality: <K extends keyof QualityRules>(key: K, value: QualityRules[K]) => void;
  updateScene: <K extends keyof ScenePlanItem>(id: string, key: K, value: ScenePlanItem[K]) => void;
  updateSceneBeats: (id: string, values: string[]) => void;
  addScene: () => void;
  removeScene: (id: string) => void;
  onGenerateScenePlan: () => Promise<void>;
  onSaveScenePlanCandidate: (apply: boolean) => Promise<void>;
  toggleQualityCheck: (id: string) => void;
  handleCompileSnapshot: () => Promise<void>;
  handleRunDraftJob: () => Promise<void>;
  handleRunMockJob: () => Promise<void>;
  handleCancelJob: () => Promise<void>;
  handleSaveDraft: () => Promise<void>;
  handleSaveAndApply: () => Promise<void>;
}

export function ChapterEngineeringPanelView(props: ChapterEngineeringPanelViewProps) {
  const {
    activeTab,
    setActiveTab,
    statusText,
    dirty,
    loopItems,
    message,
    error,
    busy,
    loading,
    compiling,
    jobRunning,
    draftRunning,
    handleSaveDraft,
    handleSaveAndApply,
  } = props;

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

      <ChapterEngineeringConfigSections {...props} />
      <ChapterEngineeringRuntimeSections {...props} />

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
