import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { formatTokenBudget, parseTokenBudget } from '../../services/ai/cloudModelCatalog';
import type { ApiModelEditorDraft, ApiSourceModelDraft } from './apiModelEditorDraft';
import { emptySourceModelDraft, syncPrimaryModelFields } from './apiModelEditorDraft';

interface AiApiSourceModelCatalogProps {
  draft: ApiModelEditorDraft;
  onChange: (patch: Partial<ApiModelEditorDraft>) => void;
  onFetchModels?: () => void;
  onRestoreDefaults?: () => void;
  fetchingModels?: boolean;
  fetchMessage?: string;
}

function updateModels(
  draft: ApiModelEditorDraft,
  models: ApiSourceModelDraft[],
  selectedModelIndex = draft.selectedModelIndex,
): Partial<ApiModelEditorDraft> {
  const nextIndex = Math.min(Math.max(selectedModelIndex, 0), Math.max(models.length - 1, 0));
  const synced = syncPrimaryModelFields({ ...draft, models, selectedModelIndex: nextIndex });
  return {
    models: synced.models,
    selectedModelIndex: synced.selectedModelIndex,
    id: synced.id,
    modelName: synced.modelName,
    maxTokens: synced.maxTokens,
    contextTokens: synced.contextTokens,
  };
}

export function AiApiSourceModelCatalog({
  draft,
  onChange,
  onFetchModels,
  onRestoreDefaults,
  fetchingModels,
  fetchMessage,
}: AiApiSourceModelCatalogProps) {
  const setModel = (index: number, patch: Partial<ApiSourceModelDraft>) => {
    onChange(
      updateModels(
        draft,
        draft.models.map((model, modelIndex) =>
          modelIndex === index ? { ...model, ...patch } : model,
        ),
        index,
      ),
    );
  };

  return (
    <section className="api-source-catalog">
      <div className="api-source-catalog-head">
        <div>
          <strong>模型目录</strong>
          <span className="settings-help-text">已自定义模型目录</span>
        </div>
        <div className="api-source-catalog-links">
          <button type="button" className="api-source-text-link" onClick={onRestoreDefaults}>
            恢复默认模型
          </button>
          <button
            type="button"
            className="api-source-text-link"
            onClick={onFetchModels}
            disabled={fetchingModels}
          >
            {fetchingModels ? '正在获取…' : '获取可用模型'}
          </button>
        </div>
      </div>
      {fetchMessage ? (
        <p className="settings-help-text" role="status">
          {fetchMessage}
        </p>
      ) : null}
      <div className="api-source-model-list">
        {draft.models.map((model, index) => {
          const expanded = Boolean(model.expanded);
          const isPrimary = index === 0;
          return (
            <article key={model.id ?? `draft-model-${index}`} className="api-source-model-row">
              <div className="api-source-model-row-main">
                <input
                  id={isPrimary ? 'saved-api-model-name' : undefined}
                  type="text"
                  className="form-input"
                  value={model.modelName}
                  placeholder={isPrimary ? '例如：deepseek-chat / deepseek-reasoner' : '模型 ID'}
                  onChange={(event) => setModel(index, { modelName: event.target.value })}
                />
                <input
                  type="text"
                  className="form-input"
                  value={model.label}
                  placeholder="显示名称"
                  onChange={(event) => setModel(index, { label: event.target.value })}
                />
                <button
                  type="button"
                  className="api-source-icon-btn"
                  aria-expanded={expanded}
                  aria-label={expanded ? '收起模型参数' : '展开模型参数'}
                  onClick={() => setModel(index, { expanded: !expanded })}
                >
                  {expanded ? (
                    <ChevronDown aria-hidden="true" size={16} strokeWidth={1.8} />
                  ) : (
                    <ChevronRight aria-hidden="true" size={16} strokeWidth={1.8} />
                  )}
                </button>
                <button
                  type="button"
                  className="api-source-icon-btn"
                  aria-label="删除模型"
                  onClick={() => {
                    const next = draft.models.filter((_, modelIndex) => modelIndex !== index);
                    onChange(
                      updateModels(draft, next.length > 0 ? next : [emptySourceModelDraft()]),
                    );
                  }}
                >
                  <Trash2 aria-hidden="true" size={16} strokeWidth={1.8} />
                </button>
              </div>
              {expanded ? (
                <div className="api-source-model-row-extra">
                  <label className="settings-field">
                    <span className="panel-field-label">上下文窗口</span>
                    <input
                      type="text"
                      className="form-input"
                      value={formatTokenBudget(model.contextTokens)}
                      placeholder="256K"
                      onChange={(event) =>
                        setModel(index, {
                          contextTokens: parseTokenBudget(event.target.value, 0),
                        })
                      }
                    />
                  </label>
                  <label className="settings-field">
                    <span className="panel-field-label">最大输出 Token</span>
                    {isPrimary ? (
                      <input
                        id="saved-api-model-max-tokens"
                        type="number"
                        className="form-input"
                        value={model.maxTokens}
                        min={100}
                        max={200000}
                        step={100}
                        onChange={(event) =>
                          setModel(index, { maxTokens: Number(event.target.value) })
                        }
                      />
                    ) : (
                      <input
                        type="text"
                        className="form-input"
                        value={formatTokenBudget(model.maxTokens)}
                        placeholder="32K"
                        onChange={(event) =>
                          setModel(index, {
                            maxTokens: parseTokenBudget(event.target.value, 8000),
                          })
                        }
                      />
                    )}
                  </label>
                </div>
              ) : isPrimary ? (
                <input
                  id="saved-api-model-max-tokens"
                  type="number"
                  className="form-input api-source-sr-only"
                  value={model.maxTokens}
                  min={100}
                  max={200000}
                  aria-label="最大输出 Token"
                  onChange={(event) => setModel(index, { maxTokens: Number(event.target.value) })}
                />
              ) : null}
            </article>
          );
        })}
      </div>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={() =>
          onChange(
            updateModels(draft, [...draft.models, { ...emptySourceModelDraft(), expanded: false }]),
          )
        }
      >
        添加模型
      </button>
    </section>
  );
}
