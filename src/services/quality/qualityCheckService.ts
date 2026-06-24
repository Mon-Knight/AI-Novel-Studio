/**
 * AI Novel Studio - 质量检查服务（Tauri SQLite + localStorage 回退）
 * v1.7.12: 引入问题处理闭环，使用 Tauri 后端持久化
 */
import { lsGet, lsSet, generateId, nowISO, dbCall } from '../database/db';
import type {
  QualityCheckReport, QualityCheckItem, QualityIssueStatus,
  CreateQualityReportInput, SaveQualityCheckResultInput,
  GetQualityCheckIssuesResult, QualityCheckStatistics,
} from '../../types/qualityCheck';

const REPORTS_KEY = 'ai_novel_studio_quality_reports';
const ITEMS_KEY = 'ai_novel_studio_quality_items';

// ==================== localStorage 回退实现 ====================

function getReports(): QualityCheckReport[] { return lsGet<QualityCheckReport[]>(REPORTS_KEY) ?? []; }
function saveReports(v: QualityCheckReport[]): void { lsSet(REPORTS_KEY, v); }
function getItems(): QualityCheckItem[] { return lsGet<QualityCheckItem[]>(ITEMS_KEY) ?? []; }
function saveItems(v: QualityCheckItem[]): void { lsSet(ITEMS_KEY, v); }

/**
 * 生成问题稳定标识键
 * issue_key = simpleHash(chapter_id + category + title + quote + normalized_description)
 */
export function generateIssueKey(
  chapterId: string,
  category: string,
  title: string,
  quote: string,
  description: string,
): string {
  const normalized = [
    chapterId,
    category || '',
    title || '',
    (quote || '').slice(0, 200),
    (description || '').replace(/\s+/g, ' ').trim().slice(0, 200),
  ].join('|||');
  return simpleHash(normalized);
}

/** 简单的字符串哈希（djb2 变体） */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return 'qc_' + (hash >>> 0).toString(16).padStart(8, '0');
}

// ==================== 统一服务接口 ====================

