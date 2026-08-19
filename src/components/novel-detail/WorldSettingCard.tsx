import { useEffect, useState } from 'react';
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🌍</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>世界背景</span>
        </div>
        {!editing && (
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
            ✏️ 编辑
          </button>
        )}
      </div>

      <div className="text-sm text-muted" style={{ marginBottom: 8 }}>
        这里只需要输入大致世界背景，不要求一次性填写完整世界观。后续 AI
        会根据这些内容辅助整理结构化设定。
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="form-input"
            placeholder="设定标题"
            style={{ width: '100%' }}
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="form-textarea"
            placeholder="描述这个世界的背景、时代、地理、社会结构等..."
            style={{
              width: '100%',
              height: 200,
              resize: 'vertical',
              fontSize: 14,
              lineHeight: 1.8,
            }}
          />
          {message && (
            <div
              style={{
                fontSize: 13,
                color: message === '保存成功' ? 'var(--color-success)' : 'var(--color-error)',
              }}
            >
              {message}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(false)}>
              取消
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '💾 保存'}
            </button>
          </div>
        </div>
      ) : (
        <div>
          {content ? (
            <div
              style={{
                fontSize: 14,
                color: 'var(--color-text-secondary)',
                lineHeight: 1.8,
                whiteSpace: 'pre-wrap',
              }}
            >
              {content.slice(0, 300)}
              {content.length > 300 ? '...' : ''}
            </div>
          ) : (
            <div style={{ color: 'var(--color-text-muted)', fontSize: 14, fontStyle: 'italic' }}>
              尚未填写世界背景，点击编辑开始填写
            </div>
          )}
          {activeSetting && (
            <div className="text-sm text-muted" style={{ marginTop: 8 }}>
              最后更新：{formatDate(activeSetting.updatedAt)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default WorldSettingCard;
