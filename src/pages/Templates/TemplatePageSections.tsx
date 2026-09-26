import { ChevronDown, ChevronUp, Clipboard, PenLine, Trash2 } from 'lucide-react';
import { TemplateTypeLabels, type UserTemplate } from '../../services/templates/templateService';
import type { BuiltInTemplate } from './templateCatalog';
import { TemplateEditorForm } from './TemplateEditorForm';

export { TemplateEditorForm };

interface UserTemplateCardProps {
  template: UserTemplate;
  expanded: boolean;
  onToggle: (id: string) => void;
  onUse: (content: string, title: string) => void;
  onEdit: (template: UserTemplate) => void;
  onDelete: (template: UserTemplate) => void;
}

export function UserTemplateCard({
  template,
  expanded,
  onToggle,
  onUse,
  onEdit,
  onDelete,
}: UserTemplateCardProps) {
  return (
    <div className="resource-card resource-card--interactive">
      <div>
        <div className="resource-card-header">
          <span className="resource-card-title">{template.name}</span>
          <div className="resource-pill-row resource-shrink">
            <span className="resource-pill resource-pill--primary">
              {TemplateTypeLabels[template.type] ?? template.type}
            </span>
            <span className="resource-pill">
              {template.source === 'user_imported' ? '导入' : '自建'}
            </span>
          </div>
        </div>

        <div className="resource-card-description">
          {template.description || template.content.slice(0, 70)}
          {template.content.length > 70 && !template.description ? '...' : ''}
        </div>

        {template.tags.length > 0 && (
          <div className="resource-pill-row resource-gap-top">
            {template.tags.map((tag, index) => (
              <span key={`${tag}-${index}`} className="resource-pill">
                #{tag}
              </span>
            ))}
          </div>
        )}

        {expanded && <div className="resource-pre">{template.content}</div>}
      </div>

      <div className="resource-footer">
        <button
          type="button"
          className="btn btn-primary btn-sm resource-grow"
          onClick={() => onUse(template.content, template.name)}
        >
          <Clipboard aria-hidden="true" size={14} strokeWidth={1.8} />
          使用
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onToggle(template.id)}
          title={expanded ? '收起预览' : '展开预览'}
        >
          {expanded ? (
            <ChevronUp aria-hidden="true" size={14} strokeWidth={1.8} />
          ) : (
            <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
          )}
          {expanded ? '收起' : '预览'}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onEdit(template)}
          title="编辑模板"
        >
          <PenLine aria-hidden="true" size={14} strokeWidth={1.8} />
          编辑
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm resource-text-error"
          onClick={() => onDelete(template)}
          title="删除模板"
          aria-label={`删除模板 ${template.name}`}
        >
          <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}

interface BuiltInTemplateCardProps {
  template: BuiltInTemplate;
  expanded: boolean;
  onToggle: (id: string) => void;
  onUse: (content: string, title: string) => void;
}

export function BuiltInTemplateCard({
  template,
  expanded,
  onToggle,
  onUse,
}: BuiltInTemplateCardProps) {
  return (
    <div className="resource-card resource-card--interactive">
      <div>
        <div className="resource-card-header">
          <span className="resource-card-title">{template.title}</span>
          <div className="resource-pill-row resource-shrink">
            <span className="resource-pill">{template.type}</span>
            <span className="resource-pill">{template.genre}</span>
          </div>
        </div>

        <div className="resource-card-description">{template.description}</div>

        {expanded && <div className="resource-pre">{template.content}</div>}
      </div>

      <div className="resource-footer">
        <button
          type="button"
          className="btn btn-primary btn-sm resource-grow"
          onClick={() => onUse(template.content, template.title)}
        >
          <Clipboard aria-hidden="true" size={14} strokeWidth={1.8} />
          使用此模板
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onToggle(template.id)}
          title={expanded ? '收起预览' : '展开预览'}
        >
          {expanded ? (
            <ChevronUp aria-hidden="true" size={14} strokeWidth={1.8} />
          ) : (
            <ChevronDown aria-hidden="true" size={14} strokeWidth={1.8} />
          )}
          {expanded ? '收起' : '预览'}
        </button>
      </div>
    </div>
  );
}
