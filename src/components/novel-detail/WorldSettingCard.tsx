import { useEffect, useState } from 'react';
import { Globe2, Pencil, Save } from 'lucide-react';
import type { WorldSetting } from '../../types/setting';
import { formatDate } from '../../utils/date';

interface WorldSettingCardProps {
  novelId: string;
  settings: WorldSetting[];
  onSave: (id: string | null, data: { title: string; content: string }) => Promise<void>;
}

function WorldSettingCard({ settings, onSave }: WorldSettingCardProps) {
  const activeSetting = settings.find((s) => s.isActive) || settings[0];
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(activeSetting?.title || '默认世界设定');
  const [content, setContent] = useState(activeSetting?.content || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const s = settings.find((s) => s.isActive) || settings[0];
    setTitle(s?.title || '默认世界设定');
    setContent(s?.content || '');
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      await onSave(activeSetting?.id || null, { title, content });
      setMessage('保存成功');
      setEditing(false);
      setTimeout(() => setMessage(''), 2000);
    } catch {
      setMessage('保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="detail-card">
      <div className="detail-card-header">
        <div className="detail-card-title">
          <Globe2 aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>世界背景</span>
        </div>
        {!editing && (
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" size={14} strokeWidth={1.8} />
            编辑
          </button>
        )}
      </div>

      <div className="text-sm text-muted detail-gap-bottom">
        这里只需要输入大致世界背景，不要求一次性填写完整世界观。后续 AI
        会根据这些内容辅助整理结构化设定。
      </div>

      {editing ? (
        <div className="detail-form detail-form--tight">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="form-input detail-fill"
            placeholder="设定标题"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="form-textarea detail-textarea detail-textarea--xl"
            placeholder="描述这个世界的背景、时代、地理、社会结构等..."
          />
          {message && (
            <div
              className={`detail-save-status detail-save-status--inline${
                message === '保存成功' ? ' is-ok' : ''
              }`}
            >
              {message}
            </div>
          )}
          <div className="detail-form-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>
              取消
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
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
        <div>
          {content ? (
            <div className="detail-fact-text detail-fact-text--pre">
              {content.slice(0, 300)}
              {content.length > 300 ? '...' : ''}
            </div>
          ) : (
            <div className="detail-empty-hint">尚未填写世界背景，点击编辑开始填写</div>
          )}
          {activeSetting && (
            <div className="text-sm text-muted detail-gap-top">
              最后更新：{formatDate(activeSetting.updatedAt)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default WorldSettingCard;
