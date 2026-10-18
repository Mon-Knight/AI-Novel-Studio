import { useState, useEffect } from 'react';
import { ModalFrame } from '../common/ModalFrame';
import type {
  Chapter,
  CreateChapterInput,
  UpdateChapterInput,
  ChapterStatus,
} from '../../types/chapter';
import type { Volume } from '../../types/volume';
import { ChapterStatusLabels } from '../../types/chapter';
import { Link } from 'react-router-dom';
import {
  chapterDetailsPatch,
  rebaseChapterDetails,
  CHAPTER_DETAILS_CONFLICT,
} from '../../services/chapters/chapterDetails';
import { describeUnknownError } from '../../utils/errorMessage';

interface ChapterFormModalProps {
  initial: Chapter | null;
  novelId: string;
  volumeId?: string;
  volumes: Volume[];
  onSave: (
    input: CreateChapterInput | UpdateChapterInput,
    baseline?: Chapter,
  ) => void | Promise<void>;
  onRefresh?: () => Promise<Chapter | null>;
  onClose: () => void;
}

function ChapterFormModal({
  initial,
  novelId,
  volumeId: defaultVolumeId,
  volumes,
  onSave,
  onClose,
  onRefresh,
}: ChapterFormModalProps) {
  const [title, setTitle] = useState(initial?.title || '');
  const [volumeId, setVolumeId] = useState(initial?.volumeId || defaultVolumeId || '');
  const [outline, setOutline] = useState(initial?.outline || '');
  const [goal, setGoal] = useState(initial?.goal || '');
  const [targetWordCount, setTargetWordCount] = useState(initial?.targetWordCount || 0);
  const [status, setStatus] = useState<ChapterStatus>(initial?.status || 'not_started');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState(initial);
  const [conflicted, setConflicted] = useState(false);
  const [latest, setLatest] = useState<Chapter | null>(null);

  useEffect(() => {
    if (initial) {
      setBaseline(initial);
      setTitle(initial.title);
      setVolumeId(initial.volumeId || '');
      setOutline(initial.outline || '');
      setGoal(initial.goal || '');
      setTargetWordCount(initial.targetWordCount || 0);
      setStatus(initial.status);
    }
  }, [initial]);

  const handleSave = async () => {
    if (saving || conflicted) return;
    if (!title.trim()) {
      setError('章节标题不能为空');
      return;
    }
    if (title.trim().length > 80) {
      setError('章节标题不超过 80 字');
      return;
    }
    if (
      !Number.isInteger(targetWordCount) ||
      (targetWordCount !== 0 && (targetWordCount < 500 || targetWordCount > 20000))
    ) {
      setError('目标字数建议 500-20000');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const values = {
        title: title.trim(),
        volumeId,
        goal: goal.trim(),
        targetWordCount,
        status,
      };
      await onSave(
        baseline
          ? chapterDetailsPatch(baseline, values)
          : {
              ...values,
              novelId,
              volumeId: volumeId || undefined,
              outline: outline.trim() || undefined,
              targetWordCount: targetWordCount || undefined,
            },
        baseline ?? undefined,
      );
    } catch (cause) {
      const message = describeUnknownError(cause, '保存章节失败，请重试');
      setError(message);
      setConflicted(message.includes(CHAPTER_DETAILS_CONFLICT));
    } finally {
      setSaving(false);
    }
  };

  const refresh = async () => {
    if (!onRefresh || saving) return;
    setSaving(true);
    setLatest(null);
    setError('');
    try {
      const current = await onRefresh();
      if (
        !current ||
        current.id !== baseline?.id ||
        current.novelId !== novelId ||
        current.deletedAt
      )
        throw new Error('章节已删除或不属于当前作品，输入已保留，请重新打开作品核对。');
      setLatest(current);
    } catch (cause) {
      setError(describeUnknownError(cause, '读取最新章节失败。'));
    } finally {
      setSaving(false);
    }
  };

  const useLatest = () => {
    if (!baseline || !latest) return;
    const values = rebaseChapterDetails(
      baseline,
      { title, volumeId, goal, targetWordCount, status },
      latest,
    );
    setTitle(values.title);
    setVolumeId(values.volumeId);
    setGoal(values.goal);
    setTargetWordCount(values.targetWordCount);
    setStatus(values.status);
    setBaseline(latest);
    setLatest(null);
    setConflicted(false);
    setError('');
  };

  return (
    <ModalFrame
      title={initial ? '编辑章节' : '新建章节'}
      maxWidth={560}
      onDismiss={onClose}
      busy={saving}
      initialFocusSelector='input[aria-label="章节标题"]'
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void handleSave()}
            disabled={saving || conflicted}
          >
            {saving ? '保存中…' : initial ? '保存' : '创建章节'}
          </button>
        </>
      }
    >
      <fieldset
        disabled={saving}
        style={{
          border: 0,
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div>
          <label className="panel-field-label">章节标题 *</label>
          <input
            type="text"
            aria-label="章节标题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="form-input"
            placeholder="如：异乡醒来"
            style={{ width: '100%' }}
            autoFocus
          />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label className="panel-field-label">所属分卷</label>
            <select
              aria-label="所属分卷"
              value={volumeId}
              onChange={(e) => setVolumeId(e.target.value)}
              className="panel-select"
            >
              <option value="">无（独立章节）</option>
              {volumes.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="panel-field-label">目标字数</label>
            <input
              type="number"
              aria-label="目标字数"
              value={targetWordCount}
              onChange={(e) => setTargetWordCount(Number(e.target.value))}
              className="form-input"
              min={500}
              max={20000}
              style={{ width: '100%' }}
            />
          </div>
        </div>
        <div>
          <label className="panel-field-label">章节大纲</label>
          {baseline ? (
            <>
              <p className="text-sm text-muted">
                章节大纲在大纲编辑器保存版本并明确采用；此处保存仅修改章节资料。
              </p>
              <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 140, overflow: 'auto' }}>
                {baseline.outline || '暂无采用章纲'}
              </pre>
              <Link to={`/novels/${novelId}/outline?type=chapter&chapterId=${baseline.id}`}>
                核对并编辑采用章纲
              </Link>
            </>
          ) : (
            <textarea
              aria-label="章节大纲"
              value={outline}
              onChange={(e) => setOutline(e.target.value)}
              className="form-textarea"
              placeholder="描述本章的主要情节、场景和转折点..."
              style={{
                width: '100%',
                height: 140,
                resize: 'vertical',
                fontSize: 14,
                lineHeight: 1.8,
              }}
            />
          )}
        </div>
        <div>
          <label className="panel-field-label">本章目标</label>
          <input
            type="text"
            aria-label="本章目标"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="form-input"
            placeholder="本章要达成的创作目标"
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <label className="panel-field-label">章节状态</label>
          <select
            aria-label="章节状态"
            value={status}
            onChange={(e) => setStatus(e.target.value as ChapterStatus)}
            className="panel-select"
          >
            {Object.entries(ChapterStatusLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <div role="alert" style={{ fontSize: 13, color: 'var(--color-error)' }}>
            {error}
          </div>
        )}
        {conflicted && (
          <section>
            <p>输入已保留。刷新并核对正式章节后，再确认使用最新基线。</p>
            <button type="button" className="btn btn-secondary" onClick={() => void refresh()}>
              刷新正式版本（保留输入）
            </button>
            {latest && (
              <div aria-label="最新正式章节">
                <h3>最新正式版本</h3>
                <dl>
                  <dt>章节标题</dt>
                  <dd>{latest.title}</dd>
                  <dt>所属分卷</dt>
                  <dd>{volumes.find((volume) => volume.id === latest.volumeId)?.title || '无'}</dd>
                  <dt>本章目标</dt>
                  <dd>{latest.goal || '未填写'}</dd>
                  <dt>目标字数</dt>
                  <dd>{latest.targetWordCount || '未设定'}</dd>
                  <dt>章节状态</dt>
                  <dd>{ChapterStatusLabels[latest.status]}</dd>
                </dl>
                <details>
                  <summary>查看最新采用章纲</summary>
                  <pre style={{ whiteSpace: 'pre-wrap' }}>{latest.outline || '暂无采用章纲'}</pre>
                </details>
                <button type="button" className="btn btn-secondary" onClick={useLatest}>
                  已核对，使用最新基线（保留输入）
                </button>
              </div>
            )}
          </section>
        )}
      </fieldset>
    </ModalFrame>
  );
}

export default ChapterFormModal;
