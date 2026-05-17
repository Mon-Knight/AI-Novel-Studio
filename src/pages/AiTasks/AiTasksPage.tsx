/**
 * AI Novel Studio - AI 任务记录页面
 */
import { useState, useEffect } from 'react';
import BackButton from '../../components/common/BackButton';
import { aiTaskService } from '../../services/ai/aiTaskService';
import type { AiTaskRecord, AiTaskType, AiTaskStatus } from '../../types/ai';
import { AiTaskTypeLabels } from '../../types/ai';

const TYPE_FILTERS: (AiTaskType | 'all')[] = ['all', 'chapter_generate', 'character_generate', 'event_suggest', 'chapter_summarize', 'quality_check', 'chapter_polish'];
const STATUS_FILTERS: (AiTaskStatus | 'all')[] = ['all', 'succeeded', 'failed', 'pending', 'running'];

function AiTasksPage() {
  const [tasks, setTasks] = useState<AiTaskRecord[]>([]);
  const [typeFilter, setTypeFilter] = useState<AiTaskType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<AiTaskStatus | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    aiTaskService.getAll(1, 200).then((r) => setTasks(r.items));
  }, []);

  const filtered = tasks
    .filter((t) => typeFilter === 'all' || t.taskType === typeFilter)
    .filter((t) => statusFilter === 'all' || t.status === statusFilter)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div style={{ padding: 32, maxWidth: 900, margin: '0 auto', height: '100%', overflowY: 'auto' }}>
      <BackButton label="返回首页" to="/" />
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, marginTop: 12 }}>🤖 AI 任务记录</div>
      <div style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 24 }}>查看所有 AI 生成、分析、检查和润色任务的执行记录</div>

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
            <div key={task.id} className="detail-card" style={{ cursor: 'pointer', borderLeft: task.status === 'failed' ? '3px solid var(--color-error)' : task.status === 'succeeded' ? '3px solid var(--color-success)' : '3px solid var(--color-warning)' }}
              onClick={() => setExpandedId(expandedId === task.id ? null : task.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
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
                    {new Date(task.createdAt).toLocaleString('zh-CN')}
                    {task.finishedAt && ` → ${new Date(task.finishedAt).toLocaleString('zh-CN')}`}
                  </div>
                </div>
              </div>
              {expandedId === task.id && (
                <div style={{ marginTop: 8, padding: 8, background: 'var(--color-bg-primary)', borderRadius: 4, fontSize: 11 }}>
                  <div><strong>任务 ID：</strong>{task.id}</div>
                  {task.novelId && <div><strong>作品 ID：</strong>{task.novelId}</div>}
                  {task.chapterId && <div><strong>章节 ID：</strong>{task.chapterId}</div>}
                  {task.modelName && <div><strong>模型：</strong>{task.modelName}</div>}
                  {task.tokenInput != null && <div><strong>输入 Token：</strong>{task.tokenInput}</div>}
                  {task.tokenOutput != null && <div><strong>输出 Token：</strong>{task.tokenOutput}</div>}
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
