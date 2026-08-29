import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type SyntheticEvent,
} from 'react';
import { TriangleAlert, X } from 'lucide-react';
import type { Chapter } from '../../types/chapter';
import type { ChapterDraft } from '../../types/ai';
import type { QualityCheckItem, QualityCheckReport } from '../../types/qualityCheck';
import type { PanelType, RightDockPanelType } from '../../types/rightSidebar';
import type { AiTextApplyPayload, DraftResultMetadata } from '../../types/workspaceSafety';
import type { WritingContext } from '../../utils/writingContext';
import type { RightSidebarState, PanelToolState } from '../../store/rightSidebarStore';
import { getOrCreateToolState, createInitialSidebarState } from '../../store/rightSidebarStore';
import PanelErrorBoundary from '../common/PanelErrorBoundary';

const AiGeneratePanel = lazy(() => import('./panels/AiGeneratePanel'));
const ChapterEngineeringPanel = lazy(() => import('./panels/ChapterEngineeringPanel'));
const OutlinePanel = lazy(() => import('./panels/OutlinePanel'));
const CharactersPanel = lazy(() => import('./panels/CharactersPanel'));
const EventsPanel = lazy(() => import('./panels/EventsPanel'));
const SettingPanel = lazy(() => import('./panels/SettingPanel'));
const StylePanel = lazy(() => import('./panels/StylePanel'));
const CheckPanel = lazy(() => import('./panels/CheckPanel'));
const PolishPanel = lazy(() => import('./panels/PolishPanel'));
const ChapterSummaryPanel = lazy(() => import('./panels/ChapterSummaryPanel'));
const ContextViewPanel = lazy(() => import('./panels/ContextViewPanel'));
const MultiAgentPanelRuntime = lazy(() => import('./panels/MultiAgentPanelRuntime'));
const MemoryInspectorPanel = lazy(() => import('./panels/MemoryInspectorPanel'));
const GenerationTracePanel = lazy(() => import('./panels/GenerationTracePanel'));

interface RightPanelProps {
  panelType: PanelType;
  onClose: () => void;
  novelId?: string;
  chapter?: Chapter;
  onGenerated?: (draft: ChapterDraft, metadata?: DraftResultMetadata) => void;
  onAdopted?: () => void;
  onChapterOutlineApplied?: (chapterId: string) => void;
  onChapterGoalDirtyChange?: (dirty: boolean) => void;
  onChapterCharactersChanged?: () => void;
  contextVersion?: number;
  /** 定位正文回调 (v1.7.16 4参数) */
  onLocateText?: (
    startOffset: number,
    endOffset: number,
    quote?: string,
    paragraphIndex?: number,
  ) => void;
  /** v1.7.19 质量检查状态持久化 */
  qcReport?: QualityCheckReport | null;
  qcItems?: QualityCheckItem[];
  onQcChange?: (report: QualityCheckReport | null, items: QualityCheckItem[]) => void;
  currentEditorContent?: string;
  currentEditorWordCount?: number;
  currentEditorDirty?: boolean;
  currentContentHash?: string;
  currentDraftId?: string;
  currentDraftVersion?: number;
  onApplyAiText?: (payload: AiTextApplyPayload) => Promise<boolean>;
  onBeforeDocumentChange?: () => Promise<boolean>;
  showAiModal?: (title: string, subtitle?: string) => void;
  updateAiModal?: (stage: string, progress: number) => void;
  hideAiModal?: () => void;
  /** v1.0.45 统一写作上下文 */
  writingContext?: WritingContext;
  /** v1.0.45 统一右侧栏状态模型 */
  sidebarState?: RightSidebarState;
  /** v1.0.45 更新面板运行时状态 */
  onUpdateToolState?: (toolKey: string, patch: Partial<PanelToolState>) => void;
  documentAvailable?: boolean;
}

type PanelContentProps = Omit<
  RightPanelProps,
  | 'panelType'
  | 'onClose'
  | 'sidebarState'
  | 'onUpdateToolState'
  | 'documentAvailable'
  | 'writingContext'
> & {
  onUpdateToolState?: (patch: Partial<PanelToolState>) => void;
};

interface PanelConfig {
  title: string;
  component: ComponentType<PanelContentProps>;
}

