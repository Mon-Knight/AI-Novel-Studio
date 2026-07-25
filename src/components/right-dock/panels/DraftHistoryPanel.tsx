import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChapterDraft } from '../../../types/ai';
import { confirmInfo } from '../../../utils/nativeDialog';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { qualityCheckService } from '../../../services/quality/qualityCheckService';
import { formatDateTime } from '../../../utils/date';
import { formatNumber } from '../../../utils/format';
import type { QualityCheckReport } from '../../../types/qualityCheck';

interface DraftHistoryPanelProps {
  chapterId: string;
  currentDraftId?: string;
  onLoadDraft: (draft: ChapterDraft) => void;
  onDraftAdopted?: (draft: ChapterDraft) => void;
  onBeforeDocumentChange?: () => Promise<boolean>;
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

function DraftHistoryPanel({ chapterId, currentDraftId, onLoadDraft, onDraftAdopted, onBeforeDocumentChange, onClose }: DraftHistoryPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const liveChapterIdRef = useRef(chapterId);
  const loadEpochRef = useRef(0);
  liveChapterIdRef.current = chapterId;
  const [drafts, setDrafts] = useState<ChapterDraft[]>([]);
  const [latestReport, setLatestReport] = useState<QualityCheckReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const requestEpoch = ++loadEpochRef.current;
    const requestChapterId = chapterId;
    if (!requestChapterId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [list, report] = await Promise.all([
        draftVersionService.getByChapterId(requestChapterId),
        qualityCheckService.getLatestReport(requestChapterId).catch(() => null),
      ]);
      if (loadEpochRef.current !== requestEpoch || liveChapterIdRef.current !== requestChapterId) return;
      if (list.some((draft) => draft.chapterId !== requestChapterId)
        || (report && report.chapterId !== requestChapterId)) {
        throw new Error('草稿历史与目标章节不一致');
      }
      setDrafts(list.sort((a, b) => b.versionNo - a.versionNo));
      setLatestReport(report);
    } catch (error) {
      if (loadEpochRef.current === requestEpoch && liveChapterIdRef.current === requestChapterId) {
        console.error('[DraftHistory] failed to load chapter drafts', error);
        setMsg('草稿历史加载失败');
      }
    }
    if (loadEpochRef.current === requestEpoch && liveChapterIdRef.current === requestChapterId) {
      setLoading(false);
    }
  }, [chapterId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    function handleDocumentMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (panelRef.current?.contains(target)) return;
      if (target.closest('.right-toolbar')) return;
      onClose();
    }

    document.addEventListener('mousedown', handleDocumentMouseDown, true);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown, true);
  }, [onClose]);

  const handleAdopt = async (draft: ChapterDraft) => {
    if (busyDraftId) return;
    setBusyDraftId(draft.id);
    try {
      if (onBeforeDocumentChange && !(await onBeforeDocumentChange())) return;
      if (!(await confirmInfo({ title: '采用草稿', message: `确认采用 v${draft.versionNo} 作为正式正文？`, testId: 'apply-confirm' }))) return;
      const adoptedDraft = await draftVersionService.adopt(draft.id, chapterId);
      const syncedDraft = await draftVersionService.getAdoptedByChapterId(chapterId);
      const verifiedDraft = syncedDraft ?? adoptedDraft;
      if (verifiedDraft.id !== draft.id || verifiedDraft.chapterId !== chapterId || !verifiedDraft.isAdopted) {
        throw new Error('正文采用结果与目标章节不一致');
      }
      // Adoption is authoritative once the transaction commits, but the user
      // may have continued editing while that IPC was in flight. Re-check the
      // live editor before replacing it with the adopted version.
      if (onBeforeDocumentChange && !(await onBeforeDocumentChange())) {
        setMsg(`v${draft.versionNo} 已采用，当前未保存正文已保留`);
        await load();
        setTimeout(() => setMsg(''), 3000);
        return;
      }
      onDraftAdopted?.(verifiedDraft);
      setMsg(`v${draft.versionNo} 已采用`);
      await load();
    } catch (error) {
      console.error('[DraftHistory] failed to adopt draft', error);
      setMsg('采用失败，原正式正文未改变');
    } finally {
      setBusyDraftId(null);
    }
    setTimeout(() => setMsg(''), 2000);
  };

  const handleLoad = async (draft: ChapterDraft) => {
    if (busyDraftId) return;
    if (onBeforeDocumentChange && !(await onBeforeDocumentChange())) return;
    onLoadDraft(draft);
  };

  const handleDelete = async (draft: ChapterDraft) => {
    if (busyDraftId) return;
    setBusyDraftId(draft.id);
    try {
      if (!(await confirmInfo({ title: '废弃草稿', message: `确认废弃 v${draft.versionNo}？此操作不会删除已采用正文。`, testId: 'apply-confirm' }))) return;
      await draftVersionService.delete(draft.id, chapterId);
      setMsg(`v${draft.versionNo} 已废弃`);
      setTimeout(() => setMsg(''), 2000);
      await load();
    } finally {
      setBusyDraftId(null);
    }
  };

  return (
    <>
      <div className="right-panel-overlay" onClick={onClose} />
      <div
        ref={panelRef}
        className="right-panel"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{ width: 360 }}
      >
        <div className="right-panel-header">
          <span className="right-panel-title">📋 草稿历史</span>
          <button className="right-panel-close" onClick={onClose}>✕</button>
        </div>
        <div className="right-panel-body" data-testid="draft-history">
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
                <div key={draft.id} data-testid="draft-history-item" data-draft-id={draft.id} data-adopted={draft.isAdopted ? 'true' : 'false'} style={{
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
                    {latestReport?.draftId === draft.id && latestReport.overallScore != null && (
                      <span style={{ marginLeft: 8, color: 'var(--color-primary)', fontWeight: 600 }}>
                        质检 {latestReport.overallScore}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => { void handleLoad(draft); }} disabled={!!busyDraftId}
                      style={{ fontSize: 12 }}>📖 恢复</button>
                    {!draft.isAdopted && (
                      <button className="btn btn-primary btn-sm" onClick={() => handleAdopt(draft)} disabled={!!busyDraftId}
                        style={{ fontSize: 12 }}>✅ 采用</button>
                    )}
                    {!draft.isAdopted && (
                      <button className="btn btn-secondary btn-sm" onClick={() => handleDelete(draft)} disabled={!!busyDraftId}
                        style={{ fontSize: 12 }}>废弃</button>
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
