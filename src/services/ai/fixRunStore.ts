/**
 * AI Novel Studio - 质量修稿记录持久化（Tauri SQLite + localStorage 回退）
 * v1.7.17: 升级为 Tauri SQLite 持久化
 */
import { lsGet, lsSet, nowISO, dbCall, getDbMode } from '../database/db';
import type { QualityFixRun } from '../ai/qualityFixService';

const KEY = 'ai_novel_studio_fix_runs';

interface QualityFixRunDto {
  id: string;
  novelId?: string;
  novel_id?: string;
  chapterId?: string;
  chapter_id?: string;
  sourceDraftId?: string;
  source_draft_id?: string;
  sourceDraftVersion?: number;
  source_draft_version?: number;
  targetDraftId?: string;
  target_draft_id?: string;
  targetDraftVersion?: number;
  target_draft_version?: number;
  sourceContentHash?: string;
  source_content_hash?: string;
  targetContentHash?: string;
  target_content_hash?: string;
  beforeReportId?: string;
  before_report_id?: string;
  afterReportId?: string;
  after_report_id?: string;
  beforeScore?: number;
  before_score?: number;
  afterScore?: number;
  after_score?: number;
  beforePendingCount?: number;
  before_pending_count?: number;
  afterPendingCount?: number;
  after_pending_count?: number;
  beforeSeriousCount?: number;
  before_serious_count?: number;
  afterSeriousCount?: number;
  after_serious_count?: number;
  fixedIssueIds?: unknown;
  fixed_issue_ids?: unknown;
  newIssueIds?: unknown;
  new_issue_ids?: unknown;
  mode?: QualityFixRun['mode'];
  status?: QualityFixRun['status'];
  model?: string;
  revisionSummary?: string;
  revision_summary?: string;
  changedRangesJson?: string;
  changed_ranges_json?: string;
  failureReason?: string;
  failure_reason?: string;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
  usedContextIds?: string;
  used_context_ids?: string;
  skippedContextIds?: string;
  skipped_context_ids?: string;
  warnings?: string;
}

function getAllLocal(): QualityFixRun[] {
  return lsGet<QualityFixRun[]>(KEY) ?? [];
}
function saveAllLocal(items: QualityFixRun[]): void {
  lsSet(KEY, items);
}

function toTauriInput(fixRun: QualityFixRun): Record<string, unknown> {
  return {
    id: fixRun.id,
    novelId: fixRun.novelId,
    chapterId: fixRun.chapterId,
    sourceDraftId: fixRun.sourceDraftId,
    sourceDraftVersion: fixRun.sourceDraftVersion,
    targetDraftId: fixRun.targetDraftId ?? null,
    targetDraftVersion: fixRun.targetDraftVersion ?? null,
    sourceContentHash: fixRun.sourceContentHash || null,
    targetContentHash: fixRun.targetContentHash || null,
    beforeReportId: fixRun.beforeReportId || null,
    afterReportId: fixRun.afterReportId || null,
    beforeScore: fixRun.beforeScore ?? null,
    afterScore: fixRun.afterScore ?? null,
    beforePendingCount: fixRun.beforePendingCount,
    afterPendingCount: fixRun.afterPendingCount ?? null,
    beforeSeriousCount: fixRun.beforeSeriousCount,
    afterSeriousCount: fixRun.afterSeriousCount ?? null,
    fixedIssueIds: fixRun.fixedIssueIds.length > 0 ? JSON.stringify(fixRun.fixedIssueIds) : null,
    newIssueIds: fixRun.newIssueIds.length > 0 ? JSON.stringify(fixRun.newIssueIds) : null,
    mode: fixRun.mode,
    status: fixRun.status,
    model: fixRun.model || null,
    revisionSummary: fixRun.revisionSummary || null,
    changedRangesJson: fixRun.changedRangesJson || null,
    usedContextIds: fixRun.usedContextIds || null,
    skippedContextIds: fixRun.skippedContextIds || null,
    warnings: fixRun.warnings || null,
    failureReason: fixRun.failureReason || null,
  };
}

export const fixRunStore = {
  async getByChapterId(chapterId: string): Promise<QualityFixRun[]> {
    const dtos = await dbCall<QualityFixRunDto[]>('get_quality_fix_runs', { chapterId }, () =>
      getAllLocal()
        .filter((run) => run.chapterId === chapterId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    );
    return dtos.map(fromTauriDto);
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
    await dbCall('save_quality_fix_run', { input: toTauriInput(r) }, () => undefined);
    if (getDbMode() !== 'tauri') {
      const list = getAllLocal();
      const idx = list.findIndex((x) => x.id === r.id);
      if (idx >= 0) {
        list[idx] = r;
      } else {
        if (
          list.some(
            (existing) =>
              existing.chapterId === r.chapterId && existing.sourceDraftId === r.sourceDraftId,
          )
        ) {
          throw new Error('quality_fix_round_already_used');
        }
        list.push(r);
      }
      saveAllLocal(list);
    }
    return r;
  },

  async updateStatus(id: string, status: QualityFixRun['status']): Promise<QualityFixRun | null> {
    await dbCall('update_quality_fix_run_status', { id, status }, () => undefined);
    if (getDbMode() === 'tauri') return null;
    const list = getAllLocal();
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    list[idx].status = status;
    list[idx].updatedAt = nowISO();
    saveAllLocal(list);
    return list[idx];
  },
};

function readRequiredString(primary: unknown, legacy: unknown, fieldName: string): string {
  const value = primary || legacy;
  if (typeof value !== 'string') {
    throw new Error(`Invalid quality fix run field: ${fieldName}`);
  }
  return value;
}

function readRequiredNumber(primary: unknown, legacy: unknown, fieldName: string): number {
  const value = primary ?? legacy;
  if (typeof value !== 'number') {
    throw new Error(`Invalid quality fix run field: ${fieldName}`);
  }
  return value;
}

function fromTauriDto(dto: QualityFixRunDto): QualityFixRun {
  return {
    id: dto.id,
    novelId: readRequiredString(dto.novelId, dto.novel_id, 'novelId'),
    chapterId: readRequiredString(dto.chapterId, dto.chapter_id, 'chapterId'),
    sourceDraftId: readRequiredString(dto.sourceDraftId, dto.source_draft_id, 'sourceDraftId'),
    sourceDraftVersion: dto.sourceDraftVersion || dto.source_draft_version || 0,
    targetDraftId: dto.targetDraftId || dto.target_draft_id,
    targetDraftVersion: dto.targetDraftVersion || dto.target_draft_version,
    sourceContentHash: readRequiredString(
      dto.sourceContentHash,
      dto.source_content_hash,
      'sourceContentHash',
    ),
    targetContentHash: dto.targetContentHash || dto.target_content_hash,
    beforeReportId: readRequiredString(dto.beforeReportId, dto.before_report_id, 'beforeReportId'),
    afterReportId: dto.afterReportId || dto.after_report_id,
    beforeScore: readRequiredNumber(dto.beforeScore, dto.before_score, 'beforeScore'),
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
    createdAt: readRequiredString(dto.createdAt, dto.created_at, 'createdAt'),
    updatedAt: readRequiredString(dto.updatedAt, dto.updated_at, 'updatedAt'),
    usedContextIds: dto.usedContextIds || dto.used_context_ids,
    skippedContextIds: dto.skippedContextIds || dto.skipped_context_ids,
    warnings: dto.warnings,
  };
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function safeParseArray(v: unknown): string[] {
  if (isStringArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v);
      return isStringArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}
