import { useEffect, useState } from 'react';
import { BookOpenText, Pencil, Save } from 'lucide-react';
import type { Novel } from '../../types/novel';
import { formatNumber } from '../../utils/format';
import { formatDate } from '../../utils/date';

interface NovelBasicInfoCardProps {
  novel: Novel;
  onSave: (data: {
    title: string;
    subtitle: string;
    genre: string;
    description: string;
    status: string;
    targetWordCount: number;
  }) => void;
}

const statusOptions = [
  { value: 'draft', label: '草稿' },
  { value: 'planning', label: '规划中' },
  { value: 'writing', label: '创作中' },
  { value: 'paused', label: '已暂停' },
  { value: 'completed', label: '已完成' },
];

function NovelBasicInfoCard({ novel, onSave }: NovelBasicInfoCardProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(novel.title);
  const [subtitle, setSubtitle] = useState(novel.subtitle || '');
  const [genre, setGenre] = useState(novel.genre || '');
  const [description, setDescription] = useState(novel.description || '');
  const [status, setStatus] = useState(novel.status);
  const [targetWordCount, setTargetWordCount] = useState(novel.targetWordCount || 0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setTitle(novel.title);
    setSubtitle(novel.subtitle || '');
    setGenre(novel.genre || '');
    setDescription(novel.description || '');
    setStatus(novel.status);
    setTargetWordCount(novel.targetWordCount || 0);
  }, [novel]);

  const handleSave = async () => {
    if (!title.trim()) {
      setMessage('作品名称不能为空');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await onSave({
        title: title.trim(),
        subtitle: subtitle.trim(),
        genre: genre.trim(),
        description: description.trim(),
        status,
        targetWordCount,
      });
      setMessage('保存成功');
      setEditing(false);
      setTimeout(() => setMessage(''), 2000);
    } catch {
      setMessage('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setTitle(novel.title);
    setSubtitle(novel.subtitle || '');
    setGenre(novel.genre || '');
    setDescription(novel.description || '');
    setStatus(novel.status);
    setTargetWordCount(novel.targetWordCount || 0);
    setEditing(false);
    setMessage('');
  };

  return (
    <div
      className="detail-card"
      data-testid="project-settings"
      data-project-id={novel.id}
      data-project-name={novel.title}
      data-saving={saving ? 'true' : 'false'}
      data-editing={editing ? 'true' : 'false'}
    >
      <div className="detail-card-header detail-card-header--roomy">
        <div className="detail-card-title">
          <BookOpenText aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>作品信息</span>
        </div>
        {!editing ? (
          <button
            data-testid="project-edit"
            className="btn btn-secondary btn-sm"
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden="true" size={14} strokeWidth={1.8} />
            编辑
          </button>
        ) : null}
      </div>

      {editing ? (
        <div className="detail-form">
          <div>
            <label className="panel-field-label">作品名称 *</label>
            <input
              type="text"
              data-testid="project-name-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="form-input detail-input-title"
              placeholder="请输入作品名称"
            />
          </div>
          <div className="detail-form-grid">
            <div>
              <label className="panel-field-label">副标题</label>
              <input
                type="text"
                value={subtitle}
                onChange={(e) => setSubtitle(e.target.value)}
                className="form-input detail-fill"
                placeholder="可选"
              />
            </div>
            <div>
              <label className="panel-field-label">题材</label>
              <input
                type="text"
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="form-input detail-fill"
                placeholder="如：科幻、仙侠、悬疑"
              />
            </div>
          </div>
          <div>
            <label className="panel-field-label">简介</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="form-textarea detail-textarea detail-textarea--md"
              placeholder="简要介绍作品背景和主要情节方向"
            />
          </div>
          <div className="detail-form-grid">
            <div>
              <label className="panel-field-label">作品状态</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as Novel['status'])}
                className="panel-select"
              >
                {statusOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="panel-field-label">目标总字数</label>
              <input
                type="number"
                value={targetWordCount}
                onChange={(e) => setTargetWordCount(Number(e.target.value))}
                className="form-input detail-fill"
                placeholder="如：300000"
                min={0}
              />
            </div>
          </div>
          <div className="detail-form-actions">
            <button className="btn btn-secondary btn-sm" onClick={handleCancel}>
              取消
            </button>
            <button
              data-testid="project-save"
              className="btn btn-primary btn-sm"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? (
                '保存中...'
              ) : (
                <>
                  <Save aria-hidden="true" size={14} strokeWidth={1.8} />
                  保存
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="detail-form detail-form--compact">
          <div className="detail-form-grid detail-form-grid--tight">
            <div>
              <span className="text-sm text-muted">作品名称</span>
              <div className="detail-fact-value detail-fact-value--strong">{novel.title}</div>
            </div>
            <div>
              <span className="text-sm text-muted">题材</span>
              <div className="detail-fact-value">{novel.genre || '未设置'}</div>
            </div>
          </div>
          {novel.subtitle && (
            <div>
              <span className="text-sm text-muted">副标题</span>
              <div>{novel.subtitle}</div>
            </div>
          )}
          <div>
            <span className="text-sm text-muted">简介</span>
            <div className="detail-fact-text">{novel.description || '暂无简介'}</div>
          </div>
          <div className="detail-form-grid detail-form-grid--tight detail-form-grid--3">
            <div>
              <span className="text-sm text-muted">状态</span>
              <div>
                {statusOptions.find((o) => o.value === novel.status)?.label || novel.status}
              </div>
            </div>
            <div>
              <span className="text-sm text-muted">目标字数</span>
              <div>{formatNumber(novel.targetWordCount || 0)} 字</div>
            </div>
            <div>
              <span className="text-sm text-muted">最后更新</span>
              <div>{formatDate(novel.updatedAt)}</div>
            </div>
          </div>
        </div>
      )}
      {message && (
        <div
          data-testid={message === '保存成功' ? 'success-notice' : 'error-notice'}
          className={`detail-save-status${message === '保存成功' ? ' is-ok' : ''}`}
        >
          {message}
        </div>
      )}
    </div>
  );
}

export default NovelBasicInfoCard;
