/**
 * AI Novel Studio - 上下文记录新建表单
 */
import { useState } from 'react';
import type { ContextRecordType } from '../../types/context';
import { ContextRecordTypeLabels } from '../../types/context';

interface ContextRecordFormProps {
  novelId: string;
  chapterId?: string;
  onSave: (input: {
    novelId: string;
    chapterId?: string;
    contextType: ContextRecordType;
    title: string;
    content: string;
    importance: number;
  }) => void;
  onCancel: () => void;
}

const contextTypes: ContextRecordType[] = [
  'chapter_summary',
  'character_state',
  'foreshadow',
  'relationship',
  'plot_progress',
  'rule',
  'other',
];

function ContextRecordForm({ novelId, chapterId, onSave, onCancel }: ContextRecordFormProps) {
  const [contextType, setContextType] = useState<ContextRecordType>('other');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [importance, setImportance] = useState(3);

  const handleSubmit = () => {
    if (!title.trim() || !content.trim()) return;
    onSave({
      novelId,
      chapterId,
      contextType,
      title: title.trim(),
      content: content.trim(),
      importance,
    });
    setTitle('');
    setContent('');
    setImportance(3);
  };

  return (
    <div
      style={{
        padding: 12,
        background: 'var(--color-bg-primary)',
        borderRadius: 6,
        border: '1px solid var(--color-border-light)',
        marginBottom: 12,
      }}
    >
      <div style={{ fontWeight: 500, marginBottom: 8, fontSize: 13 }}>📝 新上下文记录</div>
      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>类型</label>
            <select
              className="input"
              value={contextType}
              onChange={(e) => setContextType(e.target.value as ContextRecordType)}
              style={{ width: '100%' }}
            >
              {contextTypes.map((t) => (
                <option key={t} value={t}>
                  {ContextRecordTypeLabels[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
              重要度 {importance}/5
            </label>
            <input
              className="input"
              type="range"
              min="1"
              max="5"
              value={importance}
              onChange={(e) => setImportance(Number(e.target.value))}
              style={{ width: '100%', height: 28 }}
            />
          </div>
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>标题 *</label>
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="如：主角不能暴露能力"
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>内容 *</label>
          <textarea
            className="input"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            placeholder="详细描述需要记住的信息"
            style={{ width: '100%', resize: 'vertical', fontSize: 12 }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleSubmit}
            disabled={!title.trim() || !content.trim()}
          >
            ✅ 保存
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

export default ContextRecordForm;
