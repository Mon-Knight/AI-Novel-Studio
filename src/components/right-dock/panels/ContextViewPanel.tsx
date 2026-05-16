/**
 * AI Novel Studio - 上下文记录查看面板
 */
import { useState, useEffect, useCallback } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ContextRecord } from '../../../types/context';
import { contextRecordService } from '../../../services/context/contextRecordService';
import ContextRecordList from '../../context-records/ContextRecordList';
import ContextRecordForm from '../../context-records/ContextRecordForm';

interface ContextViewPanelProps {
  novelId?: string;
  chapter?: Chapter;
}

function ContextViewPanel({ novelId, chapter }: ContextViewPanelProps) {
  const [records, setRecords] = useState<ContextRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    if (!novelId) return;
    setLoading(true);
    try { setRecords(await contextRecordService.getByNovelId(novelId)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [novelId]);

  useEffect(() => { load(); }, [load]);

  const handleToggleActive = async (id: string, isActive: boolean) => {
    await contextRecordService.setActive(id, isActive);
    setRecords((prev) => prev.map((r) => r.id === id ? { ...r, isActive } : r));
  };

  const handleDelete = async (id: string) => {
    await contextRecordService.remove(id);
    setRecords((prev) => prev.filter((r) => r.id !== id));
  };

  const handleAdd = async (input: any) => {
    await contextRecordService.create(input);
    setShowForm(false);
    await load();
  };

  const activeCount = records.filter((r) => r.isActive).length;

  if (!novelId) return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择作品</div>;

  return (
    <div>
      <div className="panel-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="panel-section-title" style={{ marginBottom: 0 }}>
            📦 上下文记录（{records.length}）
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? '取消' : '➕ 新增'}
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
          启用 {activeCount} 条 / 共 {records.length} 条
        </div>

        {showForm && (
          <ContextRecordForm
            novelId={novelId}
            chapterId={chapter?.id}
            onSave={handleAdd}
            onCancel={() => setShowForm(false)}
          />
        )}

        {loading ? (
          <div style={{ padding: 16, color: 'var(--color-text-muted)', textAlign: 'center' }}>加载中...</div>
        ) : (
          <ContextRecordList
            records={records}
            onToggleActive={handleToggleActive}
            onDelete={handleDelete}
            compact
          />
        )}
      </div>
    </div>
  );
}

export default ContextViewPanel;
