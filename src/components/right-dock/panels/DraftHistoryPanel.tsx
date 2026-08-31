import { appLogger } from '../../../services/observability/appLogger';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChapterDraft } from '../../../types/ai';
import { confirmInfo } from '../../../utils/nativeDialog';
import { draftVersionService } from '../../../services/database/draftVersionService';
import { qualityCheckService } from '../../../services/quality/qualityCheckService';
import { formatDateTime } from '../../../utils/date';
import { formatNumber } from '../../../utils/format';
import type { QualityCheckReport } from '../../../types/qualityCheck';
import { CheckCircle2, FileText, History, RotateCcw, X } from 'lucide-react';

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

const DRAFT_PAGE_SIZE = 20;

function DraftHistoryPanel({
  chapterId,
  currentDraftId,
  onLoadDraft,
  onDraftAdopted,
  onBeforeDocumentChange,
  onClose,
}: DraftHistoryPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const liveChapterIdRef = useRef(chapterId);
  const loadEpochRef = useRef(0);
  liveChapterIdRef.current = chapterId;
  const [drafts, setDrafts] = useState<ChapterDraft[]>([]);
  const [total, setTotal] = useState(0);
  const [latestReport, setLatestReport] = useState<QualityCheckReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [busyDraftId, setBusyDraftId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const load = useCallback(
    async (requestedPage: number) => {
      const requestEpoch = ++loadEpochRef.current;
      const requestChapterId = chapterId;
      if (!requestChapterId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const [result, report] = await Promise.all([
          draftVersionService.getPageByChapterId(requestChapterId, requestedPage, DRAFT_PAGE_SIZE),
          qualityCheckService.getLatestReport(requestChapterId).catch(() => null),
        ]);
        if (loadEpochRef.current !== requestEpoch || liveChapterIdRef.current !== requestChapterId)
          return;
        if (
          result.items.some((draft) => draft.chapterId !== requestChapterId) ||
          (report && report.chapterId !== requestChapterId)
        ) {
          throw new Error('草稿历史与目标章节不一致');
        }
        setDrafts(result.items);
        setTotal(result.total);
        const lastPage = Math.max(1, Math.ceil(result.total / DRAFT_PAGE_SIZE));
        if (requestedPage > lastPage) setPage(lastPage);
        setLatestReport(report);
      } catch (error) {
        if (
          loadEpochRef.current === requestEpoch &&
          liveChapterIdRef.current === requestChapterId
        ) {
          appLogger.error('[DraftHistory] failed to load chapter drafts', error);
          setMsg('草稿历史加载失败');
        }
      }
      if (loadEpochRef.current === requestEpoch && liveChapterIdRef.current === requestChapterId) {
        setLoading(false);
      }
    },
    [chapterId],
  );

  useEffect(() => {
    setPage(1);
    setDrafts([]);
    setTotal(0);
  }, [chapterId]);

  useEffect(() => {
    void load(page);
  }, [load, page]);

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
      if (
        !(await confirmInfo({
          title: '采用草稿',
          message: `确认采用 v${draft.versionNo} 作为正式正文？`,
          testId: 'apply-confirm',
        }))
      )
        return;
      const adoptedDraft = await draftVersionService.adopt(draft.id, chapterId);
      const syncedDraft = await draftVersionService.getAdoptedByChapterId(chapterId);
      const verifiedDraft = syncedDraft ?? adoptedDraft;
      if (
        verifiedDraft.id !== draft.id ||
        verifiedDraft.chapterId !== chapterId ||
        !verifiedDraft.isAdopted
      ) {
        throw new Error('正文采用结果与目标章节不一致');
      }
      // Adoption is authoritative once the transaction commits, but the user
      // may have continued editing while that IPC was in flight. Re-check the
      // live editor before replacing it with the adopted version.
      if (onBeforeDocumentChange && !(await onBeforeDocumentChange())) {
        setMsg(`v${draft.versionNo} 已采用，当前未保存正文已保留`);
        await load(page);
        setTimeout(() => setMsg(''), 3000);
        return;
      }
      onDraftAdopted?.(verifiedDraft);
      setMsg(`v${draft.versionNo} 已采用`);
      await load(page);
    } catch (error) {
      appLogger.error('[DraftHistory] failed to adopt draft', error);
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
      if (
        !(await confirmInfo({
          title: '废弃草稿',
          message: `确认废弃 v${draft.versionNo}？此操作不会删除已采用正文。`,
          testId: 'apply-confirm',
        }))
      )
        return;
      await draftVersionService.delete(draft.id, chapterId);
      setMsg(`v${draft.versionNo} 已废弃`);
      setTimeout(() => setMsg(''), 2000);
      await load(page);
    } finally {
      setBusyDraftId(null);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / DRAFT_PAGE_SIZE));
  const visiblePage = Math.min(page, totalPages);
  const visibleDrafts = drafts;

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
          <span className="right-panel-title">
            <History aria-hidden="true" size={16} strokeWidth={1.8} />
            <span>草稿历史</span>
          </span>
          <button
            type="button"
            className="right-panel-close"
            aria-label="关闭草稿历史"
            title="关闭"
            onClick={onClose}
          >
            <X aria-hidden="true" size={17} strokeWidth={1.8} />
          </button>
        </div>
        <div className="right-panel-body" data-testid="draft-history">
          {msg && (
            <div
              style={{
                fontSize: 13,
                padding: '6px 12px',
                background: 'var(--color-success-bg)',
                borderRadius: 6,
                marginBottom: 12,
                color: 'var(--color-success-text)',
              }}
            >
              {msg}
            </div>
          )}

          {loading ? (
            <div className="text-sm text-muted" style={{ textAlign: 'center', padding: 16 }}>
              加载中...
            </div>
          ) : drafts.length === 0 ? (
            <div className="text-sm text-muted" style={{ textAlign: 'center', padding: 24 }}>
              <FileText aria-hidden="true" size={22} strokeWidth={1.8} />
              <div>暂无草稿</div>
              <br />
              <span style={{ fontSize: 12 }}>使用 AI 生成或手动保存创建草稿版本</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {visibleDrafts.map((draft) => (
                <div
                  key={draft.id}
                  data-testid="draft-history-item"
                  data-draft-id={draft.id}
                  data-adopted={draft.isAdopted ? 'true' : 'false'}
                  style={{
                    border: `1px solid ${draft.id === currentDraftId ? 'var(--color-primary)' : 'var(--color-border-light)'}`,
                    borderRadius: 8,
                    padding: 12,
                    background: draft.isAdopted
                      ? 'var(--color-success-bg)'
                      : draft.id === currentDraftId
                        ? 'var(--color-primary-light)'
                        : 'var(--color-bg-card)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: 14 }}>
                      v{draft.versionNo}
                      {draft.isAdopted && (
                        <span
                          style={{ color: 'var(--color-success)', fontSize: 12, marginLeft: 6 }}
                        >
                          <CheckCircle2 aria-hidden="true" size={13} strokeWidth={1.8} /> 已采用
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                      {formatNumber(draft.wordCount)} 字
                    </span>
                  </div>
                  <div
                    style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}
                  >
                    {sourceLabels[draft.source] || draft.source} · {formatDateTime(draft.createdAt)}
                    {latestReport?.draftId === draft.id && latestReport.overallScore != null && (
                      <span
                        style={{ marginLeft: 8, color: 'var(--color-primary)', fontWeight: 600 }}
                      >
                        质检 {latestReport.overallScore}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        void handleLoad(draft);
                      }}
                      disabled={!!busyDraftId}
                      style={{ fontSize: 12 }}
                    >
                      <RotateCcw aria-hidden="true" size={13} strokeWidth={1.8} />
                      <span>恢复</span>
                    </button>
                    {!draft.isAdopted && (
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleAdopt(draft)}
                        disabled={!!busyDraftId}
                        style={{ fontSize: 12 }}
                      >
                        <CheckCircle2 aria-hidden="true" size={13} strokeWidth={1.8} />
                        <span>采用</span>
                      </button>
                    )}
                    {!draft.isAdopted && (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => handleDelete(draft)}
                        disabled={!!busyDraftId}
                        style={{ fontSize: 12 }}
                      >
                        废弃
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {totalPages > 1 && (
                <nav className="list-pagination" aria-label="草稿历史分页">
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={visiblePage <= 1}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                  >
                    上一页
                  </button>
                  <span>
                    {visiblePage} / {totalPages} · 共 {total} 条
                  </span>
                  <button
                    className="btn btn-secondary btn-sm"
                    disabled={visiblePage >= totalPages}
                    onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  >
                    下一页
                  </button>
                </nav>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default DraftHistoryPanel;
