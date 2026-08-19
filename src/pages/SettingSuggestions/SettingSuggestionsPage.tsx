/**
 * AI Novel Studio - 设定库 AI 推演页面
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import BackButton from '../../components/common/BackButton';
import { novelRepository } from '../../services/database/novelRepository';
import { settingSuggestionService } from '../../services/settingSuggestions/settingSuggestionService';
import type { Novel } from '../../types/novel';
import type {
  GenerateSettingSuggestionsInput,
  SettingSuggestionPayload,
  SettingSuggestionRecord,
  SettingSuggestionStatus,
  SettingSuggestionType,
} from '../../types/settingSuggestion';
import '../../styles/setting-suggestions.css';
import { describeUnknownError } from '../../utils/errorMessage';
import { isAiRequestCancelled } from '../../services/ai/aiCancellation';
import {
  fieldLabels,
  formatTarget,
  referenceStyleOptions,
  statusClassNames,
  statusLabels,
  typeLabels,
  worldTypeOptions,
} from './settingSuggestionsPresentation';

function SettingSuggestionsPage() {
  const navigate = useNavigate();
  const { novelId, worldId } = useParams<{ novelId?: string; worldId?: string }>();
  const routeNovelId = novelId || worldId || '';

  const [novels, setNovels] = useState<Novel[]>([]);
  const [selectedNovelId, setSelectedNovelId] = useState(routeNovelId);
  const [suggestions, setSuggestions] = useState<SettingSuggestionRecord[]>([]);
  const [suggestionType, setSuggestionType] = useState<SettingSuggestionType>('character');
  const [worldType, setWorldType] = useState('西方奇幻');
  const [customWorldType, setCustomWorldType] = useState('');
  const [referenceStyle, setReferenceStyle] = useState('王国战争');
  const [customReferenceStyle, setCustomReferenceStyle] = useState('');
  const [count, setCount] = useState(3);
  const [userInstruction, setUserInstruction] = useState('');
  const [includeWorldSettings, setIncludeWorldSettings] = useState(true);
  const [includeExistingAssets, setIncludeExistingAssets] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | SettingSuggestionStatus>('all');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingRecord, setEditingRecord] = useState<SettingSuggestionRecord | null>(null);
  const [editingJson, setEditingJson] = useState('');
  const generateAbortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generateAbortRef.current?.abort();
      generateAbortRef.current = null;
    };
  }, []);

  useEffect(() => {
    novelRepository
      .getAll()
      .then((list) => {
        setNovels(list);
        if (!selectedNovelId && list[0]) setSelectedNovelId(list[0].id);
      })
      .catch(() => setNovels([]));
  }, [selectedNovelId]);

  const loadSuggestions = useCallback(async () => {
    if (!selectedNovelId) {
      setSuggestions([]);
      return;
    }
    const list = await settingSuggestionService.getByNovelId(selectedNovelId);
    setSuggestions(list);
  }, [selectedNovelId]);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  const selectedNovel = novels.find((item) => item.id === selectedNovelId);
  const resolvedWorldType =
    worldType === '自定义' ? customWorldType.trim() || '自定义世界类型' : worldType;
  const resolvedReferenceStyle =
    referenceStyle === '自定义' ? customReferenceStyle.trim() || '自定义参考方向' : referenceStyle;

  const filteredSuggestions = useMemo(() => {
    return suggestions.filter((item) => statusFilter === 'all' || item.status === statusFilter);
  }, [suggestions, statusFilter]);

  const refreshRecord = (record: SettingSuggestionRecord) => {
    setSuggestions((prev) => prev.map((item) => (item.id === record.id ? record : item)));
  };

  const stopGenerate = () => {
    const controller = generateAbortRef.current;
    if (!controller) return;
    generateAbortRef.current = null;
    controller.abort();
    setLoading(false);
    setError('');
    setMessage('生成已取消');
  };

  const handleGenerate = async () => {
    if (!selectedNovelId || loading) return;
    generateAbortRef.current?.abort();
    const controller = new AbortController();
    generateAbortRef.current = controller;
    const requestSuggestionType = suggestionType;
    setLoading(true);
    setError('');
    setMessage('正在生成候选...');
    try {
      const input: GenerateSettingSuggestionsInput = {
        novelId: selectedNovelId,
        suggestionType: requestSuggestionType,
        worldType: resolvedWorldType,
        referenceStyle: resolvedReferenceStyle,
        count,
        userInstruction,
        includeWorldSettings,
        includeExistingAssets,
      };
      const created = await settingSuggestionService.generate(input, {
        signal: controller.signal,
        cancel: () => controller.abort(),
      });
      if (
        controller.signal.aborted ||
        generateAbortRef.current !== controller ||
        !mountedRef.current
      )
        return;
      setSuggestions((prev) => [...created, ...prev]);
      setMessage(`已生成 ${created.length} 条${typeLabels[requestSuggestionType]}候选`);
    } catch (e: unknown) {
      if (generateAbortRef.current !== controller || !mountedRef.current) return;
      if (controller.signal.aborted || isAiRequestCancelled(e)) {
        setError('');
        setMessage('生成已取消');
      } else {
        setError(describeUnknownError(e, '生成失败'));
        setMessage('');
      }
    } finally {
      if (generateAbortRef.current === controller) {
        generateAbortRef.current = null;
        if (mountedRef.current) setLoading(false);
      }
    }
  };

  const handleAdopt = async (record: SettingSuggestionRecord) => {
    setError('');
    try {
      const result = await settingSuggestionService.adopt(record.id);
      refreshRecord(result.record);
      setMessage(`已采纳到正式模块，目标 ${result.targetId?.slice(0, 8) || ''}`);
    } catch (e: unknown) {
      setError(describeUnknownError(e, '采纳失败'));
    }
  };

  const handleDiscard = async (record: SettingSuggestionRecord) => {
    setError('');
    try {
      const updated = await settingSuggestionService.discard(record.id);
      refreshRecord(updated);
      setMessage('候选已废弃，原始记录仍保留');
    } catch (e: unknown) {
      setError(describeUnknownError(e, '废弃失败'));
    }
  };

  const openEditAdopt = (record: SettingSuggestionRecord) => {
    setEditingRecord(record);
    setEditingJson(JSON.stringify(record.item, null, 2));
    setError('');
  };

  const confirmEditAdopt = async () => {
    if (!editingRecord) return;
    setError('');
    try {
      const parsed = JSON.parse(editingJson) as SettingSuggestionPayload;
      const result = await settingSuggestionService.adopt(editingRecord.id, parsed);
      refreshRecord(result.record);
      setEditingRecord(null);
      setEditingJson('');
      setMessage(`已编辑后采纳，目标 ${result.targetId?.slice(0, 8) || ''}`);
    } catch (e: unknown) {
      setError(describeUnknownError(e, '编辑后采纳失败，请检查 JSON 格式'));
    }
  };

  return (
    <div className="setting-suggestions-page page-container">
      <div className="setting-suggestions-header">
        <BackButton label="返回资产中心" to="/assets" />
        <div>
          <div className="setting-suggestions-title">设定库 AI 推演</div>
          <div className="setting-suggestions-subtitle">
            只生成候选设定；采纳、编辑后采纳或废弃都由用户确认。
          </div>
        </div>
      </div>

      {message && <div className="setting-suggestions-message">{message}</div>}
      {error && <div className="setting-suggestions-error">{error}</div>}

      <div className="setting-suggestions-layout">
        <section className="setting-suggestions-panel">
          <div className="setting-suggestions-panel-title">生成设置</div>

          <label className="panel-field-label">作品</label>
          {novels.length === 0 ? (
            <div className="setting-suggestions-muted">暂无作品，请先创建作品。</div>
          ) : (
            <select
              className="input"
              value={selectedNovelId}
              onChange={(e) => setSelectedNovelId(e.target.value)}
            >
              {novels.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
          )}

          <label className="panel-field-label">生成类型</label>
          <select
            className="input"
            value={suggestionType}
            onChange={(e) => setSuggestionType(e.target.value as SettingSuggestionType)}
          >
            <option value="character">角色候选</option>
            <option value="faction">势力候选</option>
            <option value="location">地点候选</option>
            <option value="rule">规则候选</option>
          </select>

          <label className="panel-field-label">世界类型</label>
          <select
            className="input"
            value={worldType}
            onChange={(e) => setWorldType(e.target.value)}
          >
            {worldTypeOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          {worldType === '自定义' && (
            <input
              className="input"
              value={customWorldType}
              onChange={(e) => setCustomWorldType(e.target.value)}
              placeholder="输入自定义世界类型"
            />
          )}

          <label className="panel-field-label">参考方向</label>
          <select
            className="input"
            value={referenceStyle}
            onChange={(e) => setReferenceStyle(e.target.value)}
          >
            {referenceStyleOptions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          {referenceStyle === '自定义' && (
            <input
              className="input"
              value={customReferenceStyle}
              onChange={(e) => setCustomReferenceStyle(e.target.value)}
              placeholder="输入自定义参考方向"
            />
          )}

          <label className="panel-field-label">生成数量</label>
          <input
            className="input"
            type="number"
            min={1}
            max={8}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(8, Number(e.target.value) || 1)))}
          />

          <label className="setting-suggestions-check">
            <input
              type="checkbox"
              checked={includeWorldSettings}
              onChange={(e) => setIncludeWorldSettings(e.target.checked)}
            />
            加载已有世界设定与规则
          </label>
          <label className="setting-suggestions-check">
            <input
              type="checkbox"
              checked={includeExistingAssets}
              onChange={(e) => setIncludeExistingAssets(e.target.checked)}
            />
            加载已有角色/阵营线索
          </label>

          <label className="panel-field-label">补充要求</label>
          <textarea
            className="input setting-suggestions-textarea"
            value={userInstruction}
            onChange={(e) => setUserInstruction(e.target.value)}
            placeholder="例如：不要出现现代科技，势力之间要有宗教冲突"
          />

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              disabled={!selectedNovelId || loading}
              onClick={handleGenerate}
              style={{ flex: 1 }}
            >
              {loading ? '生成中...' : `生成${typeLabels[suggestionType]}候选`}
            </button>
            {loading && (
              <button className="btn btn-secondary" onClick={stopGenerate}>
                停止生成
              </button>
            )}
          </div>

          {selectedNovel && (
            <div className="setting-suggestions-context-note">
              当前作品：{selectedNovel.title}。候选不会自动写入正式设定库。
            </div>
          )}
        </section>

        <section className="setting-suggestions-results">
          <div className="setting-suggestions-results-head">
            <div>
              <div className="setting-suggestions-panel-title">候选记录</div>
              <div className="setting-suggestions-muted">共 {filteredSuggestions.length} 条</div>
            </div>
            <select
              className="input setting-suggestions-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | SettingSuggestionStatus)}
            >
              <option value="all">全部状态</option>
              <option value="pending">待确认</option>
              <option value="adopted">已采纳</option>
              <option value="edited_adopted">编辑后采纳</option>
              <option value="discarded">已废弃</option>
            </select>
          </div>

          {filteredSuggestions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">◇</div>
              <div className="empty-state-text">暂无候选记录</div>
            </div>
          ) : (
            <div className="setting-suggestions-list">
              {filteredSuggestions.map((record) => (
                <article key={record.id} className="setting-suggestion-card">
                  <div className="setting-suggestion-card-head">
                    <div>
                      <div className="setting-suggestion-name">
                        {record.item.name || '未命名候选'}
                      </div>
                      <div className="setting-suggestion-meta">
                        {typeLabels[record.suggestionType]} · {record.worldType} ·{' '}
                        {record.referenceStyle}
                      </div>
                    </div>
                    <span className={`tag ${statusClassNames[record.status]}`}>
                      {statusLabels[record.status]}
                    </span>
                  </div>

                  <div className="setting-suggestion-fields">
                    {Object.entries(record.item)
                      .slice(0, 6)
                      .map(([key, value]) => (
                        <div key={key} className="setting-suggestion-field">
                          <span>{fieldLabels[key] || key}</span>
                          <strong>{value}</strong>
                        </div>
                      ))}
                  </div>

                  {formatTarget(record) && (
                    <div className="setting-suggestion-target">{formatTarget(record)}</div>
                  )}

                  <div className="setting-suggestion-actions">
                    {record.status === 'pending' && (
                      <>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => handleAdopt(record)}
                        >
                          采纳
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => openEditAdopt(record)}
                        >
                          编辑后采纳
                        </button>
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => handleDiscard(record)}
                        >
                          废弃
                        </button>
                      </>
                    )}
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => setExpandedId(expandedId === record.id ? null : record.id)}
                    >
                      {expandedId === record.id ? '收起原始信息' : '查看原始信息'}
                    </button>
                    {(record.status === 'adopted' || record.status === 'edited_adopted') && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => navigate(`/novels/${record.novelId}`)}
                      >
                        打开正式设定
                      </button>
                    )}
                  </div>

                  {expandedId === record.id && (
                    <div className="setting-suggestion-raw">
                      <div className="setting-suggestion-raw-title">Prompt</div>
                      <pre>{record.prompt}</pre>
                      <div className="setting-suggestion-raw-title">原始输出</div>
                      <pre>{record.rawOutput || record.resultJson}</pre>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      {editingRecord && (
        <div className="modal-overlay" onClick={() => setEditingRecord(null)}>
          <div
            className="modal-dialog setting-suggestions-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-title">编辑后采纳</div>
            <div className="setting-suggestions-muted">
              修改 JSON 字段后保存，会写入正式模块并把候选标记为“编辑后采纳”。
            </div>
            <textarea
              className="input setting-suggestions-json-editor"
              value={editingJson}
              onChange={(e) => setEditingJson(e.target.value)}
            />
            <div className="setting-suggestions-modal-actions">
              <button className="btn btn-secondary" onClick={() => setEditingRecord(null)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={confirmEditAdopt}>
                确认采纳
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SettingSuggestionsPage;
