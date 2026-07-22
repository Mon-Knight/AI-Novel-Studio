/**
 * AI Novel Studio - 质量检查服务（Tauri SQLite + localStorage 回退）
 * v1.7.12: 引入问题处理闭环，使用 Tauri 后端持久化
 */
import { lsGet, lsSet, generateId, nowISO, dbCall, getDbMode } from '../database/db';
import type {
  QualityCheckReport, QualityCheckItem, QualityIssueState, QualityIssueStatus,
  CreateQualityReportInput, SaveQualityCheckResultInput,
  GetQualityCheckIssuesResult, QualityCheckStatistics,
} from '../../types/qualityCheck';

const REPORTS_KEY = 'ai_novel_studio_quality_reports';
const ITEMS_KEY = 'ai_novel_studio_quality_items';
const STATES_KEY = 'ai_novel_studio_quality_issue_states';

// ==================== localStorage 回退实现 ====================

function getReports(): QualityCheckReport[] { return lsGet<QualityCheckReport[]>(REPORTS_KEY) ?? []; }
function saveReports(v: QualityCheckReport[]): void { lsSet(REPORTS_KEY, v); }
function getItems(): QualityCheckItem[] { return lsGet<QualityCheckItem[]>(ITEMS_KEY) ?? []; }
function saveItems(v: QualityCheckItem[]): void { lsSet(ITEMS_KEY, v); }
function saveStates(v: QualityIssueState[]): void { lsSet(STATES_KEY, v); }

function compareReportsNewestFirst(a: QualityCheckReport, b: QualityCheckReport): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
}

function isReportNewer(a: QualityCheckReport, b: QualityCheckReport): boolean {
  return a.createdAt > b.createdAt || (a.createdAt === b.createdAt && a.id > b.id);
}

function compareSnapshotItems(a: QualityCheckItem, b: QualityCheckItem): number {
  return (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER)
    || a.createdAt.localeCompare(b.createdAt)
    || a.id.localeCompare(b.id);
}

function getCompletedReports(chapterId: string): QualityCheckReport[] {
  return getReports()
    .filter((report) => report.chapterId === chapterId && report.status === 'completed')
    .sort(compareReportsNewestFirst);
}

function stateIdentity(chapterId: string, issueKey: string): string {
  return `${chapterId}\u0000${issueKey}`;
}

function synthesizeLegacyStates(): QualityIssueState[] {
  const states = new Map<string, QualityIssueState>();
  const legacyItems = getItems()
    .map((item, storageIndex) => ({ item, storageIndex }))
    .sort((left, right) => (
      right.item.updatedAt.localeCompare(left.item.updatedAt)
      || right.storageIndex - left.storageIndex
    ));
  for (const { item } of legacyItems) {
    const key = stateIdentity(item.chapterId, item.issueKey);
    if (states.has(key)) continue;
    states.set(key, {
      id: generateId(),
      chapterId: item.chapterId,
      issueKey: item.issueKey,
      status: item.status,
      resolutionNote: item.resolutionNote,
      resolvedAt: item.resolvedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });
  }
  return [...states.values()];
}

function getStates(): QualityIssueState[] {
  return lsGet<QualityIssueState[]>(STATES_KEY) ?? synthesizeLegacyStates();
}

function overlayWorkflowState(
  items: QualityCheckItem[],
  states: QualityIssueState[] = getStates(),
): QualityCheckItem[] {
  const byKey = new Map(states.map((state) => [stateIdentity(state.chapterId, state.issueKey), state]));
  return items.map((item) => {
    const state = byKey.get(stateIdentity(item.chapterId, item.issueKey));
    if (!state) return item;
    const current = { ...item, status: state.status, updatedAt: state.updatedAt };
    if (state.resolutionNote === undefined) delete current.resolutionNote;
    else current.resolutionNote = state.resolutionNote;
    if (state.resolvedAt === undefined) delete current.resolvedAt;
    else current.resolvedAt = state.resolvedAt;
    return current;
  });
}

function getLocalSnapshot(reportId: string): GetQualityCheckIssuesResult {
  const report = getReports().find((item) => item.id === reportId) ?? null;
  const items = getItems()
    .filter((item) => item.reportId === reportId)
    .sort(compareSnapshotItems);
  return { report, items, statistics: computeStatistics(items) };
}

function getLocalWorkflowStateByKey(chapterId: string): Map<string, QualityIssueState> {
  return new Map(
    getStates()
      .filter((state) => state.chapterId === chapterId)
      .map((state) => [state.issueKey, state]),
  );
}

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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isMissingReportError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return message.includes('报告不存在') || message.includes('quality_check_report_missing');
}

// ==================== 统一服务接口 ====================

