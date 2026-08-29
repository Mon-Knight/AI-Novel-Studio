import {
  TemplateTypeLabels,
  type TemplateType,
  type UserTemplate,
} from '../../services/templates/templateService';
import { BUILTIN_TEMPLATES, TEMPLATE_TYPES } from './templateCatalog';

interface TemplateEditorFormProps {
  editing: boolean;
  name: string;
  type: TemplateType;
  description: string;
  tags: string;
  content: string;
  saving: boolean;
  onNameChange: (value: string) => void;
  onTypeChange: (value: TemplateType) => void;
  onDescriptionChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function TemplateEditorForm(props: TemplateEditorFormProps) {
  return (
    <div className="detail-card" style={{ marginBottom: 16, borderColor: 'var(--color-primary)' }}>
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>
        {props.editing ? '✏️ 编辑模板' : '➕ 新建模板'}
      </div>
      <div className="panel-field" style={{ marginBottom: 8 }}>
        <div className="panel-field-label">模板名称</div>
        <input
          className="form-input"
          value={props.name}
          onChange={(event) => props.onNameChange(event.target.value)}
          placeholder="输入模板名称"
          style={{ width: '100%', fontSize: 13 }}
        />
      </div>
      <div className="panel-field" style={{ marginBottom: 8 }}>
        <div className="panel-field-label">模板类型</div>
        <select
          className="panel-select"
          value={props.type}
          onChange={(event) => props.onTypeChange(event.target.value as TemplateType)}
          style={{ fontSize: 13, width: '100%' }}
        >
          {TEMPLATE_TYPES.map((type) => (
            <option key={type.value} value={type.value}>
              {type.label}
            </option>
          ))}
        </select>
      </div>
      <div className="panel-field" style={{ marginBottom: 8 }}>
        <div className="panel-field-label">说明</div>
        <input
          className="form-input"
          value={props.description}
          onChange={(event) => props.onDescriptionChange(event.target.value)}
          placeholder="简要说明（可选）"
          style={{ width: '100%', fontSize: 13 }}
        />
      </div>
      <div className="panel-field" style={{ marginBottom: 8 }}>
        <div className="panel-field-label">标签（逗号分隔）</div>
        <input
          className="form-input"
          value={props.tags}
          onChange={(event) => props.onTagsChange(event.target.value)}
          placeholder="例如：修仙, 大纲, 快节奏"
          style={{ width: '100%', fontSize: 13 }}
        />
      </div>
      <div className="panel-field" style={{ marginBottom: 12 }}>
        <div className="panel-field-label">模板正文</div>
        <textarea
          className="form-textarea"
          value={props.content}
          onChange={(event) => props.onContentChange(event.target.value)}
          placeholder="在此输入模板内容..."
          rows={8}
          style={{ width: '100%', resize: 'vertical', fontSize: 13, fontFamily: 'monospace' }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={props.onSave} disabled={props.saving}>
          {props.saving ? '保存中...' : '💾 保存模板'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={props.onCancel}>
          取消
        </button>
      </div>
    </div>
  );
}

interface UserTemplateListProps {
  templates: UserTemplate[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  onUse: (content: string, title: string) => void;
  onEdit: (template: UserTemplate) => void;
  onDelete: (template: UserTemplate) => void;
}

export function UserTemplateList(props: UserTemplateListProps) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>
        📁 我的模板（{props.templates.length}）
      </div>
      {props.templates.length === 0 ? (
        <div
          style={{
            fontSize: 13,
            color: 'var(--color-text-muted)',
            padding: 16,
            textAlign: 'center',
          }}
        >
          还没有自定义模板，点击「新建模板」或「上传模板」开始
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {props.templates.map((template) => (
            <div
              key={template.id}
              className="detail-card"
              style={{ cursor: 'pointer', borderColor: 'var(--color-primary-light)' }}
              onClick={() => props.onToggle(template.id)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span
                  style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 3,
                    background: 'var(--color-primary-light)',
                    color: 'var(--color-primary)',
                  }}
                >
                  {TemplateTypeLabels[template.type]}
                </span>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                  {template.source === 'user_imported' ? '📤 导入' : '✏️ 自建'}
                </span>
              </div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 3 }}>{template.name}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                {template.description || template.content.slice(0, 60)}
                {template.content.length > 60 && !template.description && '...'}
              </div>
              {template.tags.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
                  {template.tags.map((tag, index) => (
                    <span
                      key={`${tag}-${index}`}
                      style={{
                        fontSize: 9,
                        padding: '1px 5px',
                        borderRadius: 2,
                        background: 'var(--color-bg-primary)',
                        color: 'var(--color-text-muted)',
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {props.expandedId === template.id && (
                <div
                  style={{
                    fontSize: 11,
                    whiteSpace: 'pre-wrap',
                    background: 'var(--color-bg-primary)',
                    padding: 8,
                    borderRadius: 4,
                    marginBottom: 8,
                    maxHeight: 200,
                    overflowY: 'auto',
                    color: 'var(--color-text-secondary)',
                    fontFamily: 'monospace',
                  }}
                >
                  {template.content}
                </div>
              )}
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  className="btn btn-primary btn-sm"
                  style={{ flex: 1 }}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onUse(template.content, template.name);
                  }}
                >
                  📋 使用
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ flex: 1 }}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onEdit(template);
                  }}
                >
                  ✏️ 编辑
                </button>
                <button
                  className="btn btn-text btn-sm"
                  style={{ color: 'var(--color-error)' }}
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onDelete(template);
                  }}
                  aria-label={`删除模板 ${template.name}`}
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface BuiltInTemplateListProps {
  filter: string;
  expandedId: string | null;
  onToggle: (id: string) => void;
  onUse: (content: string, title: string) => void;
}

export function BuiltInTemplateList(props: BuiltInTemplateListProps) {
  const templates = BUILTIN_TEMPLATES.filter(
    (template) =>
      props.filter === '全部' || props.filter === '系统内置' || template.type === props.filter,
  );
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>🏷️ 系统内置模板</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {templates.map((template) => (
          <div
            key={template.id}
            className="detail-card"
            style={{ cursor: 'pointer' }}
            onClick={() => props.onToggle(template.id)}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: 6,
              }}
            >
              <div>
                <span
                  style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    borderRadius: 3,
                    background: 'var(--color-bg-primary)',
                    color: 'var(--color-text-muted)',
                    marginRight: 6,
                  }}
                >
                  {template.type}
                </span>
                <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>
                  {template.genre}
                </span>
              </div>
            </div>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{template.title}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
              {template.description}
            </div>
            {props.expandedId === template.id && (
              <div
                style={{
                  fontSize: 11,
                  whiteSpace: 'pre-wrap',
                  background: 'var(--color-bg-primary)',
                  padding: 8,
                  borderRadius: 4,
                  marginBottom: 8,
                  maxHeight: 200,
                  overflowY: 'auto',
                  color: 'var(--color-text-secondary)',
                  fontFamily: 'monospace',
                }}
              >
                {template.content}
              </div>
            )}
            <button
              className="btn btn-primary btn-sm"
              onClick={(event) => {
                event.stopPropagation();
                props.onUse(template.content, template.title);
              }}
              style={{ width: '100%' }}
            >
              📋 使用模板
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
