import type { AiSettings } from '../../../types/ai';
import type { Chapter } from '../../../types/chapter';
import type { Volume } from '../../../types/volume';
import type {
  ChapterOutlineCandidate,
  VolumeOutlineCandidate,
} from '../../../services/ai/outlineGenerateService';
import { formatNumber } from '../../../utils/format';
import { ChapterOutlineEditor } from './ChapterOutlineEditor';

export type OutlineGenMode = 'novel' | 'volume' | 'chapter' | null;

interface OutlinePanelViewProps {
  aiSettings: AiSettings;
  chapter?: Chapter;
  volume: Volume | null;
  loading: boolean;
  genMode: OutlineGenMode;
  error: string;
  applyError: string;
  applyMsg: string;
  novelOutline: string;
  onNovelOutlineChange: (value: string) => void;
  volumeOutline: VolumeOutlineCandidate | null;
  chapterOutlines: ChapterOutlineCandidate[];
  onChapterOutlinesChange: (value: ChapterOutlineCandidate[]) => void;
  isEditingChapterOutline: boolean;
  chapterOutlineDraft: string;
  chapterOutlineSaveMsg: string;
  chapterGoalDraft: string;
  chapterGoalDirty: boolean;
  chapterGoalSaveMsg: string;
  onGenerateNovelOutline: () => void;
  onGenerateVolumeOutline: () => void;
  onGenerateChapterOutlines: () => void;
  onAdoptNovelOutline: () => void;
  onAdoptChapterOutline: (candidate: ChapterOutlineCandidate) => void;
  onApplyGeneratedGoal: (goal?: string) => void;
  onStartEditChapterOutline: () => void;
  onCancelEditChapterOutline: () => void;
  onChapterOutlineDraftChange: (value: string) => void;
  onSaveChapterOutline: () => void;
  onChapterGoalChange: (value: string) => void;
  onSaveChapterGoal: () => void;
}

