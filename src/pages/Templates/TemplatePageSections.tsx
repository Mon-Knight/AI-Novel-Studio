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
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: 16,
        background: 'var(--color-bg-card)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 8,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--color-text-primary)' }}>
            {template.name}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span
              style={{
                fontSize: 11,
                padding: '1px 8px',
                borderRadius: 10,
                background: 'var(--color-primary-light)',
                color: 'var(--color-primary)',
                fontWeight: 500,
              }}
            >
              {TemplateTypeLabels[template.type] ?? template.type}
            </span>
            <span
              style={{
                fontSize: 11,
                padding: '1px 8px',
                borderRadius: 10,
                background: 'var(--color-bg-hover)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {template.source === 'user_imported' ? '导入' : '自建'}
            </span>
          </div>
        </div>

        <div
          style={{
            fontSize: 13,
            color: 'var(--color-text-secondary)',
            marginTop: 8,
            lineHeight: 1.6,
          }}
        >
          {template.description || template.content.slice(0, 70)}
          {template.content.length > 70 && !template.description ? '...' : ''}
        </div>

        {template.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {template.tags.map((tag, index) => (
              <span
                key={`${tag}-${index}`}
                style={{
                  fontSize: 11,
                  padding: '1px 7px',
                  borderRadius: 6,
                  background: 'var(--color-bg-hover)',
                  color: 'var(--color-text-secondary)',
                }}
              >
                #{tag}
              </span>
            ))}
          </div>
        )}

        {expanded && (
          <div
            style={{
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              background: 'var(--color-bg-app, #f8fafc)',
              padding: 10,
              borderRadius: 6,
              marginTop: 10,
              maxHeight: 200,
              overflowY: 'auto',
              color: 'var(--color-text-secondary)',
              fontFamily: 'monospace',
              border: '1px solid var(--color-border)',
              lineHeight: 1.5,
            }}
          >
            {template.content}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 14,
          paddingTop: 10,
          borderTop: '1px solid var(--color-border-light, #f1f5f9)',
        }}
      >
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={{ flex: 1 }}
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
          className="btn btn-secondary btn-sm"
          style={{ color: 'var(--color-error)' }}
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
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: 16,
        background: 'var(--color-bg-card)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
      }}
    >
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 8,
          }}
        >
          <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--color-text-primary)' }}>
            {template.title}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <span
              style={{
                fontSize: 11,
                padding: '1px 8px',
                borderRadius: 10,
                background: 'var(--color-bg-hover)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {template.type}
            </span>
            <span
              style={{
                fontSize: 11,
                padding: '1px 8px',
                borderRadius: 10,
                background: 'var(--color-bg-hover)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {template.genre}
            </span>
          </div>
        </div>

        <div
          style={{
            fontSize: 13,
            color: 'var(--color-text-secondary)',
            marginTop: 8,
            lineHeight: 1.6,
          }}
        >
          {template.description}
        </div>

        {expanded && (
          <div
            style={{
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              background: 'var(--color-bg-app, #f8fafc)',
              padding: 10,
              borderRadius: 6,
              marginTop: 10,
              maxHeight: 200,
              overflowY: 'auto',
              color: 'var(--color-text-secondary)',
              fontFamily: 'monospace',
              border: '1px solid var(--color-border)',
              lineHeight: 1.5,
            }}
          >
            {template.content}
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginTop: 14,
          paddingTop: 10,
          borderTop: '1px solid var(--color-border-light, #f1f5f9)',
        }}
      >
        <button
          type="button"
          className="btn btn-primary btn-sm"
          style={{ flex: 1 }}
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
