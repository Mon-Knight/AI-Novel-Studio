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
    <div className="resource-editor">
      <div className="resource-editor-header">
        <span className="resource-card-title">
          {props.editing ? (
            <PenLine aria-hidden="true" size={16} strokeWidth={1.8} />
          ) : (
            <Plus aria-hidden="true" size={16} strokeWidth={1.8} />
          )}
          {props.editing ? '编辑自定义模板' : '新建自定义模板'}
        </span>
        <button
          type="button"
          className="resource-icon-button"
          onClick={props.onCancel}
          aria-label="关闭表单"
        >
          <X aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
      </div>

      <div className="resource-form-grid resource-field">
        <div>
          <div className="panel-field-label resource-field-label">模板名称 *</div>
          <input
            className="form-input resource-fill"
            value={props.name}
            onChange={(event) => props.onNameChange(event.target.value)}
            placeholder="例如：高潮对决大纲模板"
          />
        </div>
        <div>
          <div className="panel-field-label resource-field-label">模板分类</div>
          <select
            className="panel-select resource-fill"
            value={props.type}
            onChange={(event) => props.onTypeChange(event.target.value as TemplateType)}
          >
            {TEMPLATE_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="resource-field">
        <div className="panel-field-label resource-field-label">简要说明</div>
        <input
          className="form-input resource-fill"
          value={props.description}
          onChange={(event) => props.onDescriptionChange(event.target.value)}
          placeholder="简要描述模板适用场景（可选）"
        />
      </div>

      <div className="resource-field">
        <div className="panel-field-label resource-field-label">标签索引（逗号分隔）</div>
        <input
          className="form-input resource-fill"
          value={props.tags}
          onChange={(event) => props.onTagsChange(event.target.value)}
          placeholder="例如：修仙, 战斗, 强节奏"
        />
      </div>

      <div className="resource-field resource-field--last">
        <div className="panel-field-label resource-field-label">模板内容 *</div>
        <textarea
          className="form-textarea resource-code-textarea"
          value={props.content}
          onChange={(event) => props.onContentChange(event.target.value)}
          placeholder="在此输入模板结构定义（支持 Markdown、JSON 或纯文本）..."
          rows={9}
        />
      </div>

      <div className="resource-editor-footer">
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