export function OutlinePanelView({
  aiSettings,
  chapter,
  volume,
  loading,
  genMode,
  error,
  applyError,
  applyMsg,
  novelOutline,
  onNovelOutlineChange,
  volumeOutline,
  chapterOutlines,
  onChapterOutlinesChange,
  isEditingChapterOutline,
  chapterOutlineDraft,
  chapterOutlineSaveMsg,
  chapterGoalDraft,
  chapterGoalDirty,
  chapterGoalSaveMsg,
  onGenerateNovelOutline,
  onGenerateVolumeOutline,
  onGenerateChapterOutlines,
  onAdoptNovelOutline,
  onAdoptChapterOutline,
  onApplyGeneratedGoal,
  onStartEditChapterOutline,
  onCancelEditChapterOutline,
  onChapterOutlineDraftChange,
  onSaveChapterOutline,
  onChapterGoalChange,
  onSaveChapterGoal,
}: OutlinePanelViewProps) {
  return (
    <div>
      <div className="panel-section" style={{ fontSize: 12, lineHeight: 1.8 }}>
        <div className="panel-section-title">🤖 AI 状态</div>
        <div>模式：{aiSettings.runtimeMode === 'mock' ? '🔶 Mock 模式' : '🔷 真实 API'}</div>
        {aiSettings.runtimeMode === 'api' && (
          <>
            <div>模型：{aiSettings.modelName || '未配置'}</div>
            {!aiSettings.apiKey && (
              <div style={{ color: 'var(--color-error)', marginTop: 4 }}>
                ⚠️ 未配置 API Key，请先到设置中心配置
              </div>
            )}
          </>
        )}
      </div>

      <div className="panel-section">
        <div className="panel-section-title">🤖 AI 大纲生成</div>
        <button
          className="btn btn-primary btn-sm"
          onClick={onGenerateNovelOutline}
          disabled={loading}
          style={{ width: '100%', marginBottom: 6 }}
        >
          {loading && genMode === 'novel' ? '⏳ 生成中...' : '📖 生成作品总大纲'}
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={onGenerateVolumeOutline}
          disabled={loading || !volume}
          style={{ width: '100%', marginBottom: 6 }}
        >
          {loading && genMode === 'volume' ? '⏳ 生成中...' : '📋 生成本卷大纲'}
        </button>
        {!volume && chapter && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>
            当前章节未归属分卷，无法生成卷大纲
          </div>
        )}
        <button
          className="btn btn-primary btn-sm"
          onClick={onGenerateChapterOutlines}
          disabled={loading || !chapter}
          style={{ width: '100%', marginBottom: 6 }}
        >
          {loading && genMode === 'chapter' ? '⏳ 生成中...' : '📝 生成章节大纲'}
        </button>
        {!chapter && (
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 6 }}>
            请先在左侧目录树中选择一个章节
          </div>
        )}
        {error && (
          <div style={{ fontSize: 12, color: 'var(--color-error)', marginBottom: 8 }}>{error}</div>
        )}
        {applyError && (
          <div style={{ fontSize: 12, color: 'var(--color-error)', marginBottom: 8 }}>
            {applyError}
          </div>
        )}
        {applyMsg && (
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-success)',
              marginBottom: 8,
              fontWeight: 500,
            }}
          >
            {applyMsg}
          </div>
        )}
      </div>

      {novelOutline && (
        <div
          className="panel-section"
          style={{ border: '1px solid var(--color-primary-light)', borderRadius: 6, padding: 10 }}
        >
          <div className="panel-section-title">📖 作品总大纲（可编辑）</div>
          <textarea
            className="input"
            value={novelOutline}
            onChange={(event) => onNovelOutlineChange(event.target.value)}
            style={{
              width: '100%',
              height: 160,
              resize: 'vertical',
              fontSize: 12,
              lineHeight: 1.7,
              fontFamily: 'var(--font-family-editor)',
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <button className="btn btn-secondary btn-sm" onClick={onAdoptNovelOutline}>
              📋 复制大纲
            </button>
          </div>
        </div>
      )}

      {volumeOutline && <VolumeOutlineResult outline={volumeOutline} />}

      {chapterOutlines.length > 0 && (
        <div className="panel-section">
          <div className="panel-section-title">📝 AI 章节大纲候选（{chapterOutlines.length}）</div>
          {chapterOutlines.map((candidate, index) => (
            <div
              key={index}
              className="panel-field"
              style={{
                marginBottom: 8,
                border: '1px solid var(--color-primary-light)',
                padding: 8,
                borderRadius: 6,
              }}
            >
              <div className="panel-field-label">{candidate.title}</div>
              <textarea
                className="input"
                value={candidate.rawText || candidate.outline}
                onChange={(event) => {
                  const updated = [...chapterOutlines];
                  updated[index] = candidate.rawText
                    ? { ...candidate, rawText: event.target.value }
                    : { ...candidate, outline: event.target.value };
                  onChapterOutlinesChange(updated);
                }}
                style={{
                  width: '100%',
                  height: 100,
                  resize: 'vertical',
                  fontSize: 12,
                  lineHeight: 1.6,
                  fontFamily: 'var(--font-family-editor)',
                }}
              />
              {candidate.goal && (
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  目标：{candidate.goal}
                  {chapter && (
                    <button
                      className="btn btn-text btn-sm"
                      onClick={() => onApplyGeneratedGoal(candidate.goal)}
                      style={{ fontSize: 11, marginLeft: 6 }}
                    >
                      应用到本章目标
                    </button>
                  )}
                </div>
              )}
              {candidate.targetWordCount && (
                <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                  建议字数：{formatNumber(candidate.targetWordCount)} 字
                </div>
              )}
              {chapter && (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => onAdoptChapterOutline(candidate)}
                    disabled={loading || !(candidate.rawText || candidate.outline)?.trim()}
                  >
                    ✅ 应用到当前章节
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {volume && (
        <div className="panel-section">
          <div className="panel-section-title">当前分卷</div>
          <div className="panel-field">
            <div className="panel-field-label">分卷名称</div>
            <div className="panel-field-value">{volume.title}</div>
          </div>
          {volume.goal && (
            <div className="panel-field" style={{ marginTop: 8 }}>
              <div className="panel-field-label">分卷目标</div>
              <div
                className="panel-field-value"
                style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-text-secondary)' }}
              >
                {volume.goal}
              </div>
            </div>
          )}
        </div>
      )}

      {chapter && (
        <ChapterOutlineEditor
          chapter={chapter}
          isEditing={isEditingChapterOutline}
          outlineDraft={chapterOutlineDraft}
          outlineSaveMsg={chapterOutlineSaveMsg}
          goalDraft={chapterGoalDraft}
          goalDirty={chapterGoalDirty}
          goalSaveMsg={chapterGoalSaveMsg}
          onStartEdit={onStartEditChapterOutline}
          onCancelEdit={onCancelEditChapterOutline}
          onOutlineDraftChange={onChapterOutlineDraftChange}
          onSaveOutline={onSaveChapterOutline}
          onGoalChange={onChapterGoalChange}
          onSaveGoal={onSaveChapterGoal}
        />
      )}
    </div>
  );
}

function VolumeOutlineResult({ outline }: { outline: VolumeOutlineCandidate }) {
  return (
    <div
      className="panel-section"
      style={{ border: '1px solid var(--color-primary-light)', borderRadius: 6, padding: 10 }}
    >
      <div className="panel-section-title">📋 分卷大纲</div>
      <div className="panel-field">
        <div className="panel-field-label">标题</div>
        <div className="panel-field-value">{outline.title}</div>
      </div>
      <div className="panel-field" style={{ marginTop: 6 }}>
        <div className="panel-field-label">摘要</div>
        <div
          className="panel-field-value"
          style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}
        >
          {outline.summary}
        </div>
      </div>
      {outline.goal && (
        <div className="panel-field" style={{ marginTop: 6 }}>
          <div className="panel-field-label">目标</div>
          <div className="panel-field-value" style={{ fontSize: 12 }}>
            {outline.goal}
          </div>
        </div>
      )}
      {outline.mainConflict && (
        <div className="panel-field" style={{ marginTop: 6 }}>
          <div className="panel-field-label">主要冲突</div>
          <div
            className="panel-field-value"
            style={{ fontSize: 12, color: 'var(--color-warning)' }}
          >
            {outline.mainConflict}
          </div>
        </div>
      )}
      {outline.rawText && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            marginTop: 8,
            whiteSpace: 'pre-wrap',
            maxHeight: 150,
            overflowY: 'auto',
          }}
        >
          原始返回：{outline.rawText.slice(0, 500)}
        </div>
      )}
    </div>
  );
}
