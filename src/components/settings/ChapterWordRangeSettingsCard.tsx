import { useMemo, useState } from 'react';
import { Ruler } from 'lucide-react';
import {
  CHAPTER_WORD_RANGE_PERCENT_LIMITS,
  getChapterWordRangePercents,
  resolveChapterWordRange,
  saveChapterWordRangePercents,
  type ChapterWordRangePercents,
} from '../../services/conversation/chapterWordRangePolicy';

const PREVIEW_TARGET_DEFAULT = 3000;

function ChapterWordRangeSettingsCard() {
  const [draft, setDraft] = useState<ChapterWordRangePercents>(() => getChapterWordRangePercents());
  const [previewTarget, setPreviewTarget] = useState(PREVIEW_TARGET_DEFAULT);
  const [message, setMessage] = useState('');

  const preview = useMemo(
    () => resolveChapterWordRange(previewTarget, draft),
    [draft, previewTarget],
  );

  const handleSave = () => {
    const saved = saveChapterWordRangePercents(draft);
    setDraft(saved);
    setMessage('章节字数区间已保存，下一轮写章生效。');
    setTimeout(() => setMessage(''), 2500);
  };

  const previewText = preview
    ? '目标 ' +
      preview.target +
      ' 字 → 验收 ' +
      preview.hardMinimum +
      '～' +
      preview.hardMaximum +
      ' 字'
    : '请输入正整数目标字数以预览验收区间。';

  return (
    <section
      className="detail-card settings-card"
      aria-labelledby="chapter-word-range-title"
      data-testid="settings-chapter-word-range-card"
    >
      <div className="settings-card-heading">
        <Ruler aria-hidden="true" size={18} strokeWidth={1.8} />
        <span id="chapter-word-range-title">章节候选字数区间</span>
      </div>
      <p className="settings-help-text">
        按章节目标字数的百分比决定验收硬区间。Writing SubAgent 越界会直接拒收（不落候选卡）；确定性
        Writer 也会用同一硬区间做修复与验收。默认 80%～115%。
      </p>
      <div className="settings-form-grid">
        <label className="settings-field" htmlFor="chapter-word-range-min">
          <span>验收下限（占目标 %）</span>
          <input
            id="chapter-word-range-min"
            className="form-input"
            type="number"
            min={CHAPTER_WORD_RANGE_PERCENT_LIMITS.hardMinimumPercent.min}
            max={CHAPTER_WORD_RANGE_PERCENT_LIMITS.hardMinimumPercent.max}
            value={draft.hardMinimumPercent}
            data-testid="chapter-word-range-min"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                hardMinimumPercent: Number(event.target.value),
              }))
            }
          />
        </label>
        <label className="settings-field" htmlFor="chapter-word-range-max">
          <span>验收上限（占目标 %）</span>
          <input
            id="chapter-word-range-max"
            className="form-input"
            type="number"
            min={CHAPTER_WORD_RANGE_PERCENT_LIMITS.hardMaximumPercent.min}
            max={CHAPTER_WORD_RANGE_PERCENT_LIMITS.hardMaximumPercent.max}
            value={draft.hardMaximumPercent}
            data-testid="chapter-word-range-max"
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                hardMaximumPercent: Number(event.target.value),
              }))
            }
          />
        </label>
        <label className="settings-field" htmlFor="chapter-word-range-preview-target">
          <span>预览目标字数</span>
          <input
            id="chapter-word-range-preview-target"
            className="form-input"
            type="number"
            min={1}
            value={previewTarget}
            data-testid="chapter-word-range-preview-target"
            onChange={(event) => setPreviewTarget(Number(event.target.value))}
          />
        </label>
      </div>
      <div className="settings-help-text" role="status" data-testid="chapter-word-range-preview">
        {previewText}
      </div>
      <div className="settings-card-actions">
        {message ? (
          <span className="settings-help-text" role="status">
            {message}
          </span>
        ) : (
          <span className="settings-help-text">
            只保存在本机。将上限调到 120% 时，目标 3000 字允许至 3600 字。
          </span>
        )}
        <button
          type="button"
          className="btn btn-primary btn-sm"
          data-testid="chapter-word-range-save"
          onClick={handleSave}
        >
          保存字数区间
        </button>
      </div>
    </section>
  );
}

export default ChapterWordRangeSettingsCard;
