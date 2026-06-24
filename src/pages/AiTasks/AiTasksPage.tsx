/**
 * AI Novel Studio - AI 任务记录页面 (v1.0.27 增强版)
 */
import { useState, useEffect, useCallback } from 'react';
import BackButton from '../../components/common/BackButton';
import { formatDateTime } from '../../utils/date';
import { formatTokenCount } from '../../utils/format';
import { aiTaskService } from '../../services/ai/aiTaskService';
import type { AiTaskRecord, AiTaskType, AiTaskStatus } from '../../types/ai';
import { AiTaskTypeLabels } from '../../types/ai';
import { confirmDanger } from '../../utils/nativeDialog';
import { describeUnknownError } from '../../utils/errorMessage';

const TYPE_FILTERS: (AiTaskType | 'all')[] = ['all', 'connection_test', 'chapter_generate', 'character_generate', 'event_suggest', 'setting_expand', 'outline_generate', 'volume_outline_generate', 'chapter_outline_generate', 'context_summarize', 'style_analyze', 'quality_check', 'chapter_polish'];
const STATUS_FILTERS: (AiTaskStatus | 'all')[] = ['all', 'succeeded', 'failed', 'pending', 'running'];

function AiTasksPage() {
  const [tasks, setTasks] = useState<AiTaskRecord[]>([]);
  const [typeFilter, setTypeFilter] = useState<AiTaskType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<AiTaskStatus | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  // v1.0.27 多选状态
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const showMessage = useCallback((text: string, durationMs = 3000) => {
    setMsg(text);
    setTimeout(() => setMsg(''), durationMs);
  }, []);

  const loadTasks = useCallback(async () => {
    console.log('[AI_TASK_DELETE_UI] reload tasks start');
    const result = await aiTaskService.getAll(1, 500);
    setTasks(result.items);
    console.log('[AI_TASK_DELETE_UI] reload tasks done', {
      itemCount: result.items.length,
      total: result.total,
    });
    return result.items;
  }, []);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  const filtered = tasks
    .filter((t) => typeFilter === 'all' || t.taskType === typeFilter)
    .filter((t) => statusFilter === 'all' || t.status === statusFilter)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // 切换选择
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((t) => t.id)));
    }
  };

  // 单条删除
  const handleDeleteOne = async (task: AiTaskRecord) => {
    if (!(await confirmDanger({ title: '删除任务记录', message: `确定删除这条「${AiTaskTypeLabels[task.taskType]}」记录吗？` }))) return;
    try {
      console.log('[AI_TASK_DELETE_UI] delete one clicked', { id: task.id });
      console.log('[AI_TASK_DELETE_UI] call deleteOne start', { id: task.id });
      const result = await aiTaskService.deleteOne(task.id);
      console.log('[AI_TASK_DELETE_UI] deleteOne result', result);
      if (result.deletedCount === 0) {
        showMessage('未删除任何记录，请检查记录ID或数据库连接');
        return;
      }
      const reloaded = await loadTasks();
      if (reloaded.some((item) => item.id === task.id)) {
        console.error('[AI_TASK_DELETE_VERIFY_FAILED] deleted ids still visible', [task.id]);
        showMessage('删除后仍检测到记录，请检查数据源');
        return;
      }
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(task.id); return next; });
      setExpandedId((prev) => prev === task.id ? null : prev);
      showMessage(`已删除 ${result.deletedCount} 条记录`, 2000);
    } catch (e: unknown) {
      const errorMessage = describeUnknownError(e);
      console.error('[AI_TASK_DELETE_UI] delete one failed full error', {
        errorMessage,
        error: e,
      });
      showMessage('删除失败：' + errorMessage, 8000);
    }
  };

  // 批量删除
  const handleDeleteSelected = async () => {
    const ids = [...selectedIds];
    console.log('[AI_TASK_DELETE_UI] delete selected clicked', {
      selectedIds: ids,
      selectedCount: ids.length,
    });
    if (ids.length === 0) {
      showMessage('请先选择要删除的记录', 2000);
      return;
    }
    if (!(await confirmDanger({ title: '批量删除', message: `确定删除选中的 ${ids.length} 条 AI 任务记录吗？` }))) return;
    setDeleting(true);
    try {
      console.log('[AI_TASK_DELETE_UI] call deleteMany start', { ids, selectedCount: ids.length });
      const result = await aiTaskService.deleteMany(ids);
      console.log('[AI_TASK_DELETE_UI] deleteMany result', result);
      if (result.deletedCount === 0) {
        showMessage('未删除任何记录，请检查记录ID或数据库连接');
        return;
      }
      const reloaded = await loadTasks();
      const stillVisibleIds = reloaded.filter((item) => ids.includes(item.id)).map((item) => item.id);
      if (stillVisibleIds.length > 0) {
        console.error('[AI_TASK_DELETE_VERIFY_FAILED] deleted ids still visible', stillVisibleIds);
        showMessage('删除后仍检测到记录，请检查数据源');
        return;
      }
      setSelectedIds(new Set());
      setSelectMode(false);
      showMessage(`已删除 ${result.deletedCount} 条记录`);
    } catch (e: unknown) {
      const errorMessage = describeUnknownError(e);
      console.error('[AI_TASK_DELETE_UI] delete selected failed full error', {
        errorMessage,
        error: e,
      });
      showMessage('删除失败：' + errorMessage, 8000);
    } finally {
      setDeleting(false);
    }
  };

  // 清空全部
  const handleClearAll = async () => {
    if (!(await confirmDanger({
      title: '清空全部记录',
      message: '确定清空所有 AI 任务记录吗？\n\n这只会删除 AI 调用历史，不会删除作品、章节、草稿、大纲、角色或设定。\n\n此操作无法恢复。',
    }))) return;
    const beforeCount = tasks.length;
    console.log('[AI_TASK_DELETE_UI] clear all clicked', { beforeCount });
    setDeleting(true);
    try {
      console.log('[AI_TASK_DELETE_UI] call clearAll start', { beforeCount });
      const result = await aiTaskService.clearAll();
      console.log('[AI_TASK_DELETE_UI] clearAll result', result);
      if (beforeCount > 0 && result.deletedCount === 0) {
        showMessage('清空失败：数据库未删除任何记录');
        return;
      }
      const reloaded = await loadTasks();
      if (reloaded.length > 0) {
        console.error('[AI_TASK_DELETE_VERIFY_FAILED] clear all still visible', {
          itemCount: reloaded.length,
          ids: reloaded.map((item) => item.id).slice(0, 20),
        });
        showMessage('清空后仍检测到记录，请检查数据源');
        return;
      }
      setSelectedIds(new Set());
      setSelectMode(false);
      showMessage(`清理完成，已删除 ${result.deletedCount} 条记录`);
    } catch (e: unknown) {
      const errorMessage = describeUnknownError(e);
      console.error('[AI_TASK_DELETE_UI] clear all failed full error', {
        errorMessage,
        error: e,
      });
      showMessage('清空失败：' + errorMessage, 8000);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: '0 auto', height: '100%', overflowY: 'auto' }}>
      <BackButton label="返回首页" to="/" />
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>🤖 AI 任务记录</div>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>查看所有 AI 生成、分析、检查和润色任务的执行记录</div>

      {msg && <div style={{ padding: '8px 16px', marginBottom: 16, background: (msg.includes('失败') || msg.includes('未删除') || msg.includes('仍检测')) ? '#ffebee' : 'var(--color-primary-light)', borderRadius: 6, fontSize: 13, color: (msg.includes('失败') || msg.includes('未删除') || msg.includes('仍检测')) ? '#c62828' : 'var(--color-primary)' }}>{msg}</div>}

      {/* 操作按钮区 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className={`btn btn-sm ${selectMode ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setSelectMode(!selectMode); setSelectedIds(new Set()); }}>
          {selectMode ? '✕ 取消选择' : '☑️ 多选'}
        </button>
        {selectMode && (
          <>
            <button className="btn btn-sm btn-secondary" onClick={toggleSelectAll}>
              {selectedIds.size === filtered.length ? '☐ 取消全选' : '☑️ 全选'}
            </button>
            <button className="btn btn-sm btn-danger" onClick={handleDeleteSelected} disabled={deleting || selectedIds.size === 0}>
              {deleting ? '⏳ 删除中...' : `🗑️ 删除选中（${selectedIds.size}）`}
            </button>
          </>
        )}
        <button className="btn btn-sm btn-danger" onClick={handleClearAll} disabled={deleting || tasks.length === 0}>
          {deleting ? '⏳ ...' : '🗑️ 清空全部记录'}
        </button>
      </div>

      {/* 筛选 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>类型：</span>
        {TYPE_FILTERS.map((t) => (
          <button key={t} className={`btn btn-xs ${typeFilter === t ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTypeFilter(t)} style={{ fontSize: 11, padding: '2px 8px' }}>
            {t === 'all' ? '全部' : AiTaskTypeLabels[t]}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>状态：</span>
        {STATUS_FILTERS.map((s) => (
          <button key={s} className={`btn btn-xs ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setStatusFilter(s)} style={{ fontSize: 11, padding: '2px 8px' }}>
            {s === 'all' ? '全部' : { succeeded: '✅ 成功', failed: '❌ 失败', pending: '⏳ 等待', running: '🔄 运行中', cancelled: '🚫 已取消' }[s]}
          </button>
        ))}
      </div>

      {/* v1.0.27 筛选后快速清空 */}
      {(typeFilter !== 'all' || statusFilter !== 'all') && filtered.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button className="btn btn-xs btn-danger" onClick={async () => {
            if (!(await confirmDanger({ title: '删除筛选记录', message: `确定删除当前筛选的 ${filtered.length} 条记录吗？` }))) return;
            const ids = filtered.map((t) => t.id);
            console.log('[AI_TASK_DELETE_UI] delete filtered clicked', {
              selectedIds: ids,
              selectedCount: ids.length,
            });
            setDeleting(true);
            try {
              console.log('[AI_TASK_DELETE_UI] call deleteMany start', { ids, selectedCount: ids.length });
              const result = await aiTaskService.deleteMany(ids);
              console.log('[AI_TASK_DELETE_UI] deleteMany result', result);
              if (result.deletedCount === 0) {
                showMessage('未删除任何记录，请检查记录ID或数据库连接');
                return;
              }
              const reloaded = await loadTasks();
              const stillVisibleIds = reloaded.filter((item) => ids.includes(item.id)).map((item) => item.id);
              if (stillVisibleIds.length > 0) {
                console.error('[AI_TASK_DELETE_VERIFY_FAILED] deleted ids still visible', stillVisibleIds);
                showMessage('删除后仍检测到记录，请检查数据源');
                return;
              }
              setSelectedIds(new Set());
              showMessage(`已删除 ${result.deletedCount} 条筛选记录`);
            } catch (e: unknown) {
              const errorMessage = describeUnknownError(e);
              console.error('[AI_TASK_DELETE_UI] delete filtered failed full error', {
                errorMessage,
                error: e,
              });
              showMessage('删除失败：' + errorMessage, 8000);
            } finally { setDeleting(false); }
          }} disabled={deleting}>
            🗑️ 删除当前筛选的 {filtered.length} 条记录
          </button>
        </div>
      )}

      {/* 任务列表 */}
      {filtered.length === 0 ? (
        <div className="detail-card" style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🤖</div>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>暂无 AI 任务记录</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', maxWidth: 400, margin: '0 auto' }}>
            当你生成正文、分析风格、推荐角色、推荐事件、总结章节或润色正文后，这里会显示任务记录。
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {filtered.map((task) => (
            <div key={task.id} className="detail-card" style={{
              cursor: 'pointer',
              borderLeft: task.status === 'failed' ? '3px solid var(--color-error)' : task.status === 'succeeded' ? '3px solid var(--color-success)' : '3px solid var(--color-warning)',
              background: selectedIds.has(task.id) ? 'var(--color-primary-light)' : undefined,
            }} onClick={() => { if (selectMode) toggleSelect(task.id); else setExpandedId(expandedId === task.id ? null : task.id); }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                    {selectMode && (
                      <input type="checkbox" checked={selectedIds.has(task.id)} onChange={() => toggleSelect(task.id)} onClick={(e) => e.stopPropagation()} />
                    )}
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{AiTaskTypeLabels[task.taskType]}</span>
                    <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 3, background: task.status === 'succeeded' ? '#dcfce7' : task.status === 'failed' ? '#fee2e2' : '#fef3c7', color: task.status === 'succeeded' ? '#166534' : task.status === 'failed' ? '#991b1b' : '#92400e' }}>
                      {task.status === 'succeeded' ? '成功' : task.status === 'failed' ? '失败' : task.status === 'running' ? '运行中' : '等待'}
                    </span>
                    {task.modelName && <span style={{ fontSize: 10, color: 'var(--color-text-muted)' }}>{task.modelName}</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                    {task.inputSummary && task.inputSummary.slice(0, 60)}{task.inputSummary && task.inputSummary.length > 60 && '…'}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-muted)', marginTop: 2 }}>
                    {formatDateTime(task.createdAt)}
                    {task.finishedAt && ` → ${formatDateTime(task.finishedAt)}`}
                  </div>
                </div>
                {/* 删除按钮 */}
                {!selectMode && (
                  <button className="btn btn-text btn-sm" style={{ color: 'var(--color-error)', fontSize: 16, flexShrink: 0, marginLeft: 8 }}
                    onClick={(e) => { e.stopPropagation(); handleDeleteOne(task); }}
                    title="删除此记录"
                  >
                    🗑️
                  </button>
                )}
              </div>
              {expandedId === task.id && (
                <div style={{ marginTop: 8, padding: 8, background: 'var(--color-bg-primary)', borderRadius: 4, fontSize: 11 }}>
                  <div><strong>任务 ID：</strong>{task.id}</div>
                  {task.novelId && <div><strong>作品 ID：</strong>{task.novelId}</div>}
                  {task.chapterId && <div><strong>章节 ID：</strong>{task.chapterId}</div>}
                  {task.modelName && <div><strong>模型：</strong>{task.modelName}</div>}
                  {task.tokenInput != null && <div><strong>输入 Token：</strong>{formatTokenCount(task.tokenInput)}</div>}
                  {task.tokenOutput != null && <div><strong>输出 Token：</strong>{formatTokenCount(task.tokenOutput)}</div>}
                  {task.errorMessage && <div style={{ color: 'var(--color-error)', marginTop: 4 }}><strong>错误：</strong>{task.errorMessage}</div>}
                  {task.resultText && <div style={{ marginTop: 4, whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto', background: '#f8f8f8', padding: 6, borderRadius: 3 }}>{task.resultText.slice(0, 300)}{task.resultText.length > 300 && '…'}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default AiTasksPage;
