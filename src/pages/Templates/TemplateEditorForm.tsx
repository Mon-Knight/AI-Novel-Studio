import { PenLine, Plus, Save, X } from 'lucide-react';
import { type TemplateType } from '../../services/templates/templateService';
import { TEMPLATE_TYPES } from './templateCatalog';

export interface TemplateEditorFormProps {
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
    <div
      style={{
        border: '1px solid var(--color-primary)',
        borderRadius: 10,
        padding: 20,
        marginBottom: 20,
        background: 'var(--color-bg-card)',
        boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0,0,0,0.05))',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontWeight: 600,
            fontSize: 15,
            color: 'var(--color-text-primary)',
          }}
        >
          {props.editing ? (
            <PenLine aria-hidden="true" size={16} strokeWidth={1.8} />
          ) : (
            <Plus aria-hidden="true" size={16} strokeWidth={1.8} />
          )}
          {props.editing ? '编辑自定义模板' : '新建自定义模板'}
        </span>
        <button
          type="button"
          onClick={props.onCancel}
          style={{
            background: 'none',
            border: 'none',
            minWidth: 28,
            minHeight: 28,
            cursor: 'pointer',
            color: 'var(--color-text-secondary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label="关闭表单"
        >
          <X aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <div
            className="panel-field-label"
            style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}
          >
            模板名称 *
          </div>
          <input
            className="form-input"
            value={props.name}
            onChange={(event) => props.onNameChange(event.target.value)}
            placeholder="例如：高潮对决大纲模板"
            style={{ width: '100%', fontSize: 13 }}
          />
        </div>
        <div>
          <div
            className="panel-field-label"
            style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}
          >
            模板分类
          </div>
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
      </div>

      <div style={{ marginBottom: 12 }}>
        <div
          className="panel-field-label"
          style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}
        >
          简要说明
        </div>
        <input
          className="form-input"
          value={props.description}
          onChange={(event) => props.onDescriptionChange(event.target.value)}
          placeholder="简要描述模板适用场景（可选）"
          style={{ width: '100%', fontSize: 13 }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <div
          className="panel-field-label"
          style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}
        >
          标签索引（逗号分隔）
        </div>
        <input
          className="form-input"
          value={props.tags}
          onChange={(event) => props.onTagsChange(event.target.value)}
          placeholder="例如：修仙, 战斗, 强节奏"
          style={{ width: '100%', fontSize: 13 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <div
          className="panel-field-label"
          style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}
        >
          模板内容 *
        </div>
        <textarea
          className="form-textarea"
          value={props.content}
          onChange={(event) => props.onContentChange(event.target.value)}
          placeholder="在此输入模板结构定义（支持 Markdown、JSON 或纯文本）..."
          rows={9}
          style={{
            width: '100%',
            resize: 'vertical',
            fontSize: 13,
            fontFamily: 'monospace',
            lineHeight: 1.6,
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={props.onCancel}>
          取消
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={props.onSave}
          disabled={props.saving}
        >
          {!props.saving && <Save aria-hidden="true" size={15} strokeWidth={1.8} />}
          {props.saving ? '保存中...' : '保存模板'}
        </button>
      </div>
    </div>
  );
}