export const qualityCheckService = {
  /** 获取章节的最新检查结果（报告 + 问题 + 统计） */
  async getChapterIssues(chapterId: string): Promise<GetQualityCheckIssuesResult> {
    try {
      return await dbCall<GetQualityCheckIssuesResult>('get_quality_check_issues', { chapterId });
    } catch (error) {
      if (getDbMode() === 'tauri') throw error;
      // localStorage 回退
      const report = getCompletedReports(chapterId)[0] ?? null;
      const snapshotItems = report ? getLocalSnapshot(report.id).items : [];
      const items = overlayWorkflowState(snapshotItems);
      return { report, items, statistics: computeStatistics(items) };
    }
  },

  /** List completed reports in deterministic newest-first order. */
  async listReports(chapterId: string): Promise<QualityCheckReport[]> {
    try {
      return await dbCall<QualityCheckReport[]>('list_quality_check_reports', { chapterId });
    } catch (error) {
      if (getDbMode() === 'tauri') throw error;
      return getCompletedReports(chapterId);
    }
  },

  /** Replay one immutable report snapshot without applying current issue state. */
  async getReportSnapshot(reportId: string): Promise<GetQualityCheckIssuesResult> {
    try {
      return await dbCall<GetQualityCheckIssuesResult>('get_quality_check_report_snapshot', { reportId });
    } catch (error) {
      if (getDbMode() === 'tauri') throw error;
      return getLocalSnapshot(reportId);
    }
  },

  async getReportById(id: string): Promise<QualityCheckReport | null> {
    return (await this.getReportSnapshot(id)).report;
  },

  async getItemsByReportId(reportId: string): Promise<QualityCheckItem[]> {
    return (await this.getReportSnapshot(reportId)).items;
  },

  async getLatestReport(chapterId: string): Promise<QualityCheckReport | null> {
    const { report } = await this.getChapterIssues(chapterId);
    return report;
  },

  async createReport(input: CreateQualityReportInput): Promise<QualityCheckReport> {
    const now = nowISO();
    const localReport: QualityCheckReport = {
      ...input, id: generateId(), scope: input.scope || 'current_draft', status: 'pending',
      createdAt: now, updatedAt: now,
    };
    return await dbCall<QualityCheckReport>(
      'create_quality_check_report',
      { input },
      () => {
        const list = getReports();
        list.push(localReport);
        saveReports(list);
        return localReport;
      },
    );
  },

  /** 保存 AI 检查结果（合并问题） */
  async saveResult(input: SaveQualityCheckResultInput): Promise<GetQualityCheckIssuesResult> {
    const aiTaskId = input.aiTaskId.trim();
    if (!aiTaskId) throw new Error('quality_check_ai_task_required');
    if (input.result.aiTaskId && input.result.aiTaskId !== aiTaskId) {
      throw new Error('quality_check_ai_task_mismatch');
    }
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
      contentHash: input.contentHash,
      contentLength: input.contentLength,
      checkedAt: input.checkedAt,
      aiTaskId,
    };

    const saveToDatabase = (nextPayload: typeof payload) =>
      dbCall<GetQualityCheckIssuesResult>('save_quality_check_result', { input: nextPayload });

    try {
      return await saveToDatabase(payload);
    } catch (error) {
      if (getDbMode() === 'tauri') {
        if (isMissingReportError(error)) {
          console.warn('[QualityCheck] report placeholder missing, recreating before retry', {
            reportId: input.reportId,
            novelId: input.novelId,
            chapterId: input.chapterId,
            draftId: input.draftId,
            error,
          });
          const recreated = await qualityCheckService.createReport({
            novelId: input.novelId,
            chapterId: input.chapterId,
            draftId: input.draftId,
            contentHash: input.contentHash,
            contentLength: input.contentLength,
            checkedAt: input.checkedAt,
          });
          return await saveToDatabase({ ...payload, reportId: recreated.id });
        }
        throw error;
      }
      // localStorage 回退
      const reports = getReports();
      const rIdx = reports.findIndex((r) => r.id === input.reportId);
      if (rIdx === -1) throw new Error('报告不存在');
      const existingReport = reports[rIdx];
      if (existingReport.novelId !== input.novelId
        || existingReport.chapterId !== input.chapterId
        || existingReport.draftId !== input.draftId) {
        throw new Error('quality_check_report_target_mismatch');
      }
      if (existingReport.status === 'completed') {
        if (existingReport.aiTaskId !== aiTaskId) {
          throw new Error('quality_check_report_ai_task_mismatch');
        }
        const snapshot = getLocalSnapshot(existingReport.id);
        const hasNewerCompletedReport = getCompletedReports(existingReport.chapterId)
          .some((completedReport) => isReportNewer(completedReport, existingReport));
        if (hasNewerCompletedReport) return snapshot;
        const items = overlayWorkflowState(snapshot.items);
        return { ...snapshot, items, statistics: computeStatistics(items) };
      }

      const duplicateKeys = new Set<string>();
      for (const item of itemsWithKeys) {
        if (duplicateKeys.has(item.issueKey)) throw new Error(`quality_check_duplicate_issue_key: ${item.issueKey}`);
        duplicateKeys.add(item.issueKey);
      }

      const nextReport: QualityCheckReport = {
        ...existingReport, status: 'completed',
        overallScore: input.result.overallScore,
        summary: input.result.summary,
        draftVersion: input.draftVersion,
        model: input.model,
        aiTaskId,
        contentHash: input.contentHash ?? existingReport.contentHash,
        contentLength: input.contentLength ?? existingReport.contentLength,
        checkedAt: input.checkedAt ?? nowISO(),
        updatedAt: nowISO(),
      };

      const now = nowISO();
      const latestByKey = getLocalWorkflowStateByKey(input.chapterId);
      const updatesWorkflowState = !getCompletedReports(input.chapterId)
        .some((completedReport) => isReportNewer(completedReport, existingReport));
      const newItems: QualityCheckItem[] = itemsWithKeys.map((it, sortOrder) => ({
        ...it,
        id: generateId(),
        reportId: input.reportId,
        novelId: input.novelId,
        chapterId: input.chapterId,
        draftId: input.draftId,
        issueType: (it.issueType || 'other') as QualityCheckItem['issueType'],
        severity: (it.severity || 'medium') as QualityCheckItem['severity'],
        issueKey: it.issueKey || generateId(),
        sortOrder,
        status: 'pending' as QualityIssueStatus,
        createdAt: now,
        updatedAt: now,
      }));

      const nextStates = getStates();
      if (updatesWorkflowState) {
        for (const item of newItems) {
          const existingState = latestByKey.get(item.issueKey);
          const nextState: QualityIssueState = {
            id: existingState?.id ?? generateId(),
            chapterId: item.chapterId,
            issueKey: item.issueKey,
            status: existingState?.status === 'ignored' ? 'ignored' : 'pending',
            resolutionNote: existingState?.status === 'ignored' ? existingState.resolutionNote : undefined,
            resolvedAt: existingState?.status === 'ignored' ? existingState.resolvedAt : undefined,
            createdAt: existingState?.createdAt ?? now,
            updatedAt: now,
          };
          const stateIndex = nextStates.findIndex((state) => (
            state.chapterId === nextState.chapterId && state.issueKey === nextState.issueKey
          ));
          if (stateIndex === -1) nextStates.push(nextState);
          else nextStates[stateIndex] = nextState;
        }
      }

      // Write items first. If localStorage quota fails, the report remains pending and
      // cannot hide the last complete snapshot.
      saveItems([...getItems(), ...newItems]);
      if (updatesWorkflowState) saveStates(nextStates);
      reports[rIdx] = nextReport;
      saveReports(reports);

      const returnedItems = updatesWorkflowState ? overlayWorkflowState(newItems, nextStates) : newItems;
      return {
        report: nextReport,
        items: returnedItems,
        statistics: computeStatistics(returnedItems),
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
    } catch (error) {
      if (getDbMode() === 'tauri') throw error;
      const items = getItems();
      const idx = items.findIndex((i) => i.id === issueId);
      if (idx === -1) return null;
      const latestReportId = getCompletedReports(items[idx].chapterId)[0]?.id;
      if (items[idx].reportId !== latestReportId) {
        throw new Error('quality_issue_history_read_only');
      }
      const states = getStates();
      const now = nowISO();
      const stateIndex = states.findIndex((state) => (
        state.chapterId === items[idx].chapterId && state.issueKey === items[idx].issueKey
      ));
      const existingState = stateIndex === -1 ? undefined : states[stateIndex];
      const nextState: QualityIssueState = {
        id: existingState?.id ?? generateId(),
        chapterId: items[idx].chapterId,
        issueKey: items[idx].issueKey,
        status,
        resolutionNote,
        resolvedAt: status === 'resolved' ? now : undefined,
        createdAt: existingState?.createdAt ?? now,
        updatedAt: now,
      };
      if (stateIndex === -1) states.push(nextState);
      else states[stateIndex] = nextState;
      saveStates(states);
      return overlayWorkflowState([items[idx]], states)[0];
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
    } catch (error) {
      if (getDbMode() === 'tauri') throw error;
      const items = getItems();
      const now = nowISO();
      for (const id of issueIds) {
        const item = items.find((candidate) => candidate.id === id);
        if (!item) continue;
        const latestReportId = getCompletedReports(item.chapterId)[0]?.id;
        if (item.reportId !== latestReportId) throw new Error('quality_issue_history_read_only');
      }
      const states = getStates();
      const updated: QualityCheckItem[] = [];
      for (const id of issueIds) {
        const item = items.find((candidate) => candidate.id === id);
        if (!item) continue;
        const stateIndex = states.findIndex((state) => (
          state.chapterId === item.chapterId && state.issueKey === item.issueKey
        ));
        const existingState = stateIndex === -1 ? undefined : states[stateIndex];
        const nextState: QualityIssueState = {
          id: existingState?.id ?? generateId(),
          chapterId: item.chapterId,
          issueKey: item.issueKey,
          status,
          resolutionNote: undefined,
          resolvedAt: status === 'resolved' ? now : undefined,
          createdAt: existingState?.createdAt ?? now,
          updatedAt: now,
        };
        if (stateIndex === -1) states.push(nextState);
        else states[stateIndex] = nextState;
        updated.push(overlayWorkflowState([item], [nextState])[0]);
      }
      saveStates(states);
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

