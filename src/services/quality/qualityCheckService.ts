/**
 * AI Novel Studio - 质量检查服务（localStorage）
 */
import { lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { QualityCheckReport, QualityCheckItem, CreateQualityReportInput, SaveQualityCheckResultInput, QualityCheckStatus } from '../../types/qualityCheck';

const REPORTS_KEY = 'ai_novel_studio_quality_reports';
const ITEMS_KEY = 'ai_novel_studio_quality_items';

function getReports(): QualityCheckReport[] { return lsGet<QualityCheckReport[]>(REPORTS_KEY) ?? []; }
function saveReports(v: QualityCheckReport[]): void { lsSet(REPORTS_KEY, v); }
function getItems(): QualityCheckItem[] { return lsGet<QualityCheckItem[]>(ITEMS_KEY) ?? []; }
function saveItems(v: QualityCheckItem[]): void { lsSet(ITEMS_KEY, v); }

export const qualityCheckService = {
  async getReportsByChapterId(chapterId: string): Promise<QualityCheckReport[]> {
    return getReports().filter((r) => r.chapterId === chapterId);
  },
  async getReportById(id: string): Promise<QualityCheckReport | null> {
    return getReports().find((r) => r.id === id) ?? null;
  },
  async getItemsByReportId(reportId: string): Promise<QualityCheckItem[]> {
    return getItems().filter((i) => i.reportId === reportId);
  },
  async getLatestReport(chapterId: string): Promise<QualityCheckReport | null> {
    return getReports().filter((r) => r.chapterId === chapterId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  },
  async createReport(input: CreateQualityReportInput): Promise<QualityCheckReport> {
    const list = getReports(); const now = nowISO();
    const r: QualityCheckReport = { ...input, id: generateId(), scope: 'current_draft', status: 'pending', createdAt: now, updatedAt: now };
    list.push(r); saveReports(list); return r;
  },
  async saveResult(input: SaveQualityCheckResultInput): Promise<{ report: QualityCheckReport; items: QualityCheckItem[] }> {
    const reports = getReports(); const rIdx = reports.findIndex((r) => r.id === input.reportId);
    if (rIdx === -1) throw new Error('报告不存在');
    reports[rIdx] = { ...reports[rIdx], status: 'completed', overallScore: input.result.overallScore, summary: input.result.summary, updatedAt: nowISO() };
    saveReports(reports);
    const now = nowISO();
    const items: QualityCheckItem[] = input.result.items.map((it) => ({
      ...it, id: generateId(), reportId: input.reportId, novelId: input.novelId,
      chapterId: input.chapterId, draftId: input.draftId,
      isResolved: false, createdAt: now, updatedAt: now,
    }));
    const allItems = getItems();
    allItems.push(...items); saveItems(allItems);
    return { report: reports[rIdx], items };
  },
  async setItemResolved(itemId: string, isResolved: boolean): Promise<QualityCheckItem | null> {
    const items = getItems(); const idx = items.findIndex((i) => i.id === itemId);
    if (idx === -1) return null;
    items[idx].isResolved = isResolved; items[idx].updatedAt = nowISO(); saveItems(items); return items[idx];
  },
  async deleteReport(reportId: string): Promise<void> {
    saveReports(getReports().filter((r) => r.id !== reportId));
    saveItems(getItems().filter((i) => i.reportId !== reportId));
  },
};
