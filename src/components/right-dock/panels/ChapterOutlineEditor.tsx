import type { Chapter } from '../../../types/chapter';
import { Pencil, Save } from 'lucide-react';
import { ChapterStatusLabels } from '../../../types/chapter';
import { formatNumber } from '../../../utils/format';

interface ChapterOutlineEditorProps {
  chapter: Chapter;
  isEditing: boolean;
  outlineDraft: string;
  outlineSaveMsg: string;
  goalDraft: string;
  goalDirty: boolean;
  goalSaveMsg: string;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onOutlineDraftChange: (value: string) => void;
  onSaveOutline: () => void;
  onGoalChange: (value: string) => void;
  onSaveGoal: () => void;
}

export function ChapterOutlineEditor(props: ChapterOutlineEditorProps) {
  const {
    chapter,
    isEditing,
    outlineDraft,
    outlineSaveMsg,
    goalDraft,
    goalDirty,
    goalSaveMsg,
    onStartEdit,
    onCancelEdit,
    onOutlineDraftChange,
    onSaveOutline,
    onGoalChange,
    onSaveGoal,
  } = props;
  return (
    <>
      <div className="panel-section">
        <div className="panel-section-title">当前章节</div>
        <div className="panel-field">
          <div className="panel-field-label">标题</div>
          <div className="panel-field-value">
            第{chapter.chapterNumber}章：{chapter.title}
          </div>
        </div>
        <div className="panel-field" style={{ marginTop: 8 }}>
          <div className="panel-field-label">状态</div>
          <div className="panel-field-value">{ChapterStatusLabels[chapter.status]}</div>
        </div>
        {chapter.targetWordCount && (
          <div className="panel-field" style={{ marginTop: 8 }}>
            <div className="panel-field-label">目标字数</div>
            <div className="panel-field-value">{formatNumber(chapter.targetWordCount)} 字</div>
          </div>
        )}
      </div>
      <div className="panel-section">
        <div
          className="panel-section-title"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <span>章节大纲</span>
          {!isEditing ? (
            <button
              className="btn btn-secondary btn-sm"
              onClick={onStartEdit}
              style={{ fontSize: 11 }}
            >
              <Pencil aria-hidden="true" size={13} strokeWidth={1.8} />
              编辑
            </button>
          ) : (
            <span style={{ display: 'flex', gap: 4 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={onSaveOutline}
                style={{ fontSize: 11 }}
              >
                <Save aria-hidden="true" size={13} strokeWidth={1.8} />
                保存
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={onCancelEdit}
                style={{ fontSize: 11 }}
              >
                取消
              </button>
            </span>
          )}
        </div>
        {isEditing ? (
          <textarea
            className="form-textarea"
            value={outlineDraft}
            onChange={(event) => onOutlineDraftChange(event.target.value)}
            style={{
              width: '100%',
              height: 140,
              resize: 'vertical',
              fontSize: 13,
              lineHeight: 1.8,
              fontFamily: 'var(--font-family-editor)',
              marginTop: 6,
            }}
            placeholder="编辑章节大纲..."
            autoFocus
          />
        ) : chapter.outline ? (
          <div
            style={{
              fontSize: 13,
              color: 'var(--color-text-secondary)',
              lineHeight: 1.8,
              whiteSpace: 'pre-wrap',
            }}
          >
            {chapter.outline}
          </div>
        ) : (
          <div className="text-sm text-muted">
            本章尚未编写大纲
            <button
              className="btn btn-secondary btn-sm"
              onClick={onStartEdit}
              style={{ fontSize: 11, marginLeft: 8 }}
            >
              <Pencil aria-hidden="true" size={13} strokeWidth={1.8} />
              手动编写
            </button>
          </div>
        )}
        <SaveMessage value={outlineSaveMsg} />
      </div>
      <div className="panel-section">
        <div
          className="panel-section-title"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <span>本章目标</span>
          <button
            className="btn btn-primary btn-sm"
            onClick={onSaveGoal}
            disabled={!goalDirty}
            style={{ fontSize: 11 }}
          >
            <Save aria-hidden="true" size={13} strokeWidth={1.8} />
            保存本章目标
          </button>
        </div>
        <textarea
          className="form-textarea"
          value={goalDraft}
          onChange={(event) => onGoalChange(event.target.value)}
          style={{
            width: '100%',
            minHeight: 96,
            resize: 'vertical',
            fontSize: 13,
            lineHeight: 1.8,
            fontFamily: 'var(--font-family-editor)',
            marginTop: 6,
          }}
          placeholder="填写本章真正要达成的剧情目标，例如：系统开服并触发榜一绑定。"
        />
        <div
          style={{
            fontSize: 11,
            color: goalDirty ? 'var(--color-warning)' : 'var(--color-text-muted)',
            marginTop: 4,
          }}
        >
          {goalDirty
            ? '本章目标有未保存修改。生成正文前请先保存。'
            : '本章目标按当前章节独立保存，并会进入正文生成上下文。'}
        </div>
        <SaveMessage value={goalSaveMsg} />
      </div>
    </>
  );
}

function SaveMessage({ value }: { value: string }) {
  if (!value) return null;
  return (
    <div
      style={{
        fontSize: 11,
        marginTop: 4,
        color: value.includes('失败')
          ? 'var(--color-error)'
          : value.includes('已保存')
            ? 'var(--color-success)'
            : 'var(--color-text-muted)',
      }}
    >
      {value}
    </div>
  );
}
