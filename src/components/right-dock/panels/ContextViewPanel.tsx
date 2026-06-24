/**
 * AI Novel Studio - 上下文记录查看面板
 * v1.7.13: 增加章节上下文/卷上下文/手动上下文分类 + 过期标记
 */
import { useState, useEffect, useCallback } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ContextRecord, ContextCategory } from '../../../types/context';
import { ContextRecordTypeLabels } from '../../../types/context';
import { contextRecordService } from '../../../services/context/contextRecordService';
import ContextRecordList from '../../context-records/ContextRecordList';
import ContextRecordForm from '../../context-records/ContextRecordForm';

interface ContextViewPanelProps {
  novelId?: string;
  chapter?: Chapter;
}

const CATEGORY_TABS: { key: ContextCategory | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'chapter_context', label: '章节上下文' },
  { key: 'manual_context', label: '手动上下文' },
];

/** 根据 contextType 判断分类 */
function classifyRecord(r: ContextRecord): ContextCategory {
  if (r.chapterId && (r.contextType === 'chapter_summary' || r.contextType === 'plot_progress')) {
    return 'chapter_context';
  }
  if (r.contextType === 'volume_summary') return 'volume_context';
  return 'manual_context';
}

function ContextViewPanel({ novelId, chapter }: ContextViewPanelProps) {
  const [records, setRecords] = useState<ContextRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [activeTab, setActiveTab] = useState<ContextCategory | 'all'>('all');

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

  const filteredRecords = activeTab === 'all'
    ? records
    : records.filter((r) => classifyRecord(r) === activeTab);

  const activeCount = filteredRecords.filter((r) => r.isActive && !r.isExpired).length;
  const expiredCount = filteredRecords.filter((r) => r.isExpired).length;

  if (!novelId) return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择作品</div>;

  return (
    <div>
      <div className="panel-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div className="panel-section-title" style={{ marginBottom: 0 }}>
            📦 上下文记录（{filteredRecords.length}）
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(!showForm)}>
            {showForm ? '取消' : '➕ 新增'}
          </button>
        </div>

        {/* 分类标签 */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
          {CATEGORY_TABS.map((tab) => {
            const count = tab.key === 'all'
              ? records.length
              : records.filter((r) => classifyRecord(r) === tab.key).length;
            return (
              <button
                key={tab.key}
                className={`btn btn-sm ${activeTab === tab.key ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setActiveTab(tab.key)}
                style={{ fontSize: 10, padding: '2px 8px' }}
              >
                {tab.label}（{count}）
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginBottom: 8 }}>
          启用 {activeCount} 条 / 共 {filteredRecords.length} 条
          {expiredCount > 0 && <span style={{ color: '#d97706', marginLeft: 6 }}>⏳ {expiredCount} 条已过期</span>}
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
            records={filteredRecords}
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
