import { useState, useEffect, useCallback } from 'react';
import type { ChapterDraft } from '../../../types/ai';
import { confirmInfo } from '../../../utils/nativeDialog';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { formatDateTime } from '../../../utils/date';
import { formatNumber } from '../../../utils/format';

interface DraftHistoryPanelProps {
  chapterId: string;
  currentDraftId?: string;
  onLoadDraft: (draft: ChapterDraft) => void;
  onClose: () => void;
}

const sourceLabels: Record<string, string> = {
  ai_generated: 'AI 初稿',
  ai_regenerated: 'AI 重生成',
  user_edited: '用户编辑',
  ai_polished: 'AI 润色',
  imported: '导入',
  manual_placeholder: '手动占位',
};

function DraftHistoryPanel({ chapterId, currentDraftId, onLoadDraft, onClose }: DraftHistoryPanelProps) {
  const [drafts, setDrafts] = useState<ChapterDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    if (!chapterId) { setLoading(false); return; }
    try {
      const list = await draftVersionService.getByChapterId(chapterId);
      setDrafts(list.sort((a, b) => b.versionNo - a.versionNo));
    } catch { /* ignore */ }
    setLoading(false);
  }, [chapterId]);

  useEffect(() => { load(); }, [load]);

  const handleAdopt = async (draft: ChapterDraft) => {
    if (!(await confirmInfo({ title: '采用草稿', message: `确认采用 v${draft.versionNo} 作为正式正文？` }))) return;
    await draftVersionService.adopt(draft.id, chapterId);
    setMsg(`v${draft.versionNo} 已采用`);
    setTimeout(() => setMsg(''), 2000);
    await load();
  };

  return (
    <>
      <div className="right-panel-overlay" onClick={onClose} />
      <div className="right-panel" onClick={(e) => e.stopPropagation()} style={{ width: 360 }}>
        <div className="right-panel-header">
          <span className="right-panel-title">📋 草稿历史</span>
          <button className="right-panel-close" onClick={onClose}>✕</button>
        </div>
        <div className="right-panel-body">
          {msg && (
            <div style={{ fontSize: 13, padding: '6px 12px', background: '#e8f5e9', borderRadius: 6, marginBottom: 12, color: '#2e7d32' }}>
              {msg}
            </div>
          )}

          {loading ? (
            <div className="text-sm text-muted" style={{ textAlign: 'center', padding: 16 }}>加载中...</div>
          ) : drafts.length === 0 ? (
            <div className="text-sm text-muted" style={{ textAlign: 'center', padding: 24 }}>
              📄 暂无草稿
              <br /><span style={{ fontSize: 12 }}>使用 AI 生成或手动保存创建草稿版本</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {drafts.map((draft) => (
                <div key={draft.id} style={{
                  border: `1px solid ${draft.id === currentDraftId ? 'var(--color-primary)' : 'var(--color-border-light)'}`,
                  borderRadius: 8, padding: 12,
                  background: draft.isAdopted ? '#e8f5e9' : draft.id === currentDraftId ? 'var(--color-primary-light)' : 'var(--color-bg-card)',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      v{draft.versionNo}
                      {draft.isAdopted && <span style={{ color: 'var(--color-success)', fontSize: 12, marginLeft: 6 }}>✅ 已采用</span>}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                      {formatNumber(draft.wordCount)} 字
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
                    {sourceLabels[draft.source] || draft.source} · {formatDateTime(draft.createdAt)}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => onLoadDraft(draft)}
                      style={{ fontSize: 12 }}>📖 载入</button>
                    {!draft.isAdopted && (
                      <button className="btn btn-primary btn-sm" onClick={() => handleAdopt(draft)}
                        style={{ fontSize: 12 }}>✅ 采用</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default DraftHistoryPanel;
