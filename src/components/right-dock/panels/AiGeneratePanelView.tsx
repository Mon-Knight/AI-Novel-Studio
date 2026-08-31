import {
  CheckCircle2,
  ClipboardList,
  LoaderCircle,
  Palette,
  Save,
  Search,
  TriangleAlert,
} from 'lucide-react';
import type {
  AiSettings,
  ChapterGenerationContext,
  ChapterPromptDebugInfo,
  OutlineKeyPoint,
} from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type { StyleProfile } from '../../../types/style';
import type { OutputProfile } from '../../../types/output';
import type { DraftResultMetadata } from '../../../types/workspaceSafety';
import { ChapterStatusLabels } from '../../../types/chapter';
import { ChapterReadinessPlanCard } from '../../../features/agent-planner/ChapterReadinessPlanCard';
import { DshPreparationCard } from '../../../features/agent-planner/DshPreparationCard';
import { getChapterCharacterNames, getRequiredCharacterNames } from './aiGenerateValidation';
import type { GenerationValidationState } from './aiGenerateValidation';
import type { StreamPreviewStatus } from './useGenerationStreamPreview';
import { AiGenerateResultsView } from './AiGenerateResultsView';
import { AiGenerateStatusSections } from './AiGenerateStatusSections';
import { AiGenerateContextDetails } from './AiGenerateContextDetails';

interface AiGeneratePanelViewProps {
  novelId?: string;
  chapter: Chapter;
  settings: AiSettings;
  contextCount: number | null;
  contextLoadError: string;
  wordCountDraft: number;
  wordCountSaving: boolean;
  wordCountSaved: boolean;
  genMode: 'new' | 'rewrite';
  availableStyles: StyleProfile[];
  selectedStyleId: string;
  availableOutputs: OutputProfile[];
  selectedOutputId: string;
  userInstruction: string;
  contextSummary: ChapterGenerationContext | null;
  promptDebug: ChapterPromptDebugInfo | null;
  showContext: boolean;
  generating: boolean;
  revising: boolean;
  streamPreview: string;
  streamPreviewStatus: StreamPreviewStatus;
  statusMsg: string;
  errorMsg: string;
  validationState: GenerationValidationState | null;
  latestGeneratedDraft: import('../../../types/ai').ChapterDraft | null;
  latestGeneratedTarget: DraftResultMetadata | null;
  latestGeneratedAlreadyDisplayed: boolean;
  candidateApplyAvailable: boolean;
  adopting: boolean;
  onWordCountChange: (value: number) => void;
  onWordCountSave: () => void;
  onModeChange: (mode: 'new' | 'rewrite') => void;
  onStyleChange: (id: string) => void;
  onOutputChange: (id: string) => void;
  onInstructionChange: (value: string) => void;
  onPreviewContext: () => void;
  onGenerate: (options?: { retryMissingPoints?: OutlineKeyPoint[] }) => void;
  onReviseByOutline: () => void;
  onKeepDraft: () => void;
  onAppendCandidate: () => void;
  onReplaceCandidate: () => void;
  onAdopt: () => void;
}

