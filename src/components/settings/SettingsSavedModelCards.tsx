export interface SettingsSavedModelCardItem {
  id: string;
  label: string;
  badge: string;
  active: boolean;
  keyBound: boolean;
  lastTestOk?: boolean;
}

interface SettingsSavedModelCardsProps {
  listTestId: string;
  addTestId: string;
  cardTestId: string;
  help: string;
  empty: string;
  addLabel: string;
  items: SettingsSavedModelCardItem[];
  keyBoundLabel?: string;
  keyMissingLabel?: string;
  onAdd: () => void;
  onUse: (id: string) => void;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
}

export function SettingsSavedModelCards({
  listTestId,
  addTestId,
  cardTestId,
  help,
  empty,
  addLabel,
  items,
  keyBoundLabel = '本次会话已绑定',
  keyMissingLabel = '待填写密钥',
  onAdd,
  onUse,
  onEdit,
  onDelete,
}: SettingsSavedModelCardsProps) {
  return (
    <div data-testid={listTestId}>
      <div className="saved-api-model-toolbar">
        <p>{help}</p>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          data-testid={addTestId}
          onClick={onAdd}
        >
          {addLabel}
        </button>
      </div>
      {items.length === 0 ? (
        <p className="saved-api-model-empty">{empty}</p>
      ) : (
        <div className="saved-api-model-grid">
          {items.map((item) => (
            <article
              key={item.id}
              className={'saved-api-model-card' + (item.active ? ' is-active' : '')}
              data-testid={cardTestId}
              data-model-id={item.id}
              data-active={item.active ? 'true' : 'false'}
            >
              <div className="saved-api-model-card-title">
                <strong>{item.label}</strong>
                {item.active ? <span className="saved-api-model-badge">当前使用</span> : null}
              </div>
              <div className="saved-api-model-meta">
                <span className="saved-api-model-status">{item.badge}</span>
                <span className="saved-api-model-status">
                  {item.keyBound ? keyBoundLabel : keyMissingLabel}
                </span>
                {item.lastTestOk === true ? (
                  <span className="saved-api-model-status">最近可用</span>
                ) : item.lastTestOk === false ? (
                  <span className="saved-api-model-status">最近失败</span>
                ) : null}
              </div>
              <div className="saved-api-model-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={item.active}
                  onClick={() => onUse(item.id)}
                >
                  {item.active ? '使用中' : '使用'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onEdit(item.id)}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onDelete(item.id)}
                >
                  删除
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
