import { useCallback, useEffect, useMemo, useState } from 'react';
import { appLogger } from '../../services/observability/appLogger';
import { aiTaskService } from '../../services/ai/aiTaskService';
import type { AiTaskRecord, AiTaskStatus, AiTaskType } from '../../types/ai';
import { AiTaskTypeLabels } from '../../types/ai';
import { confirmDanger } from '../../utils/nativeDialog';
import { describeUnknownError } from '../../utils/errorMessage';
import AiTasksPageView from './AiTasksPageView';
import { TASK_PAGE_SIZE, type ActiveExecutionState } from './aiTasksPresentation';

function AiTasksPage() {
  const [tasks, setTasks] = useState<AiTaskRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [typeFilter, setTypeFilter] = useState<AiTaskType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<AiTaskStatus | 'all'>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [executionRevision, setExecutionRevision] = useState(0);
  const [page, setPage] = useState(1);

  const showMessage = useCallback((text: string, durationMs = 3000) => {
    setMsg(text);
    window.setTimeout(() => setMsg(''), durationMs);
  }, []);

  const loadTasks = useCallback(
    async (requestedPage = 1) => {
      appLogger.debug('[AI_TASK_DELETE_UI] reload tasks start');
      const result = await aiTaskService.getAll(requestedPage, TASK_PAGE_SIZE, {
        taskType: typeFilter === 'all' ? undefined : typeFilter,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });
      setTasks(result.items);
      setTotal(result.total);
      appLogger.debug('[AI_TASK_DELETE_UI] reload tasks done', {
        itemCount: result.items.length,
        total: result.total,
      });
      return result.items;
    },
    [statusFilter, typeFilter],
  );

  useEffect(() => {
    void loadTasks(page).catch((error) => {
      appLogger.captureError('AI_TASK_PAGE_LOAD_FAILED', error, { page, typeFilter, statusFilter });
      showMessage('任务记录加载失败，请重试。');
    });
  }, [loadTasks, page, showMessage, statusFilter, typeFilter]);

  useEffect(() => {
    if (!tasks.some((task) => task.status === 'running' || task.status === 'pending')) return;
    const timer = window.setInterval(() => {
      setExecutionRevision((value) => value + 1);
      void loadTasks(page);
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [tasks, loadTasks, page]);

  const executionStates = useMemo(() => {
    void executionRevision;
    return new Map<string, ActiveExecutionState>(
      tasks.map((task) => [task.id, aiTaskService.getActiveExecutionState(task.id)]),
    );
  }, [executionRevision, tasks]);

  const { visibleCost, totalPages, visiblePage, pagedTasks } = useMemo(() => {
    const nextTotalPages = Math.max(1, Math.ceil(total / TASK_PAGE_SIZE));
    return {
      visibleCost: tasks.reduce(
        (sum, task) => sum + (task.costStatus === 'complete' ? (task.costEstimate ?? 0) : 0),
        0,
      ),
      totalPages: nextTotalPages,
      visiblePage: Math.min(page, nextTotalPages),
      pagedTasks: tasks,
    };
  }, [page, tasks, total]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [typeFilter, statusFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handleStopTask = (task: AiTaskRecord) => {
    const outcome = aiTaskService.cancelActiveExecution(task.id);
    setExecutionRevision((value) => value + 1);
    showMessage(
      outcome === 'requested'
        ? '已发送停止请求，正在等待传输和任务终态确认。'
        : outcome === 'already_requested'
          ? '该任务正在停止。'
          : '当前进程没有该任务的运行句柄；它可能来自上次应用会话。',
    );
  };

  const handleDeleteOne = async (task: AiTaskRecord) => {
    if (
      !(await confirmDanger({
        title: '删除任务记录',
        message: `确定删除这条「${AiTaskTypeLabels[task.taskType]}」记录吗？`,
      }))
    )
      return;
    try {
      const result = await aiTaskService.deleteOne(task.id);
      appLogger.debug('[AI_TASK_DELETE_UI] delete one result', result);
      if (result.deletedCount === 0) return showMessage('未删除任何记录，请检查记录ID或数据库连接');
      const reloaded = await loadTasks(page);
      if (reloaded.some((item) => item.id === task.id)) {
        appLogger.error('[AI_TASK_DELETE_VERIFY_FAILED] deleted ids still visible', [task.id]);
        return showMessage('删除后仍检测到记录，请检查数据源');
      }
      setSelectedIds((previous) => {
        const next = new Set(previous);
        next.delete(task.id);
        return next;
      });
      setExpandedId((previous) => (previous === task.id ? null : previous));
      showMessage(`已删除 ${result.deletedCount} 条记录`, 2000);
    } catch (error: unknown) {
      appLogger.error('[AI_TASK_DELETE_UI] delete one failed full error', {
        errorMessage: describeUnknownError(error),
        error,
      });
      showMessage('删除失败：' + describeUnknownError(error), 8000);
    }
  };

  const deleteMany = async (ids: string[], successMessage: (count: number) => string) => {
    if (ids.length === 0) return showMessage('请先选择要删除的记录', 2000);
    appLogger.debug('[AI_TASK_DELETE_UI] delete selected clicked', {
      selectedIds: ids,
      selectedCount: ids.length,
    });
    setDeleting(true);
    try {
      const result = await aiTaskService.deleteMany(ids);
      appLogger.debug('[AI_TASK_DELETE_UI] deleteMany result', result);
      if (result.deletedCount === 0) return showMessage('未删除任何记录，请检查记录ID或数据库连接');
      const reloaded = await loadTasks(page);
      const stillVisibleIds = reloaded
        .filter((item) => ids.includes(item.id))
        .map((item) => item.id);
      if (stillVisibleIds.length > 0) {
        appLogger.error(
          '[AI_TASK_DELETE_VERIFY_FAILED] deleted ids still visible',
          stillVisibleIds,
        );
        return showMessage('删除后仍检测到记录，请检查数据源');
      }
      setSelectedIds(new Set());
      setSelectMode(false);
      showMessage(successMessage(result.deletedCount));
    } catch (error: unknown) {
      appLogger.error('[AI_TASK_DELETE_UI] delete selected failed full error', {
        errorMessage: describeUnknownError(error),
        error,
      });
      showMessage('删除失败：' + describeUnknownError(error), 8000);
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteSelected = async () => {
    const ids = [...selectedIds];
    if (
      !(await confirmDanger({
        title: '批量删除',
        message: `确定删除选中的 ${ids.length} 条 AI 任务记录吗？`,
      }))
    )
      return;
    await deleteMany(ids, (count) => `已删除 ${count} 条记录`);
  };

  const handleDeleteFiltered = async () => {
    if (
      !(await confirmDanger({
        title: '删除当前页记录',
        message: `确定删除当前页显示的 ${tasks.length} 条记录吗？`,
      }))
    )
      return;
    await deleteMany(
      tasks.map((task) => task.id),
      (count) => `已删除当前页 ${count} 条记录`,
    );
  };

  const handleClearAll = async () => {
    if (
      !(await confirmDanger({
        title: '清空全部记录',
        message:
          '确定清空所有 AI 任务记录吗？\n\n这只会删除 AI 调用历史，不会删除作品、章节、草稿、大纲、角色或设定。\n\n此操作无法恢复。',
      }))
    )
      return;
    const beforeCount = total;
    appLogger.debug('[AI_TASK_DELETE_UI] clear all clicked', { beforeCount });
    setDeleting(true);
    try {
      const result = await aiTaskService.clearAll();
      appLogger.debug('[AI_TASK_DELETE_UI] clearAll result', result);
      if (beforeCount > 0 && result.deletedCount === 0)
        return showMessage('清空失败：数据库未删除任何记录');
      const reloaded = await loadTasks(1);
      if (reloaded.length > 0) {
        appLogger.error('[AI_TASK_DELETE_VERIFY_FAILED] clear all still visible', {
          itemCount: reloaded.length,
          ids: reloaded.map((item) => item.id).slice(0, 20),
        });
        return showMessage('清空后仍检测到记录，请检查数据源');
      }
      setSelectedIds(new Set());
      setSelectMode(false);
      showMessage(`清理完成，已删除 ${result.deletedCount} 条记录`);
    } catch (error: unknown) {
      appLogger.error('[AI_TASK_DELETE_UI] clear all failed full error', {
        errorMessage: describeUnknownError(error),
        error,
      });
      showMessage('清空失败：' + describeUnknownError(error), 8000);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AiTasksPageView
      tasks={tasks}
      total={total}
      typeFilter={typeFilter}
      statusFilter={statusFilter}
      expandedId={expandedId}
      msg={msg}
      selectedIds={selectedIds}
      selectMode={selectMode}
      deleting={deleting}
      visibleCost={visibleCost}
      totalPages={totalPages}
      visiblePage={visiblePage}
      pagedTasks={pagedTasks}
      executionStates={executionStates}
      onTypeFilterChange={setTypeFilter}
      onStatusFilterChange={setStatusFilter}
      onToggleSelectMode={() => {
        setSelectMode((value) => !value);
        setSelectedIds(new Set());
      }}
      onToggleSelectAll={() =>
        setSelectedIds(
          selectedIds.size === tasks.length ? new Set() : new Set(tasks.map((task) => task.id)),
        )
      }
      onDeleteSelected={handleDeleteSelected}
      onClearAll={handleClearAll}
      onDeleteFiltered={handleDeleteFiltered}
      onToggleSelect={(id) =>
        setSelectedIds((previous) => {
          const next = new Set(previous);
          next.has(id) ? next.delete(id) : next.add(id);
          return next;
        })
      }
      onToggleExpand={(id) => setExpandedId((previous) => (previous === id ? null : id))}
      onStopTask={handleStopTask}
      onDeleteOne={handleDeleteOne}
      onPreviousPage={() => setPage((value) => Math.max(1, value - 1))}
      onNextPage={() => setPage((value) => Math.min(totalPages, value + 1))}
    />
  );
}

export default AiTasksPage;