export function AiGeneratePanelView({
  novelId,
  chapter,
  settings,
  contextCount,
  contextLoadError,
  wordCountDraft,
  wordCountSaving,
  wordCountSaved,
  genMode,
  availableStyles,
  selectedStyleId,
  availableOutputs,
  selectedOutputId,
  userInstruction,
  contextSummary,
  promptDebug,
  showContext,
  generating,
  revising,
  streamPreview,
  streamPreviewStatus,
  statusMsg,
  errorMsg,
  validationState,
  latestGeneratedDraft,
  latestGeneratedTarget,
  latestGeneratedAlreadyDisplayed,
  candidateApplyAvailable,
  adopting,
  onWordCountChange,
  onWordCountSave,
  onModeChange,
  onStyleChange,
  onOutputChange,
  onInstructionChange,
  onPreviewContext,
  onGenerate,
  onReviseByOutline,
  onKeepDraft,
  onAppendCandidate,
  onReplaceCandidate,
  onAdopt,
}: AiGeneratePanelViewProps) {
  return (
    <div>
      <ChapterReadinessPlanCard novelId={novelId} chapterId={chapter.id} />

      <DshPreparationCard
        novelId={novelId}
        chapterId={chapter.id}
        apiKey={settings.runtimeMode === 'api' ? settings.apiKey : undefined}
        baseUrl={settings.runtimeMode === 'api' ? settings.baseUrl : undefined}
        modelName={settings.modelName}
      />

      <AiGenerateStatusSections
        settings={settings}
        contextCount={contextCount}
        contextLoadError={contextLoadError}
      />

      {/* 当前章节 */}
      <div className="panel-section">
        <div className="panel-section-title">当前章节</div>
        <div className="panel-field">
          <div className="panel-field-label">章节</div>
          <div className="panel-field-value">
            第{chapter.chapterNumber}章：{chapter.title}
          </div>
        </div>
        <div className="panel-field" style={{ marginTop: 8 }}>
          <div className="panel-field-label">目标字数</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              value={wordCountDraft || ''}
              onChange={(e) => {
                onWordCountChange(Number(e.target.value));
              }}
              onBlur={() => {
                if (wordCountDraft <= 0) onWordCountChange(4000);
              }}
              min={500}
              max={50000}
              step={100}
              disabled={wordCountSaving}
              style={{
                width: 80,
                padding: '4px 8px',
                border: '1px solid var(--color-border)',
                borderRadius: 4,
                fontSize: 13,
                textAlign: 'center',
              }}
            />
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>字</span>
            <button
              className="btn btn-sm"
              onClick={onWordCountSave}
              disabled={wordCountSaving || wordCountDraft <= 0}
              style={{
                padding: '3px 10px',
                fontSize: 12,
                background: wordCountSaved ? 'var(--color-success)' : 'var(--color-primary)',
                color: 'var(--color-on-primary)',
                border: 'none',
                borderRadius: 4,
                whiteSpace: 'nowrap',
              }}
              aria-label={wordCountSaving ? '保存中' : wordCountSaved ? '已保存' : '保存目标字数'}
            >
              {wordCountSaving ? (
                <>
                  <LoaderCircle size={13} strokeWidth={1.8} aria-hidden="true" />
                  保存中
                </>
              ) : wordCountSaved ? (
                <>
                  <CheckCircle2 size={13} strokeWidth={1.8} aria-hidden="true" />
                  已保存
                </>
              ) : (
                <>
                  <Save size={13} strokeWidth={1.8} aria-hidden="true" />
                  保存
                </>
              )}
            </button>
          </div>
        </div>
        <div className="panel-field" style={{ marginTop: 8 }}>
          <div className="panel-field-label">状态</div>
          <div className="panel-field-value">{ChapterStatusLabels[chapter.status]}</div>
        </div>
      </div>

      {/* 生成模式 */}
      <div className="panel-section">
        <div className="panel-section-title">生成模式</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className={`panel-btn ${genMode === 'new' ? 'panel-btn-primary' : 'panel-btn-secondary'}`}
            onClick={() => onModeChange('new')}
            style={{ flex: 1 }}
          >
            生成新稿
          </button>
          <button
            className={`panel-btn ${genMode === 'rewrite' ? 'panel-btn-primary' : 'panel-btn-secondary'}`}
            onClick={() => onModeChange('rewrite')}
            style={{ flex: 1 }}
          >
            重新生成
          </button>
        </div>
      </div>

      {/* v1.0.26 风格方案与输出控制选择 */}
      <div className="panel-section">
        <div
          className="panel-section-title"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Palette size={14} strokeWidth={1.8} aria-hidden="true" />
          风格与输出配置
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>
          选择本章生成时的写作风格和输出控制方案
        </div>
        <div className="panel-field" style={{ marginBottom: 8 }}>
          <div className="panel-field-label">风格方案</div>
          <select
            className="panel-select"
            value={selectedStyleId}
            onChange={(e) => onStyleChange(e.target.value)}
            style={{ fontSize: 12 }}
          >
            {availableStyles.length === 0 && <option value="">无可用方案</option>}
            {availableStyles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div className="panel-field">
          <div className="panel-field-label">输出控制</div>
          <select
            className="panel-select"
            value={selectedOutputId}
            onChange={(e) => onOutputChange(e.target.value)}
            style={{ fontSize: 12 }}
          >
            {availableOutputs.length === 0 && <option value="">无可用方案</option>}
            {availableOutputs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        {selectedStyleId && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-muted)',
              marginTop: 6,
              lineHeight: 1.5,
            }}
          >
            {(() => {
              const s = availableStyles.find((x) => x.id === selectedStyleId);
              if (!s) return null;
              return [
                s.narrativePerspective && `视角 ${s.narrativePerspective}`,
                s.tone && `基调 ${s.tone}`,
                s.pace && `节奏 ${s.pace}`,
                `对话 ${Math.round(s.dialogueRatio * 100)}% · 描写 ${Math.round(s.descriptionRatio * 100)}%`,
              ]
                .filter(Boolean)
                .join(' · ');
            })()}
          </div>
        )}
      </div>

      {/* 额外要求 */}
      <div className="panel-section">
        <div className="panel-section-title">本次生成额外要求</div>
        <textarea
          className="form-textarea"
          value={userInstruction}
          onChange={(e) => onInstructionChange(e.target.value)}
          placeholder="例如：本章开头要压抑一些，结尾留下悬念..."
          style={{ width: '100%', height: 70, resize: 'vertical', fontSize: 13 }}
        />
      </div>

      {/* v1.0.25 上下文摘要预览 */}
      <div className="panel-section">
        <div
          className="panel-section-title"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <ClipboardList size={14} strokeWidth={1.8} aria-hidden="true" />
          本次将使用的上下文
        </div>
        {/* v1.0.42 内联摘要：始终显示出场角色和字数 */}
        {contextSummary && (
          <div
            style={{
              fontSize: 11,
              lineHeight: 1.6,
              color: 'var(--color-text-secondary)',
              marginBottom: 6,
              padding: '6px 8px',
              background: 'var(--color-bg-primary)',
              borderRadius: 4,
            }}
          >
            <span>目标字数：{contextSummary.targetWordCount || wordCountDraft} 字</span>
            <span style={{ marginLeft: 12 }}>
              章节大纲：{contextSummary.chapterOutline ? '有' : '无'}
            </span>
            <span style={{ marginLeft: 12 }}>
              大纲关键点：{contextSummary.outlineKeyPoints?.length || 0} 项
            </span>
            <span style={{ marginLeft: 12 }}>
              出场角色：
              {(() => {
                const nameList = getChapterCharacterNames(contextSummary);
                return nameList.length > 0
                  ? `${nameList.length} 个（${nameList.join('、')}）`
                  : '0 个';
              })()}
            </span>
            <span style={{ marginLeft: 12 }}>
              必须出场：
              {(() => {
                const nameList = getRequiredCharacterNames(contextSummary);
                return nameList.length > 0
                  ? `${nameList.length} 个（${nameList.join('、')}）`
                  : '0 个';
              })()}
            </span>
          </div>
        )}
        <button
          className="btn btn-secondary btn-sm"
          onClick={onPreviewContext}
          disabled={generating}
          style={{
            width: '100%',
            marginBottom: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          }}
        >
          <Search size={14} strokeWidth={1.8} aria-hidden="true" />
          查看上下文摘要
        </button>
        {contextSummary && !contextSummary.chapterOutline?.trim() && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-warning)',
              marginTop: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <TriangleAlert size={13} strokeWidth={1.8} aria-hidden="true" />
            当前章节大纲为空，建议先生成或填写章节大纲
          </div>
        )}
        {contextSummary &&
          contextSummary.chapterOutline?.trim() &&
          contextSummary.chapterOutline.trim().length < 30 && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--color-warning)',
                marginTop: 4,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <TriangleAlert size={13} strokeWidth={1.8} aria-hidden="true" />
              当前章节大纲过短，生成正文可能不遵循规划
            </div>
          )}
        {contextSummary && (contextSummary.outlineKeyPoints?.length || 0) === 0 && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-warning)',
              marginTop: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <TriangleAlert size={13} strokeWidth={1.8} aria-hidden="true" />
            未能从章节大纲中提取关键剧情点，建议补充更明确的大纲
          </div>
        )}
        {showContext && contextSummary && (
          <AiGenerateContextDetails
            context={contextSummary}
            promptDebug={promptDebug}
            styles={availableStyles}
            selectedStyleId={selectedStyleId}
            outputs={availableOutputs}
            selectedOutputId={selectedOutputId}
            wordCount={wordCountDraft}
          />
        )}
        <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 4 }}>
          点击「查看上下文摘要」可预览 AI 将收到的全部配置信息
        </div>
      </div>

      <AiGenerateResultsView
        novelId={novelId}
        chapter={chapter}
        streamPreview={streamPreview}
        streamPreviewStatus={streamPreviewStatus}
        statusMsg={statusMsg}
        errorMsg={errorMsg}
        validationState={validationState}
        contextSummary={contextSummary}
        generating={generating}
        revising={revising}
        latestGeneratedDraft={latestGeneratedDraft}
        latestGeneratedTarget={latestGeneratedTarget}
        latestGeneratedAlreadyDisplayed={latestGeneratedAlreadyDisplayed}
        candidateApplyAvailable={candidateApplyAvailable}
        adopting={adopting}
        genMode={genMode}
        onGenerate={onGenerate}
        onReviseByOutline={onReviseByOutline}
        onKeepDraft={onKeepDraft}
        onAppendCandidate={onAppendCandidate}
        onReplaceCandidate={onReplaceCandidate}
        onAdopt={onAdopt}
      />
    </div>
  );
}
