import type { OutlineGenerationContext } from '../../types/outline';
import {
  Bot,
  CheckCircle2,
  Circle,
  ClipboardList,
  FilePlus2,
  Globe2,
  LoaderCircle,
  Save,
  TriangleAlert,
  UserRound,
  Zap,
} from 'lucide-react';

interface OutlineVersionSummary {
  id: string;
  version: number;
  isActive: boolean;
}

interface OutlineEditorViewProps {
  loading: boolean;
  typeLabel: string;
  title: string;
  content: string;
  isDirty: boolean;
  currentId: string | null;
  currentVersion: number;
  versions: OutlineVersionSummary[];
  context: OutlineGenerationContext | null;
  showContext: boolean;
  onAiGenerate: () => Promise<void>;
  onSave: (saveAsNew: boolean) => Promise<void>;
  onSetActive: () => Promise<void>;
  onToggleContext: () => void;
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
}

export function OutlineEditorView({
  loading,
  typeLabel,
  title,
  content,
  isDirty,
  currentId,
  currentVersion,
  versions,
  context,
  showContext,
  onAiGenerate,
  onSave,
  onSetActive,
  onToggleContext,
  onTitleChange,
  onContentChange,
}: OutlineEditorViewProps) {
  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
        <LoaderCircle className="is-spinning" aria-hidden="true" size={16} strokeWidth={1.8} />{' '}
        加载中……
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          padding: '0 4px',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            fontWeight: 600,
            fontSize: 15,
            marginRight: 8,
          }}
        >
          <ClipboardList aria-hidden="true" size={16} strokeWidth={1.8} />
          {typeLabel}
        </span>

        <button className="btn btn-primary btn-sm" onClick={onAiGenerate}>
          <Bot aria-hidden="true" size={14} strokeWidth={1.8} />
          AI 生成
        </button>
        <button
          className="btn btn-sm"
          style={{
            background: isDirty ? 'var(--color-warning)' : undefined,
            color: isDirty ? 'var(--color-on-primary)' : undefined,
          }}
          onClick={() => onSave(false)}
        >
          <Save aria-hidden="true" size={14} strokeWidth={1.8} />
          保存{isDirty ? ' *' : ''}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => onSave(true)}>
          <FilePlus2 aria-hidden="true" size={14} strokeWidth={1.8} />
          保存为新版本
        </button>
        {currentId && (
          <button className="btn btn-secondary btn-sm" onClick={onSetActive}>
            <CheckCircle2 aria-hidden="true" size={14} strokeWidth={1.8} />
            设为采用版本
          </button>
        )}
        {context && (
          <button className="btn btn-secondary btn-sm" onClick={onToggleContext}>
            <ClipboardList aria-hidden="true" size={14} strokeWidth={1.8} />
            上下文
          </button>
        )}

        {versions.length > 0 && (
          <span style={{ fontSize: 11, color: 'var(--color-text-muted)', marginLeft: 'auto' }}>
            v{currentVersion} · {versions.length} 个版本
          </span>
        )}
      </div>

      {showContext && context && (
        <div
          style={{
            padding: 12,
            fontSize: 11,
            background: 'var(--color-bg-hover)',
            borderRadius: 8,
            border: '1px solid var(--color-border-light)',
            maxHeight: 180,
            overflowY: 'auto',
            lineHeight: 1.6,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            <ClipboardList aria-hidden="true" size={13} strokeWidth={1.8} />
            生成上下文摘要
          </div>
          {context.protagonistName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <UserRound aria-hidden="true" size={12} strokeWidth={1.8} />
              主角：{context.protagonistName} · {context.protagonistIdentity}
            </div>
          )}
          {context.protagonistAbility && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Zap aria-hidden="true" size={12} strokeWidth={1.8} />
              能力：{context.protagonistAbility}
            </div>
          )}
          {context.worldBackground && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Globe2 aria-hidden="true" size={12} strokeWidth={1.8} />
              世界：{context.worldBackground.slice(0, 150)}……
            </div>
          )}
          {context.activeMasterOutline && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <ClipboardList aria-hidden="true" size={12} strokeWidth={1.8} />
              总纲：{context.activeMasterOutline.slice(0, 150)}……
            </div>
          )}
          <div style={{ marginTop: 4, color: 'var(--color-text-muted)' }}>
            {(!context.protagonistName || !context.worldBackground) && (
              <TriangleAlert aria-hidden="true" size={12} strokeWidth={1.8} />
            )}
            {!context.protagonistName && '缺少主角设定 '}
            {!context.worldBackground && '缺少世界背景 '}
          </div>
        </div>
      )}

      <div>
        <input
          className="input"
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder={`${typeLabel}标题`}
          style={{ width: '100%', fontSize: 14, fontWeight: 600 }}
        />
      </div>

      <textarea
        className="input"
        value={content}
        onChange={(event) => onContentChange(event.target.value)}
        placeholder={`在此编辑${typeLabel}内容，或点击「AI 生成」……`}
        style={{
          flex: 1,
          width: '100%',
          resize: 'vertical',
          minHeight: 300,
          fontFamily: 'var(--font-family-editor)',
          fontSize: 14,
          lineHeight: 1.8,
          padding: 16,
          borderRadius: 8,
          border: '1px solid var(--color-border)',
        }}
      />

      {versions.length > 1 && (
        <div style={{ padding: '8px 0', borderTop: '1px solid var(--color-border-light)' }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 4 }}>
            历史版本：
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {versions.map((version) => (
              <span
                key={version.id}
                style={{
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: 11,
                  background: version.isActive
                    ? 'var(--color-primary-light)'
                    : 'var(--color-bg-hover)',
                  color:
                    version.id === currentId ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  cursor: 'pointer',
                  fontWeight: version.isActive ? 600 : 400,
                }}
                title={version.isActive ? '当前采用版本' : `版本 ${version.version}`}
              >
                v{version.version}
                {version.isActive && (
                  <CheckCircle2 aria-label="当前采用版本" size={11} strokeWidth={1.8} />
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--color-text-muted)', display: 'flex', gap: 16 }}>
        <span>字数：{content.length}</span>
        <span>版本：v{currentVersion}</span>
        {isDirty && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--color-warning)',
            }}
          >
            <Circle aria-hidden="true" size={7} strokeWidth={1.8} />
            未保存
          </span>
        )}
      </div>
    </div>
  );
}
