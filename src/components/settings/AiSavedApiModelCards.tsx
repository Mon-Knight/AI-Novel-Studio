import type { ReactNode } from 'react';
import type { SavedApiModelProfile } from '../../types/ai';
import {
  groupSavedApiModelsBySource,
  primaryProfileInSource,
  type SavedApiSourceGroup,
} from '../../services/ai/savedApiSources';

interface AiSavedApiModelCardsProps {
  profiles: SavedApiModelProfile[];
  activeId?: string;
  expandedKey?: string | 'new' | null;
  editor?: ReactNode;
  keyBound: (profile: SavedApiModelProfile) => boolean;
  onSelect: (group: SavedApiSourceGroup) => void;
  onEdit: (group: SavedApiSourceGroup) => void;
  onDelete: (group: SavedApiSourceGroup) => void;
  onAdd: () => void;
}

export function AiSavedApiModelCards({
  profiles,
  activeId,
  expandedKey,
  editor,
  keyBound,
  onSelect,
  onEdit,
  onDelete,
  onAdd,
}: AiSavedApiModelCardsProps) {
  const groups = groupSavedApiModelsBySource(profiles);

  return (
    <div data-testid="ai-saved-model-list">
      <div className="saved-api-model-toolbar">
        <p>
          已保存的 API 模型按来源（Base URL +
          密钥身份）分组。一张来源卡片可管理该上游的模型目录，不展示密钥。
        </p>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          data-testid="ai-saved-model-add"
          onClick={onAdd}
        >
          添加来源
        </button>
      </div>
      {groups.length === 0 ? (
        <p className="saved-api-model-empty">
          还没有保存的 API 模型。添加后会显示为卡片，当前使用的模型会高亮。
        </p>
      ) : null}
      {expandedKey === 'new' ? editor : null}
      <div className="api-source-card-stack">
        {groups.map((group) => {
          const primary = primaryProfileInSource(group, activeId);
          const active = group.models.some((model) => model.id === activeId);
          const ready = group.models.some((model) => keyBound(model));
          const expanded = expandedKey === group.key;
          return (
            <article
              key={group.key}
              className={
                'api-source-card' + (active ? ' is-active' : '') + (expanded ? ' is-expanded' : '')
              }
              data-testid="ai-saved-model-card"
              data-model-id={primary.id}
              data-active={active ? 'true' : 'false'}
              onClick={() => onSelect(group)}
            >
              <div className="api-source-card-header">
                <button
                  type="button"
                  className="api-source-card-main"
                  aria-pressed={active}
                  aria-label={`选中 ${group.label}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(group);
                  }}
                >
                  <strong>{group.label}</strong>
                  <span className="saved-api-model-badge">自定义</span>
                  <span
                    className={'api-source-status-dot' + (ready ? ' is-live' : '')}
                    aria-label={ready ? '本次会话已绑定' : '待填写密钥'}
                  />
                </button>
                <div className="api-source-card-actions">
                  <button
                    type="button"
                    className="api-source-text-btn"
                    aria-expanded={expanded}
                    onClick={(event) => {
                      event.stopPropagation();
                      onEdit(group);
                    }}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    className="api-source-text-btn is-danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(group);
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
              {expanded ? <div onClick={(event) => event.stopPropagation()}>{editor}</div> : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
