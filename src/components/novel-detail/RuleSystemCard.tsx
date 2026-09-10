import { useState } from 'react';
import { Pencil, Plus, Save, Scale, Trash2 } from 'lucide-react';
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
      <div className="detail-card-header">
        <div className="detail-card-title">
          <Scale aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>规则体系</span>
        </div>
        {!editingId && !isNew && (
          <button className="btn btn-secondary btn-sm" onClick={startNew}>
            <Plus aria-hidden="true" size={14} strokeWidth={1.8} />
            新增规则
          </button>
        )}
      </div>

      <div className="text-sm text-muted detail-card-intro">
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
          <div key={rs.id} className="detail-list-item">
            <div className="detail-list-item-header">
              <div>
                <span className="detail-list-item-title">{rs.title}</span>
                {rs.category && (
                  <span className="detail-tag">
                    {ruleCategoryOptions.find((o) => o.value === rs.category)?.label || rs.category}
                  </span>
                )}
              </div>
              <div className="detail-inline-actions">
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => startEdit(rs)}
                  aria-label={`编辑规则 ${rs.title}`}
                >
                  <Pencil aria-hidden="true" size={14} strokeWidth={1.8} />
                </button>
                <button
                  className="btn btn-secondary btn-sm detail-text-error"
                  onClick={() => handleDelete(rs.id)}
                  aria-label={`删除规则 ${rs.title}`}
                >
                  <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
                </button>
              </div>
            </div>
            <div className="detail-fact-text detail-fact-text--sm">
              {rs.content.slice(0, 150)}
              {rs.content.length > 150 ? '...' : ''}
            </div>
          </div>
        ),
      )}

      {ruleSystems.length === 0 && !isNew && (
        <div className="detail-empty-hint">尚未添加规则体系，点击上方“新增规则”开始创建</div>
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
    <div className="detail-list-item is-editing">
      <div className="detail-form detail-form--tight">
        <div className="detail-form-grid detail-form-grid--tight">
          <div>
            <label className="panel-field-label">规则名称 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="form-input detail-fill"
              placeholder="如：魔法体系规则"
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
            className="form-textarea detail-textarea detail-textarea--lg"
            placeholder="详细描述规则体系..."
          />
        </div>
        <div>
          <label className="panel-field-label">禁止违背的内容</label>
          <textarea
            value={forbiddenRules}
            onChange={(e) => setForbiddenRules(e.target.value)}
            className="form-textarea detail-textarea detail-textarea--sm"
            placeholder="列出 AI 绝对不能违反的规则..."
          />
        </div>
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
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>
            取消
          </button>
          <button className="btn btn-primary btn-sm" onClick={onSave} disabled={saving}>
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
    </div>
  );
}

export default RuleSystemCard;
