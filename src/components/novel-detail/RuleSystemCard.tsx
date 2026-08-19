import { useState } from 'react';
import type { RuleSystem } from '../../types/setting';
import { confirmDanger } from '../../utils/nativeDialog';

const ruleCategoryOptions = [
  { value: '', label: '不限' },
  { value: 'magic', label: '魔法' },
  { value: 'technology', label: '科技' },
  { value: 'cultivation', label: '修炼' },
  { value: 'combat', label: '战斗' },
  { value: 'social', label: '社会' },
  { value: 'other', label: '其他' },
];

interface RuleSystemCardProps {
  novelId: string;
  ruleSystems: RuleSystem[];
  onSave: (
    id: string | null,
    data: {
      title: string;
      category?: string;
      content: string;
      forbiddenRules?: string;
    },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function RuleSystemCard({ ruleSystems, onSave, onDelete }: RuleSystemCardProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState('');
  const [forbiddenRules, setForbiddenRules] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const startNew = () => {
    setEditingId(null);
    setIsNew(true);
    setTitle('');
    setCategory('');
    setContent('');
    setForbiddenRules('');
  };

  const startEdit = (rs: RuleSystem) => {
    setEditingId(rs.id);
    setIsNew(false);
    setTitle(rs.title);
    setCategory(rs.category || '');
    setContent(rs.content);
    setForbiddenRules(rs.forbiddenRules || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setIsNew(false);
    setMessage('');
  };

  const handleSave = async () => {
    if (!title.trim()) {
      setMessage('规则名称不能为空');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      await onSave(isNew ? null : editingId, {
        title: title.trim(),
        category: category || undefined,
        content,
        forbiddenRules: forbiddenRules || undefined,
      });
      setMessage('保存成功');
      setEditingId(null);
      setIsNew(false);
      setTimeout(() => setMessage(''), 2000);
    } catch {
      setMessage('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!(await confirmDanger({ title: '删除规则', message: '确定删除此规则体系？' }))) return;
    try {
      await onDelete(id);
    } catch {
      setMessage('删除失败');
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
          <span style={{ fontSize: 18 }}>⚖️</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>规则体系</span>
        </div>
        {!editingId && !isNew && (
          <button className="btn btn-secondary btn-sm" onClick={startNew}>
            + 新增规则
          </button>
        )}
      </div>

      <div className="text-sm text-muted" style={{ marginBottom: 12 }}>
        这里用于描述魔法、科技、修炼、战斗或社会规则。正文生成时，AI 必须遵守这些规则。
      </div>

      {/* 已有规则列表 */}
      {ruleSystems.map((rs) =>
        editingId === rs.id ? (
          <RuleEditForm
            key={rs.id}
            title={title}
            setTitle={setTitle}
            category={category}
            setCategory={setCategory}
            content={content}
            setContent={setContent}
            forbiddenRules={forbiddenRules}
            setForbiddenRules={setForbiddenRules}
            message={message}
            saving={saving}
            onSave={handleSave}
            onCancel={cancelEdit}
          />
        ) : (
          <div
            key={rs.id}
            style={{
              border: '1px solid var(--color-border-light)',
              borderRadius: 8,
              padding: 12,
              marginBottom: 8,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontWeight: 500 }}>{rs.title}</span>
                {rs.category && (
                  <span
                    style={{
                      fontSize: 11,
                      marginLeft: 8,
                      padding: '1px 6px',
                      background: 'var(--color-bg-hover)',
                      borderRadius: 4,
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {ruleCategoryOptions.find((o) => o.value === rs.category)?.label || rs.category}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => startEdit(rs)}>
                  ✏️
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleDelete(rs.id)}
                  style={{ color: 'var(--color-error)' }}
                >
                  🗑️
                </button>
              </div>
            </div>
            <div
              style={{
                fontSize: 13,
                color: 'var(--color-text-secondary)',
                marginTop: 6,
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
              }}
            >
              {rs.content.slice(0, 150)}
              {rs.content.length > 150 ? '...' : ''}
            </div>
          </div>
        ),
      )}

      {/* 新建表单 */}
      {isNew && (
        <RuleEditForm
          title={title}
          setTitle={setTitle}
          category={category}
          setCategory={setCategory}
          content={content}
          setContent={setContent}
          forbiddenRules={forbiddenRules}
          setForbiddenRules={setForbiddenRules}
          message={message}
          saving={saving}
          onSave={handleSave}
          onCancel={cancelEdit}
        />
      )}
    </div>
  );
}

function RuleEditForm({
  title,
  setTitle,
  category,
  setCategory,
  content,
  setContent,
  forbiddenRules,
  setForbiddenRules,
  message,
  saving,
  onSave,
  onCancel,
}: {
  title: string;
  setTitle: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  content: string;
  setContent: (v: string) => void;
  forbiddenRules: string;
  setForbiddenRules: (v: string) => void;
  message: string;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--color-primary)',
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
        background: 'var(--color-primary-light)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label className="panel-field-label">规则名称 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="form-input"
              placeholder="如：魔法体系规则"
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label className="panel-field-label">规则类别</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="panel-select"
            >
              {ruleCategoryOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="panel-field-label">规则内容</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="form-textarea"
            placeholder="详细描述规则体系..."
            style={{
              width: '100%',
              height: 160,
              resize: 'vertical',
              fontSize: 14,
              lineHeight: 1.8,
            }}
          />
        </div>
        <div>
          <label className="panel-field-label">禁止违背的内容</label>
          <textarea
            value={forbiddenRules}
            onChange={(e) => setForbiddenRules(e.target.value)}
            className="form-textarea"
            placeholder="列出 AI 绝对不能违反的规则..."
            style={{ width: '100%', height: 80, resize: 'vertical', fontSize: 14 }}
          />
        </div>
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
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>
            取消
          </button>
          <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>
            {saving ? '保存中...' : '💾 保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default RuleSystemCard;
