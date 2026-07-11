import { useRef, useEffect, useState } from 'react';
import type { PanelType } from '../../pages/WritingWorkspace/WritingWorkspacePage';
import type { Chapter } from '../../types/chapter';
import type { ChapterDraft } from '../../types/ai';
import type { AiTextApplyPayload, DraftResultMetadata } from '../../types/workspaceSafety';
import type { WritingContext } from '../../utils/writingContext';
import type { RightSidebarState, PanelToolState } from '../../store/rightSidebarStore';
import { getOrCreateToolState, createInitialSidebarState } from '../../store/rightSidebarStore';
import AiGeneratePanel from './panels/AiGeneratePanel';
import ChapterEngineeringPanel from './panels/ChapterEngineeringPanel';
import OutlinePanel from './panels/OutlinePanel';
import CharactersPanel from './panels/CharactersPanel';
import EventsPanel from './panels/EventsPanel';
import SettingPanel from './panels/SettingPanel';
import StylePanel from './panels/StylePanel';
import CheckPanel from './panels/CheckPanel';
import PolishPanel from './panels/PolishPanel';
import ChapterSummaryPanel from './panels/ChapterSummaryPanel';
import ContextViewPanel from './panels/ContextViewPanel';

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
  onLocateText?: (startOffset: number, endOffset: number, quote?: string, paragraphIndex?: number) => void;
  /** v1.7.19 质量检查状态持久化 */
  qcReport?: any;
  qcItems?: any[];
  onQcChange?: (report: any, items: any[]) => void;
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
}

const panelConfig: Record<string, { title: string; component: React.FC<any> }> = {
  'ai-generate': { title: 'AI 章节生成', component: AiGeneratePanel },
  'engineering': { title: '章节工程', component: ChapterEngineeringPanel },
  'outline': { title: '大纲查看', component: OutlinePanel },
  'characters': { title: '角色管理', component: CharactersPanel },
  'events': { title: '事件管理', component: EventsPanel },
  'setting': { title: '设定查看', component: SettingPanel },
  'style': { title: '风格方案', component: StylePanel },
  'check': { title: '质量检查', component: CheckPanel },
  'polish': { title: '润色优化', component: PolishPanel },
  'chapter-summary': { title: '章节总结', component: ChapterSummaryPanel },
  'context-view': { title: '上下文记录', component: ContextViewPanel },
};

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
  const toolOutputStale = !!(effectivePanelType && writingContext && currentToolState?.relatedContentHash
    && currentToolState.relatedContentHash !== writingContext.contentHash);

  // v1.0.24: 全局 mousedown 监听 —— 精确 click-outside 判断
  useEffect(() => {
    if (!panelType) return; // 无面板时不需要监听
    function handleDocumentMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (panelRef.current?.contains(target)) return;
      if (target.closest('.right-toolbar')) return;
      onClose();
    }
    document.addEventListener('mousedown', handleDocumentMouseDown, true);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown, true);
  }, [onClose, panelType]);

  // v1.0.44: 面板收起时使用 display:none 而非卸载，保留 AI 输出等状态
  if (!effectivePanelType) return null;
  const config = panelConfig[effectivePanelType];
  if (!config) return null;

  const PanelComponent = config.component;

  // v1.0.24: 阻止面板内部所有交互事件冒泡到外部
  const stopAll = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation?.();
  };

  return (
    <div className="right-panel-overlay" style={!panelType ? { display: 'none' } : undefined}>
      <div
        ref={panelRef}
        className="right-panel"
        onMouseDown={stopAll}
        onClick={stopAll}
      >
        <div className="right-panel-header">
          <span className="right-panel-title">{config.title}</span>
          <button
            className="right-panel-close"
            onMouseDown={stopAll}
            onClick={(e) => { stopAll(e); onClose(); }}
          >
            ✕
          </button>
        </div>
        <div className="right-panel-body" onMouseDown={stopAll} onClick={stopAll}>
          {/* v1.0.45: 正文变更后提示旧 AI 输出可能过期 */}
          {toolOutputStale && (
            <div className="panel-stale-warning">
              <span className="panel-stale-warning-icon">⚠️</span>
              <span>正文已修改，当前 AI 输出可能基于旧正文。建议重新生成。</span>
            </div>
          )}
          <PanelComponent
            novelId={novelId}
            chapter={chapter}
            onGenerated={onGenerated}
            onAdopted={onAdopted}
            onChapterOutlineApplied={onChapterOutlineApplied}
            onChapterGoalDirtyChange={onChapterGoalDirtyChange}
            onChapterCharactersChanged={onChapterCharactersChanged}
            contextVersion={contextVersion}
            onLocateText={onLocateText}
            qcReport={qcReport}
            qcItems={qcItems}
            onQcChange={onQcChange}
            currentEditorContent={currentEditorContent}
            currentEditorWordCount={currentEditorWordCount}
            currentEditorDirty={currentEditorDirty}
            currentContentHash={currentContentHash}
            currentDraftId={currentDraftId}
            currentDraftVersion={currentDraftVersion}
            onApplyAiText={onApplyAiText}
            onBeforeDocumentChange={onBeforeDocumentChange}
            showAiModal={showAiModal}
            updateAiModal={updateAiModal}
            hideAiModal={hideAiModal}
            // v1.0.45 统一上下文 + 状态
            writingContext={writingContext}
            onUpdateToolState={effectivePanelType ? (patch: Partial<PanelToolState>) => onUpdateToolState?.(effectivePanelType, patch) : undefined}
          />
        </div>
      </div>
    </div>
  );
}

export default RightPanel;