export const qualityCheckService = {
  /** 获取章节的最新检查结果（报告 + 问题 + 统计） */
  async getChapterIssues(chapterId: string): Promise<GetQualityCheckIssuesResult> {
    try {
      return await dbCall<GetQualityCheckIssuesResult>('get_quality_check_issues', { chapterId });
    } catch {
      // localStorage 回退
      const report = (getReports()
        .filter((r) => r.chapterId === chapterId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]) ?? null;
      const items = report ? getItems().filter((i) => i.reportId === report.id) : [];
      return { report, items, statistics: computeStatistics(items) };
    }
  },

  async getReportById(id: string): Promise<QualityCheckReport | null> {
    try {
      const result = await this.getChapterIssues('');
      return result.report?.id === id ? result.report : getReports().find((r) => r.id === id) ?? null;
    } catch {
      return getReports().find((r) => r.id === id) ?? null;
    }
  },

  async getItemsByReportId(reportId: string): Promise<QualityCheckItem[]> {
    const allItems = getItems();
    return allItems.filter((i) => i.reportId === reportId);
  },

  async getLatestReport(chapterId: string): Promise<QualityCheckReport | null> {
    const { report } = await this.getChapterIssues(chapterId);
    return report;
  },

  async createReport(input: CreateQualityReportInput): Promise<QualityCheckReport> {
    const now = nowISO();
    const r: QualityCheckReport = {
      ...input, id: generateId(), scope: 'current_draft', status: 'pending',
      createdAt: now, updatedAt: now,
    };
    const list = getReports();
    list.push(r);
    saveReports(list);
    return r;
  },

  /** 保存 AI 检查结果（合并问题） */
  async saveResult(input: SaveQualityCheckResultInput): Promise<GetQualityCheckIssuesResult> {
    // 为每个问题生成 issue_key
    const itemsWithKeys = input.result.items.map((it) => ({
      ...it,
      issueKey: generateIssueKey(
        input.chapterId,
        it.category || it.issueType || 'other',
        it.title,
        it.quote || it.evidence || '',
        it.description,
      ),
    }));

    const payload = {
      reportId: input.reportId,
      novelId: input.novelId,
      chapterId: input.chapterId,
      draftId: input.draftId,
      result: { ...input.result, items: itemsWithKeys },
      draftVersion: input.draftVersion,
      model: input.model,
    };

    try {
      return await dbCall<GetQualityCheckIssuesResult>('save_quality_check_result', payload);
    } catch {
      // localStorage 回退
      const reports = getReports();
      const rIdx = reports.findIndex((r) => r.id === input.reportId);
      if (rIdx === -1) throw new Error('报告不存在');
      reports[rIdx] = {
        ...reports[rIdx], status: 'completed',
        overallScore: input.result.overallScore,
        summary: input.result.summary,
        draftVersion: input.draftVersion,
        model: input.model,
        updatedAt: nowISO(),
      };
      saveReports(reports);

      const now = nowISO();
      const newItems: QualityCheckItem[] = itemsWithKeys.map((it) => ({
        ...it,
        id: generateId(),
        reportId: input.reportId,
        novelId: input.novelId,
        chapterId: input.chapterId,
        draftId: input.draftId,
        issueType: (it.issueType || 'other') as QualityCheckItem['issueType'],
        severity: (it.severity || 'medium') as QualityCheckItem['severity'],
        issueKey: it.issueKey || generateId(),
        status: 'pending' as QualityIssueStatus,
        createdAt: now,
        updatedAt: now,
      }));

      // 合并历史问题
      const oldItems = getItems().filter((i) => i.chapterId === input.chapterId);
      const mergedItems: QualityCheckItem[] = [];
      const usedKeys = new Set<string>();

      for (const ni of newItems) {
        const old = oldItems.find((o) => o.issueKey === ni.issueKey);
        if (old) {
          usedKeys.add(old.id);
          const keepStatus: QualityIssueStatus =
            old.status === 'ignored' ? 'ignored' :
            old.status === 'resolved' ? 'pending' : 'pending';
          mergedItems.push({ ...ni, id: old.id, status: keepStatus, updatedAt: now });
        } else {
          mergedItems.push(ni);
        }
      }

      // 保留未被匹配的旧问题（已处理/已忽略）
      for (const oi of oldItems) {
        if (!usedKeys.has(oi.id) && (oi.status === 'resolved' || oi.status === 'ignored')) {
          mergedItems.push(oi);
        }
      }

      const allItems = getItems().filter((i) => i.chapterId !== input.chapterId);
      allItems.push(...mergedItems);
      saveItems(allItems);

      return {
        report: reports[rIdx],
        items: mergedItems,
        statistics: computeStatistics(mergedItems),
      };
    }
  },

  /** 更新单条问题状态 */
  async updateIssueStatus(
    issueId: string,
    status: QualityIssueStatus,
    resolutionNote?: string,
  ): Promise<QualityCheckItem | null> {
    try {
      return await dbCall<QualityCheckItem>('update_quality_issue_status', {
        issueId, status, resolutionNote: resolutionNote || null,
      });
    } catch {
      const items = getItems();
      const idx = items.findIndex((i) => i.id === issueId);
      if (idx === -1) return null;
      items[idx].status = status;
      items[idx].resolutionNote = resolutionNote;
      items[idx].resolvedAt = status === 'resolved' ? nowISO() : undefined;
      items[idx].updatedAt = nowISO();
      saveItems(items);
      return items[idx];
    }
  },

  /** 批量更新问题状态 */
  async batchUpdateIssueStatus(
    issueIds: string[],
    status: QualityIssueStatus,
  ): Promise<QualityCheckItem[]> {
    try {
      return await dbCall<QualityCheckItem[]>('batch_update_quality_issue_status', {
        issueIds, status,
      });
    } catch {
      const items = getItems();
      const now = nowISO();
      const updated: QualityCheckItem[] = [];
      for (const id of issueIds) {
        const idx = items.findIndex((i) => i.id === id);
        if (idx !== -1) {
          items[idx].status = status;
          items[idx].resolvedAt = status === 'resolved' ? now : undefined;
          items[idx].updatedAt = now;
          updated.push(items[idx]);
        }
      }
      saveItems(items);
      return updated;
    }
  },

  /** 删除报告及关联问题 */
  async deleteReport(reportId: string): Promise<void> {
    saveReports(getReports().filter((r) => r.id !== reportId));
    saveItems(getItems().filter((i) => i.reportId !== reportId));
  },
};

/** 计算统计信息 */
export function computeStatistics(items: QualityCheckItem[]): QualityCheckStatistics {
  return {
    total: items.length,
    pending: items.filter((i) => i.status === 'pending').length,
    resolved: items.filter((i) => i.status === 'resolved').length,
    ignored: items.filter((i) => i.status === 'ignored').length,
    critical: items.filter((i) => i.severity === 'critical').length,
    high: items.filter((i) => i.severity === 'high').length,
    medium: items.filter((i) => i.severity === 'medium').length,
    low: items.filter((i) => i.severity === 'low').length,
  };
}

