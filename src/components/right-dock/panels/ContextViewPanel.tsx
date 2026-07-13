/**
 * AI Novel Studio - 上下文记录查看面板
 * v1.7.14: 增加卷上下文生成 + 卷完成检查 + 过期联动
 */
import { useState, useEffect, useCallback } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { Volume } from '../../../types/volume';
import type { ContextRecord, ContextCategory } from '../../../types/context';
import type { VolumeCompletionCheck, VolumeSummarizeResult } from '../../../types/chapterSummary';
import { contextRecordService } from '../../../services/context/contextRecordService';
import { volumeRepository } from '../../../services/database/volumeRepository';
import { chapterRepository } from '../../../services/database/chapterRepository';
import { checkVolumeCompletion, collectVolumeChapterContexts, volumeSummaryAiService } from '../../../services/ai/volumeSummaryService';
import ContextRecordList from '../../context-records/ContextRecordList';
import ContextRecordForm from '../../context-records/ContextRecordForm';

interface ContextViewPanelProps {
  novelId?: string;
  chapter?: Chapter;
}

const CATEGORY_TABS: { key: ContextCategory | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'chapter_context', label: '章节上下文' },
  { key: 'volume_context', label: '卷上下文' },
  { key: 'manual_context', label: '手动上下文' },
];

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

  // 卷上下文状态
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [volumeChecks, setVolumeChecks] = useState<Record<string, VolumeCompletionCheck>>({});
  const [genLoading, setGenLoading] = useState<Record<string, boolean>>({});
  const [genError, setGenError] = useState<Record<string, string>>({});
  const [genMessage, setGenMessage] = useState<Record<string, string>>({});
  const [genResult, setGenResult] = useState<Record<string, VolumeSummarizeResult>>({});

  const load = useCallback(async () => {
    if (!novelId) return;
    setLoading(true);
    try {
      const recs = await contextRecordService.getByNovelId(novelId);
      // 预加载卷和章节（用于卷上下文 tab）
      const [v, c] = await Promise.all([
        volumeRepository.getByNovelId(novelId),
        chapterRepository.getByNovelId(novelId),
      ]);
      setVolumes(v);
      setChapters(c);

      // 检查每个卷的完成状态
      const checks: Record<string, VolumeCompletionCheck> = {};
      for (const vol of v) {
        checks[vol.id] = await checkVolumeCompletion(vol, c);
      }
      setVolumeChecks(checks);

      // 过期联动：检查卷上下文是否仍有效
      let changed = false;
      for (const r of recs) {
        if (r.contextType === 'volume_summary' && r.volumeId && !r.isExpired) {
          const check = checks[r.volumeId];
          if (check && !check.completed) {
            r.isExpired = true;
            await contextRecordService.update(r.id, { isExpired: true }).catch(() => {});
            changed = true;
          }
        }
      }
      // 如果有变更，重新加载
      if (changed) {
        setRecords(await contextRecordService.getByNovelId(novelId));
      } else {
        setRecords(recs);
      }
    } catch (e) { console.error(e); }
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

  // 生成卷上下文
  const handleGenerateVolumeContext = async (volume: Volume) => {
    if (!novelId) return;
    setGenLoading((prev) => ({ ...prev, [volume.id]: true }));
    setGenError((prev) => ({ ...prev, [volume.id]: '' }));
    setGenMessage((prev) => ({ ...prev, [volume.id]: '' }));

    try {
      const chapterContexts = await collectVolumeChapterContexts(volume.id, chapters);
      const created = await volumeSummaryAiService.submitBackground({
        novelId, volumeId: volume.id, volumeTitle: volume.title, chapterContexts,
      });
      setGenMessage((prev) => ({
        ...prev,
        [volume.id]: `卷摘要已转入后台（${created.rootTaskId.slice(0, 8)}），完成后请在任务中心审查。`,
      }));
      return;

    } catch (e: any) {
      setGenError((prev) => ({ ...prev, [volume.id]: e.message || '生成失败' }));
    } finally {
      setGenLoading((prev) => ({ ...prev, [volume.id]: false }));
    }
  };

  // 保存卷上下文
  const handleSaveVolumeContext = async (volume: Volume) => {
    const result = genResult[volume.id];
    if (!novelId || !result) return;

    const content = [
      `## ${result.summaryTitle}`,
      `**主线**：${result.volumeMainArc}`,
      result.majorEvents.length > 0 ? `**重大事件**：\n${result.majorEvents.map((e: string) => `- ${e}`).join('\n')}` : '',
      result.protagonistGrowth ? `**主角成长**：${result.protagonistGrowth}` : '',
      result.settingChanges.length > 0 ? `**设定变化**：\n${result.settingChanges.map((s: string) => `- ${s}`).join('\n')}` : '',
      result.foreshadowingCollected.length > 0 ? `**已埋伏笔**：\n${result.foreshadowingCollected.map((f: string) => `- ${f}`).join('\n')}` : '',
      result.unresolvedQuestions.length > 0 ? `**未解决问题**：\n${result.unresolvedQuestions.map((q: string) => `- ${q}`).join('\n')}` : '',
      result.factsMustRemember.length > 0 ? `**关键事实**：\n${result.factsMustRemember.map((f: string) => `- ${f}`).join('\n')}` : '',
      result.nextVolumeHook ? `**下卷衔接**：${result.nextVolumeHook}` : '',
    ].filter(Boolean).join('\n\n');

    await contextRecordService.create({
      novelId,
      volumeId: volume.id,
      contextType: 'volume_summary',
      title: result.summaryTitle || `${volume.title} 卷总结`,
      content,
      importance: 5,
      isActive: true,
    });

    // 刷新
    setGenResult((prev) => {
      const next = { ...prev };
      delete next[volume.id];
      return next;
    });
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

        {/* 卷上下文生成区 */}
        {activeTab === 'volume_context' && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 6 }}>
              📚 卷上下文生成
            </div>
            {volumes.length === 0 && (
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', padding: 8 }}>
                暂无分卷。请先在作品详情页创建分卷。
              </div>
            )}
            {volumes.map((vol) => {
              const check = volumeChecks[vol.id];
              const isLoading = genLoading[vol.id];
              const error = genError[vol.id];
              const message = genMessage[vol.id];
              const result = genResult[vol.id];

              return (
                <div
                  key={vol.id}
                  style={{
                    padding: 8, marginBottom: 6, borderRadius: 6,
                    border: '1px solid var(--color-border-light)',
                    background: 'var(--color-bg-primary)',
                  }}
                >
                  <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 4 }}>
                    📖 {vol.title}
                    {check && (
                      <span style={{
                        fontSize: 10, marginLeft: 6, padding: '1px 6px', borderRadius: 3,
                        background: check.completed ? '#22c55e20' : '#f59e0b20',
                        color: check.completed ? '#16a34a' : '#d97706',
                      }}>
                        {check.completed ? '✅ 可生成' : '⏳ 未就绪'}
                      </span>
                    )}
                  </div>

                  {/* 未就绪原因 */}
                  {check && !check.completed && check.reasons.length > 0 && (
                    <div style={{ fontSize: 10, color: '#d97706', marginBottom: 6 }}>
                      {check.reasons.map((r: string, i: number) => (
                        <div key={i}>• {r}</div>
                      ))}
                    </div>
                  )}

                  {/* 生成按钮 */}
                  {check?.completed && !result && (
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => handleGenerateVolumeContext(vol)}
                      disabled={isLoading}
                      style={{ width: '100%', fontSize: 11 }}
                    >
                      {isLoading ? '⏳ 生成中...' : '🤖 生成卷上下文'}
                    </button>
                  )}
                  {error && <div style={{ fontSize: 10, color: 'var(--color-error)', marginTop: 4 }}>{error}</div>}
                  {message && <div style={{ fontSize: 10, color: 'var(--color-success)', marginTop: 4 }}>{message}</div>}

                  {/* 生成结果预览 */}
                  {result && (
                    <div style={{ marginTop: 6, fontSize: 11 }}>
                      <div style={{ fontWeight: 500, color: 'var(--color-success)', marginBottom: 4 }}>
                        ✅ {result.summaryTitle}
                      </div>
                      <div style={{ color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 4 }}>
                        {result.volumeMainArc.slice(0, 150)}…
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => handleSaveVolumeContext(vol)}
                          style={{ flex: 1, fontSize: 10 }}
                        >
                          💾 保存为上下文
                        </button>
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={() => setGenResult((prev) => { const n = { ...prev }; delete n[vol.id]; return n; })}
                          style={{ flex: 1, fontSize: 10 }}
                        >
                          放弃
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

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
