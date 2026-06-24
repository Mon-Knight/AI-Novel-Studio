/**
 * AI Novel Studio - 章节总结确认弹窗组件
 */
import { useState } from 'react';
import type { ChapterSummarizeResult } from '../../types/chapterSummary';

interface ChapterSummaryDialogProps {
  result: ChapterSummarizeResult;
  chapterTitle: string;
  loading: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (edited: ChapterSummarizeResult) => void;
  onRegenerate: () => void;
}

function ChapterSummaryDialog({ result, chapterTitle, loading, error, onClose, onConfirm, onRegenerate }: ChapterSummaryDialogProps) {
  const [summary, setSummary] = useState(result.summary);
  const [nextHints, setNextHints] = useState(result.nextChapterHints);
  const [keyEvents, setKeyEvents] = useState(result.keyEvents.join('\n'));
  const [newForeshadows, setNewForeshadows] = useState(result.newForeshadows.join('\n'));
  const [resolvedForeshadows, setResolvedForeshadows] = useState(result.resolvedForeshadows.join('\n'));

  const buildEdited = (): ChapterSummarizeResult => ({
    ...result,
    summary,
    nextChapterHints: nextHints,
    keyEvents: keyEvents.split('\n').filter(Boolean),
    newForeshadows: newForeshadows.split('\n').filter(Boolean),
    resolvedForeshadows: resolvedForeshadows.split('\n').filter(Boolean),
  });

  return (
    <>
      <div className="right-panel-overlay" onClick={onClose} />
      <div className="right-panel" style={{ width: 480, zIndex: 200 }} onClick={(e) => e.stopPropagation()}>
        <div className="right-panel-header">
          <span className="right-panel-title">📝 章节总结确认 —— {chapterTitle}</span>
          <button className="right-panel-close" onClick={onClose}>✕</button>
        </div>
        <div className="right-panel-body" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
          {loading && <div style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-muted)' }}>⏳ AI 正在生成章节总结……</div>}
          {error && <div style={{ padding: 12, color: 'var(--color-error)', fontSize: 13, marginBottom: 8 }}>❌ {error}<div style={{ marginTop: 8 }}><button className="btn btn-secondary btn-sm" onClick={onRegenerate}>🔄 重试</button></div></div>}

          {!loading && (
            <>
              {/* 章节摘要 */}
              <div className="panel-section">
                <div className="panel-section-title">📋 章节摘要</div>
                <textarea
                  className="input"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  rows={4}
                  style={{ width: '100%', resize: 'vertical', fontSize: 13 }}
                />
              </div>

              {/* 关键事件 */}
              <div className="panel-section">
                <div className="panel-section-title">⚡ 关键事件（每行一个）</div>
                <textarea className="input" value={keyEvents} onChange={(e) => setKeyEvents(e.target.value)} rows={3} style={{ width: '100%', resize: 'vertical', fontSize: 12 }} />
              </div>

              {/* 角色变化 */}
              <div className="panel-section">
                <div className="panel-section-title">👤 角色变化</div>
                {result.characterChanges.map((cc, i) => (
                  <div key={i} style={{ padding: 8, marginBottom: 6, background: 'var(--color-bg-primary)', borderRadius: 4, fontSize: 12 }}>
                    <strong>{cc.characterName}</strong>
                    <div style={{ color: 'var(--color-text-secondary)', marginTop: 2 }}>{cc.stateSummary}</div>
                    {cc.goalChanges && <div>目标变化：{cc.goalChanges}</div>}
                    {cc.relationshipChanges && <div>关系变化：{cc.relationshipChanges}</div>}
                  </div>
                ))}
              </div>

              {/* 伏笔 */}
              <div className="panel-section">
                <div className="panel-section-title">🔮 新增伏笔（每行一个）</div>
                <textarea className="input" value={newForeshadows} onChange={(e) => setNewForeshadows(e.target.value)} rows={2} style={{ width: '100%', resize: 'vertical', fontSize: 12 }} />
              </div>
              <div className="panel-section">
                <div className="panel-section-title">✅ 已回收伏笔（每行一个）</div>
                <textarea className="input" value={resolvedForeshadows} onChange={(e) => setResolvedForeshadows(e.target.value)} rows={2} style={{ width: '100%', resize: 'vertical', fontSize: 12 }} />
              </div>

              {/* 下一章衔接 */}
              <div className="panel-section">
                <div className="panel-section-title">🔗 下一章衔接建议</div>
                <textarea className="input" value={nextHints} onChange={(e) => setNextHints(e.target.value)} rows={2} style={{ width: '100%', resize: 'vertical', fontSize: 12 }} />
              </div>

              {/* 将生成的上下文记录 */}
              <div className="panel-section">
                <div className="panel-section-title">📦 将生成的上下文记录（{result.contextRecords.length} 条）</div>
                {result.contextRecords.map((cr, i) => (
                  <div key={i} style={{ padding: 6, marginBottom: 4, fontSize: 12, borderLeft: '3px solid var(--color-primary)', paddingLeft: 8 }}>
                    <span style={{ fontWeight: 500 }}>[{cr.contextType}] {cr.title}</span>
                    <div style={{ color: 'var(--color-text-muted)' }}>{cr.content}</div>
                  </div>
                ))}
              </div>

              {/* 操作按钮 */}
              <div style={{ display: 'flex', gap: 8, padding: '12px 0', borderTop: '1px solid var(--color-border-light)' }}>
                <button className="btn btn-secondary btn-sm" onClick={onClose}>取消</button>
                <button className="btn btn-secondary btn-sm" onClick={onRegenerate}>🔄 重新生成</button>
                <button className="btn btn-primary btn-sm" onClick={() => onConfirm(buildEdited())} style={{ flex: 1 }}>
                  ✅ 确认保存总结
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default ChapterSummaryDialog;
