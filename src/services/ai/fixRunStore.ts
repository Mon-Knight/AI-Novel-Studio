/**
 * AI Novel Studio - 质量修稿记录持久化（Tauri SQLite + localStorage 回退）
 * v1.7.17: 升级为 Tauri SQLite 持久化
 */
import { lsGet, lsSet, nowISO, dbCall, isTauri } from '../database/db';
import type { QualityFixRun } from '../ai/qualityFixService';

const KEY = 'ai_novel_studio_fix_runs';

function getAllLocal(): QualityFixRun[] { return lsGet<QualityFixRun[]>(KEY) ?? []; }
function saveAllLocal(items: QualityFixRun[]): void { lsSet(KEY, items); }

function toTauriInput(fixRun: QualityFixRun): Record<string, unknown> {
  return {
    id: fixRun.id,
    novelId: fixRun.novelId,
    chapterId: fixRun.chapterId,
    sourceDraftId: fixRun.sourceDraftId,
    sourceDraftVersion: fixRun.sourceDraftVersion,
    targetDraftId: fixRun.targetDraftId || null,
    targetDraftVersion: fixRun.targetDraftVersion || null,
    sourceContentHash: fixRun.sourceContentHash || null,
    targetContentHash: fixRun.targetContentHash || null,
    beforeReportId: fixRun.beforeReportId || null,
    afterReportId: fixRun.afterReportId || null,
    beforeScore: fixRun.beforeScore || null,
    afterScore: fixRun.afterScore || null,
    beforePendingCount: fixRun.beforePendingCount,
    afterPendingCount: fixRun.afterPendingCount || null,
    beforeSeriousCount: fixRun.beforeSeriousCount,
    afterSeriousCount: fixRun.afterSeriousCount || null,
    fixedIssueIds: fixRun.fixedIssueIds.length > 0 ? JSON.stringify(fixRun.fixedIssueIds) : null,
    newIssueIds: fixRun.newIssueIds.length > 0 ? JSON.stringify(fixRun.newIssueIds) : null,
    mode: fixRun.mode,
    status: fixRun.status,
    model: fixRun.model || null,
    revisionSummary: fixRun.revisionSummary || null,
    changedRangesJson: fixRun.changedRangesJson || null,
    usedContextIds: (fixRun as any).usedContextIds || null,
    skippedContextIds: (fixRun as any).skippedContextIds || null,
    warnings: (fixRun as any).warnings || null,
    failureReason: fixRun.failureReason || null,
  };
}

export const fixRunStore = {
  async getByChapterId(chapterId: string): Promise<QualityFixRun[]> {
    if (isTauri()) {
      const dtos = await dbCall<any[]>('get_quality_fix_runs', { chapterId });
      return Array.isArray(dtos) ? dtos.map(fromTauriDto) : [];
    }
    return getAllLocal().filter((r) => r.chapterId === chapterId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async getLatest(chapterId: string): Promise<QualityFixRun | null> {
    const runs = await this.getByChapterId(chapterId);
    return runs[0] ?? null;
  },

  async getById(id: string): Promise<QualityFixRun | null> {
    return getAllLocal().find((r) => r.id === id) ?? null;
  },

  async save(fixRun: QualityFixRun): Promise<QualityFixRun> {
    const r = { ...fixRun, updatedAt: nowISO() };
    if (isTauri()) {
      const dto = await dbCall<any>('save_quality_fix_run', { input: toTauriInput(r) });
      return fromTauriDto(dto);
    }

    const list = getAllLocal();
    const idx = list.findIndex((x) => x.id === r.id);
    if (idx >= 0) { list[idx] = r; } else { list.push(r); }
    saveAllLocal(list);
    return r;
  },

  async updateStatus(id: string, status: QualityFixRun['status']): Promise<QualityFixRun | null> {
    if (isTauri()) {
      await dbCall('update_quality_fix_run_status', { id, status });
      return null;
    }
    const list = getAllLocal();
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    list[idx].status = status;
    list[idx].updatedAt = nowISO();
    saveAllLocal(list);
    return list[idx];
  },
};

function fromTauriDto(dto: any): QualityFixRun {
  return {
    id: dto.id,
    novelId: dto.novelId || dto.novel_id,
    chapterId: dto.chapterId || dto.chapter_id,
    sourceDraftId: dto.sourceDraftId || dto.source_draft_id,
    sourceDraftVersion: dto.sourceDraftVersion || dto.source_draft_version || 0,
    targetDraftId: dto.targetDraftId || dto.target_draft_id,
    targetDraftVersion: dto.targetDraftVersion || dto.target_draft_version,
    sourceContentHash: dto.sourceContentHash || dto.source_content_hash,
    targetContentHash: dto.targetContentHash || dto.target_content_hash,
    beforeReportId: dto.beforeReportId || dto.before_report_id,
    afterReportId: dto.afterReportId || dto.after_report_id,
    beforeScore: dto.beforeScore ?? dto.before_score,
    afterScore: dto.afterScore ?? dto.after_score,
    beforePendingCount: dto.beforePendingCount ?? dto.before_pending_count ?? 0,
    afterPendingCount: dto.afterPendingCount ?? dto.after_pending_count,
    beforeSeriousCount: dto.beforeSeriousCount ?? dto.before_serious_count ?? 0,
    afterSeriousCount: dto.afterSeriousCount ?? dto.after_serious_count,
    fixedIssueIds: safeParseArray(dto.fixedIssueIds || dto.fixed_issue_ids),
    newIssueIds: safeParseArray(dto.newIssueIds || dto.new_issue_ids),
    mode: dto.mode || 'conservative',
    status: dto.status || 'pending',
    model: dto.model,
    revisionSummary: dto.revisionSummary || dto.revision_summary,
    changedRangesJson: dto.changedRangesJson || dto.changed_ranges_json,
    failureReason: dto.failureReason || dto.failure_reason,
    createdAt: dto.createdAt || dto.created_at,
    updatedAt: dto.updatedAt || dto.updated_at,
    usedContextIds: dto.usedContextIds || dto.used_context_ids,
    skippedContextIds: dto.skippedContextIds || dto.skipped_context_ids,
    warnings: dto.warnings,
  } as QualityFixRun & { usedContextIds?: string; skippedContextIds?: string; warnings?: string };
}

function safeParseArray(v: any): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
  return [];
}