const panelConfig: Record<RightDockPanelType, PanelConfig> = {
  'ai-generate': { title: 'AI 章节生成', component: (props) => <AiGeneratePanel {...props} /> },
  engineering: {
    title: '章节工程',
    component: (props) => <ChapterEngineeringPanel {...props} />,
  },
  outline: { title: '大纲查看', component: (props) => <OutlinePanel {...props} /> },
  characters: { title: '角色管理', component: (props) => <CharactersPanel {...props} /> },
  events: { title: '事件管理', component: (props) => <EventsPanel {...props} /> },
  setting: { title: '设定查看', component: (props) => <SettingPanel {...props} /> },
  style: { title: '风格方案', component: (props) => <StylePanel {...props} /> },
  check: { title: '质量检查', component: (props) => <CheckPanel {...props} /> },
  polish: { title: '润色优化', component: (props) => <PolishPanel {...props} /> },
  'multi-agent': {
    title: 'Multi-Agent 协作',
    component: (props) => <MultiAgentPanelRuntime {...props} />,
  },
  'chapter-summary': {
    title: '章节总结',
    component: (props) => <ChapterSummaryPanel {...props} />,
  },
  'context-view': {
    title: '上下文记录',
    component: (props) => <ContextViewPanel {...props} />,
  },
  'memory-inspector': {
    title: '记忆检查器',
    component: (props) => <MemoryInspectorPanel {...props} />,
  },
  'generation-trace': {
    title: '生成追溯',
    component: (props) => <GenerationTracePanel {...props} />,
  },
};

const DOCUMENT_REQUIRED_PANELS = new Set<RightDockPanelType>([
  'ai-generate',
  'engineering',
  'check',
  'polish',
  'multi-agent',
  'chapter-summary',
]);

const EDITOR_SENSITIVE_PANELS = new Set<RightDockPanelType>([
  'ai-generate',
  'engineering',
  'check',
  'polish',
  'multi-agent',
]);

const EDITOR_PROP_KEYS = new Set<keyof PanelContentProps>([
  'currentEditorContent',
  'currentEditorWordCount',
  'currentEditorDirty',
  'currentContentHash',
]);

interface PanelRuntimeProps {
  panelType: RightDockPanelType;
  component: ComponentType<PanelContentProps>;
  model: PanelContentProps;
  onUpdateToolState?: RightPanelProps['onUpdateToolState'];
}

function PanelRuntime({
  panelType,
  component: PanelComponent,
  model,
  onUpdateToolState,
}: PanelRuntimeProps) {
  const updateToolState = useCallback(
    (patch: Partial<PanelToolState>) => onUpdateToolState?.(panelType, patch),
    [onUpdateToolState, panelType],
  );
  return (
    <PanelComponent
      {...model}
      onUpdateToolState={onUpdateToolState ? updateToolState : undefined}
    />
  );
}

function panelRuntimePropsEqual(previous: PanelRuntimeProps, next: PanelRuntimeProps): boolean {
  if (
    previous.panelType !== next.panelType ||
    previous.component !== next.component ||
    previous.onUpdateToolState !== next.onUpdateToolState
  ) {
    return false;
  }

  const compareEditorSnapshot = EDITOR_SENSITIVE_PANELS.has(next.panelType);
  const previousModel = previous.model as Record<string, unknown>;
  const nextModel = next.model as Record<string, unknown>;
  for (const key of Object.keys(nextModel) as Array<keyof PanelContentProps>) {
    if (!compareEditorSnapshot && EDITOR_PROP_KEYS.has(key)) continue;
    if (previousModel[key] !== nextModel[key]) return false;
  }
  return true;
}

const MemoizedPanelRuntime = memo(PanelRuntime, panelRuntimePropsEqual);

function RightPanel({
  panelType,
  onClose,
  novelId,
  chapter,
  onGenerated,
  onAdopted,
  onChapterOutlineApplied,
  onChapterGoalDirtyChange,
  onChapterCharactersChanged,
  contextVersion,
  onLocateText,
  qcReport,
  qcItems,
  onQcChange,
  currentEditorContent,
  currentEditorWordCount,
  currentEditorDirty,
  currentContentHash,
  currentDraftId,
  currentDraftVersion,
  onApplyAiText,
  onBeforeDocumentChange,
  showAiModal,
  updateAiModal,
  hideAiModal,
  writingContext,
  sidebarState,
  onUpdateToolState,
  documentAvailable = true,
}: RightPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // v1.0.44: 记住上次活跃面板类型，收起时用 CSS 隐藏而非卸载，保留面板内部状态
  const [lastPanelType, setLastPanelType] = useState<PanelType>(null);

  useEffect(() => {
    if (panelType) setLastPanelType(panelType);
  }, [panelType]);

  // v1.0.45: 检测当前面板的 AI 输出是否基于旧正文
  const effectivePanelType = panelType || lastPanelType;
  const currentToolState: PanelToolState | undefined = effectivePanelType
    ? getOrCreateToolState(sidebarState ?? createInitialSidebarState(), effectivePanelType)
    : undefined;
  const toolOutputStale = !!(
    effectivePanelType &&
    writingContext &&
    currentToolState?.relatedContentHash &&
    currentToolState.relatedContentHash !== writingContext.contentHash
  );

  const panelModel = useMemo<PanelContentProps>(
    () => ({
      novelId,
      chapter,
      onGenerated,
      onAdopted,
      onChapterOutlineApplied,
      onChapterGoalDirtyChange,
      onChapterCharactersChanged,
      contextVersion,
      onLocateText,
      qcReport,
      qcItems,
      onQcChange,
      currentEditorContent,
      currentEditorWordCount,
      currentEditorDirty,
      currentContentHash,
      currentDraftId,
      currentDraftVersion,
      onApplyAiText,
      onBeforeDocumentChange,
      showAiModal,
      updateAiModal,
      hideAiModal,
    }),
    [
      chapter,
      contextVersion,
      currentContentHash,
      currentDraftId,
      currentDraftVersion,
      currentEditorContent,
      currentEditorDirty,
      currentEditorWordCount,
      hideAiModal,
      novelId,
      onAdopted,
      onApplyAiText,
      onBeforeDocumentChange,
      onChapterCharactersChanged,
      onChapterGoalDirtyChange,
      onChapterOutlineApplied,
      onGenerated,
      onLocateText,
      onQcChange,
      qcItems,
      qcReport,
      showAiModal,
      updateAiModal,
    ],
  );

  // v1.0.24: 全局 mousedown 监听 —— 精确 click-outside 判断
  useEffect(() => {
    if (!panelType) return; // 无面板时不需要监听
    function handleDocumentMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (panelRef.current?.contains(target)) return;
      if (target.closest('.right-toolbar')) return;
      if (target.closest('[data-e2e-dialog-host="true"]')) return;
      onClose();
    }
    document.addEventListener('mousedown', handleDocumentMouseDown, true);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown, true);
  }, [onClose, panelType]);

  // v1.0.44: 面板收起时使用 display:none 而非卸载，保留 AI 输出等状态
  if (!effectivePanelType || effectivePanelType === 'draft-history') return null;
  const config = panelConfig[effectivePanelType];

  const PanelComponent = config.component;
  const documentRequired = DOCUMENT_REQUIRED_PANELS.has(effectivePanelType);

  // v1.0.24: 阻止面板内部所有交互事件冒泡到外部
  const stopAll = (e: SyntheticEvent) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation?.();
  };

  return (
    <div className="right-panel-overlay" style={!panelType ? { display: 'none' } : undefined}>
      <div ref={panelRef} className="right-panel" onMouseDown={stopAll} onClick={stopAll}>
        <div className="right-panel-header">
          <span className="right-panel-title">{config.title}</span>
          <button
            type="button"
            className="right-panel-close"
            aria-label={`关闭${config.title}`}
            title="关闭"
            onMouseDown={stopAll}
            onClick={(e) => {
              stopAll(e);
              onClose();
            }}
          >
            <X aria-hidden="true" size={17} strokeWidth={1.8} />
          </button>
        </div>
        <div className="right-panel-body" onMouseDown={stopAll} onClick={stopAll}>
          {/* v1.0.45: 正文变更后提示旧 AI 输出可能过期 */}
          {toolOutputStale && (
            <div className="panel-stale-warning">
              <TriangleAlert
                className="panel-stale-warning-icon"
                aria-hidden="true"
                size={15}
                strokeWidth={1.8}
              />
              <span>正文已修改，当前 AI 输出可能基于旧正文。建议重新生成。</span>
            </div>
          )}
          {!documentAvailable && documentRequired ? (
            <div className="panel-content-unavailable" role="alert">
              <strong>完整正文暂时无法读取</strong>
              <p>为避免截断内容进入 AI 上下文，本面板已暂停。请先在编辑区重新读取正文。</p>
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="panel-loading" role="status">
                  正在加载工具…
                </div>
              }
            >
              <PanelErrorBoundary panelTitle={config.title}>
                <MemoizedPanelRuntime
                  panelType={effectivePanelType}
                  component={PanelComponent}
                  model={panelModel}
                  onUpdateToolState={onUpdateToolState}
                />
              </PanelErrorBoundary>
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}

export default RightPanel;
