import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appLogger } from '../../services/observability/appLogger';
import { aiTaskService } from '../../services/ai/aiTaskService';
import type { AiTaskRecord, AiTaskStatus, AiTaskType } from '../../types/ai';
import { AiTaskTypeLabels } from '../../types/ai';
import { confirmDanger } from '../../utils/nativeDialog';
import { describeUnknownError } from '../../utils/errorMessage';
import AiTasksPageView from './AiTasksPageView';
import { TASK_PAGE_SIZE, type ActiveExecutionState } from './aiTasksPresentation';
import { reconcileAiTaskRecords } from './aiTaskRecordReconciliation';

function isDeletableTask(task: AiTaskRecord): boolean {
  return task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled';
}

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadedQuery, setLoadedQuery] = useState('');
  const [loadedPage, setLoadedPage] = useState(1);
  const query = `${typeFilter}:${statusFilter}:${page}`;
  const staleResults = loadedQuery !== query;
  const liveQuery = useRef(query);
  liveQuery.current = query;
  const loadedQueryRef = useRef(loadedQuery);
  loadedQueryRef.current = loadedQuery;
  const deletingRef = useRef(deleting);
  deletingRef.current = deleting;
  const loadGeneration = useRef(0);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const messageGeneration = useRef(0);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const showMessage = useCallback((text: string, durationMs = 3000) => {
    const generation = ++messageGeneration.current;
    clearTimeout(messageTimer.current);
    setMsg(text);
    if (durationMs > 0)
      messageTimer.current = setTimeout(() => {
        if (messageGeneration.current === generation) setMsg('');
      }, durationMs);
  }, []);

  useEffect(
    () => () => {
      loadGeneration.current += 1;
      clearTimeout(messageTimer.current);
    },
    [],
  );

  const loadTasks = useCallback(
    async (requestedPage = 1) => {
      const requestedQuery = `${typeFilter}:${statusFilter}:${requestedPage}`;
      const canPublish = requestedQuery === liveQuery.current;
      const generation = canPublish ? ++loadGeneration.current : -1;
      if (canPublish) {
        setLoading(true);
        setLoadError('');
      }
      appLogger.debug('[AI_TASK_DELETE_UI] reload tasks start');
      try {
        const result = await aiTaskService.getAll(requestedPage, TASK_PAGE_SIZE, {
          taskType: typeFilter === 'all' ? undefined : typeFilter,
          status: statusFilter === 'all' ? undefined : statusFilter,
        });
        if (generation === loadGeneration.current && requestedQuery === liveQuery.current) {
          setTasks((previous) => reconcileAiTaskRecords(previous, result.items));
          setTotal(result.total);
          setLoadedQuery(requestedQuery);
          setLoadedPage(requestedPage);
          const selectable = new Set(result.items.filter(isDeletableTask).map((task) => task.id));
          setSelectedIds((previous) => new Set([...previous].filter((id) => selectable.has(id))));
        }
        appLogger.debug('[AI_TASK_DELETE_UI] reload tasks done', {
          itemCount: result.items.length,
          total: result.total,
        });
        return result.items;
      } catch (cause) {
        if (generation === loadGeneration.current && requestedQuery === liveQuery.current) {
          setLoadError(describeUnknownError(cause, '任务记录读取失败。'));
        }
        throw cause;
      } finally {
        if (generation === loadGeneration.current && requestedQuery === liveQuery.current)
          setLoading(false);
      }
    },
    [statusFilter, typeFilter],
  );

  useEffect(() => {
    void loadTasks(page).catch((error) => {
      appLogger.captureError('AI_TASK_PAGE_LOAD_FAILED', error, { page, typeFilter, statusFilter });
    });
  }, [loadTasks, page, showMessage, statusFilter, typeFilter]);

  useEffect(() => {
    if (!tasks.some((task) => task.status === 'running' || task.status === 'pending')) return;
    const timer = window.setInterval(() => {
      setExecutionRevision((value) => value + 1);
      void loadTasks(page).catch((error: unknown) => {
        appLogger.captureError('AI_TASK_PAGE_REFRESH_FAILED', error);
      });
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
      visiblePage: Math.min(loadedPage, nextTotalPages),
      pagedTasks: tasks,
    };
  }, [loadedPage, tasks, total]);

  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [typeFilter, statusFilter]);

  useEffect(() => {
    if (loadedQuery === query && !loading && page > totalPages) setPage(totalPages);
  }, [page, totalPages, loadedQuery, loading, query]);

  const handleStopTask = useCallback(
    (task: AiTaskRecord) => {
      const outcome = aiTaskService.cancelActiveExecution(task.id);
      setExecutionRevision((value) => value + 1);
      showMessage(
        outcome === 'requested'
          ? '已发送停止请求，正在等待传输和任务终态确认。'
          : outcome === 'already_requested'
            ? '该任务正在停止。'
            : '当前进程没有该任务的运行句柄；它可能来自上次应用会话。',
      );
    },
    [showMessage],
  );

  const handleToggleSelect = useCallback((id: string) => {
    if (loadedQueryRef.current !== liveQuery.current || deletingRef.current) return;
    setSelectedIds((previous) => {
      if (!tasksRef.current.some((task) => task.id === id && isDeletableTask(task))) {
        return previous;
      }
      const next = new Set(previous);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleToggleExpand = useCallback(
    (id: string) => setExpandedId((previous) => (previous === id ? null : id)),
    [],
  );

  const goToPage = useCallback((nextPage: number) => {
    setPage(nextPage);
    // Selection is page-scoped; never leave hidden rows selected for a later delete.
    setSelectedIds(new Set());
  }, []);

  const handleDeleteOne = useCallback(
    async (task: AiTaskRecord) => {
      const requestQuery = liveQuery.current;
      const canDeleteCurrent = () =>
        loadedQueryRef.current === requestQuery &&
        liveQuery.current === requestQuery &&
        !deletingRef.current &&
        tasksRef.current.some((item) => item.id === task.id && isDeletableTask(item));
      if (!canDeleteCurrent()) return;
      if (!isDeletableTask(task)) {
        showMessage('运行中或等待中的任务需先停止并确认终态，之后才能删除。');
        return;
      }
      if (
        !(await confirmDanger({
          title: '删除任务记录',
          message: `确定删除这条「${AiTaskTypeLabels[task.taskType]}」记录吗？`,
        }))
      )
        return;
      if (!canDeleteCurrent()) {
        showMessage('列表已变化，未删除旧结果；请重新读取并选择记录。', 0);
        return;
      }
      deletingRef.current = true;
      setDeleting(true);
      try {
        const result = await aiTaskService.deleteOne(task.id);
        appLogger.debug('[AI_TASK_DELETE_UI] delete one result', result);
        if (result.deletedCount === 0)
          return showMessage('未删除任何记录，请检查记录ID或数据库连接', 0);
        const reloaded = await loadTasks(page);
        if (reloaded.some((item) => item.id === task.id)) {
          appLogger.error('[AI_TASK_DELETE_VERIFY_FAILED] deleted ids still visible', [task.id]);
          return showMessage('删除后仍检测到记录，请检查数据源', 0);
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
        showMessage('删除失败：' + describeUnknownError(error), 0);
      } finally {
        deletingRef.current = false;
        setDeleting(false);
      }
    },
    [loadTasks, page, showMessage],
  );

  const deleteMany = async (
    ids: string[],
    requestQuery: string,
    successMessage: (count: number) => string,
  ) => {
    if (ids.length === 0) return showMessage('请先选择要删除的记录', 2000);
    if (
      loadedQueryRef.current !== requestQuery ||
      liveQuery.current !== requestQuery ||
      deletingRef.current ||
      !ids.every((id) => tasksRef.current.some((task) => task.id === id && isDeletableTask(task)))
    ) {
      showMessage('列表已变化，未删除旧结果；请重新读取并选择记录。', 0);
      return;
    }
    appLogger.debug('[AI_TASK_DELETE_UI] delete selected clicked', {
      selectedIds: ids,
      selectedCount: ids.length,
    });
    deletingRef.current = true;
    setDeleting(true);
    try {
      const result = await aiTaskService.deleteMany(ids);
      appLogger.debug('[AI_TASK_DELETE_UI] deleteMany result', result);
      if (result.deletedCount === 0)
        return showMessage('未删除任何记录，请检查记录ID或数据库连接', 0);
      const reloaded = await loadTasks(page);
      const stillVisibleIds = reloaded
        .filter((item) => ids.includes(item.id))
        .map((item) => item.id);
      if (stillVisibleIds.length > 0) {
        appLogger.error(
          '[AI_TASK_DELETE_VERIFY_FAILED] deleted ids still visible',
          stillVisibleIds,
        );
        return showMessage('删除后仍检测到记录，请检查数据源', 0);
      }
      setSelectedIds(new Set());
      setSelectMode(false);
      showMessage(successMessage(result.deletedCount));
    } catch (error: unknown) {
      appLogger.error('[AI_TASK_DELETE_UI] delete selected failed full error', {
        errorMessage: describeUnknownError(error),
        error,
      });
      showMessage('删除失败：' + describeUnknownError(error), 0);
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (staleResults || deletingRef.current) return;
    const requestQuery = query;
    const ids = [...selectedIds];
    if (
      !(await confirmDanger({
        title: '批量删除',
        message: `确定删除选中的 ${ids.length} 条 AI 任务记录吗？`,
      }))
    )
      return;
    await deleteMany(ids, requestQuery, (count) => `已删除 ${count} 条记录`);
  };

  const handleDeleteFiltered = async () => {
    if (staleResults || deletingRef.current) return;
    const requestQuery = query;
    const deletableIds = tasks.filter(isDeletableTask).map((task) => task.id);
    if (deletableIds.length === 0) {
      showMessage('当前页没有可删除的终态任务。');
      return;
    }
    if (
      !(await confirmDanger({
        title: '删除当前页记录',
        message: `确定删除当前页的 ${deletableIds.length} 条终态记录吗？`,
      }))
    )
      return;
    await deleteMany(deletableIds, requestQuery, (count) => `已删除当前页 ${count} 条记录`);
  };

  const handleClearAll = async () => {
    if (deletingRef.current) return;
    if (
      !(await confirmDanger({
        title: '清空全部记录',
        message:
          '确定清空所有 AI 任务记录吗？\n\n这只会删除 AI 调用历史，不会删除作品、章节、草稿、大纲、角色或设定。\n\n此操作无法恢复。',
      }))
    )
      return;
    if (deletingRef.current) return;
    const beforeCount = total;
    appLogger.debug('[AI_TASK_DELETE_UI] clear all clicked', { beforeCount });
    deletingRef.current = true;
    setDeleting(true);
    try {
      const result = await aiTaskService.clearAll();
      appLogger.debug('[AI_TASK_DELETE_UI] clearAll result', result);
      if (beforeCount > 0 && result.deletedCount === 0)
        return showMessage('清空失败：数据库未删除任何记录', 0);
      const reloaded = await loadTasks(1);
      if (reloaded.length > 0) {
        appLogger.error('[AI_TASK_DELETE_VERIFY_FAILED] clear all still visible', {
          itemCount: reloaded.length,
          ids: reloaded.map((item) => item.id).slice(0, 20),
        });
        return showMessage('清空后仍检测到记录，请检查数据源', 0);
      }
      setPage(1);
      setSelectedIds(new Set());
      setSelectMode(false);
      showMessage(`清理完成，已删除 ${result.deletedCount} 条记录`);
    } catch (error: unknown) {
      appLogger.error('[AI_TASK_DELETE_UI] clear all failed full error', {
        errorMessage: describeUnknownError(error),
        error,
      });
      showMessage('清空失败：' + describeUnknownError(error), 0);
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  };

  return (
    <AiTasksPageView
      tasks={tasks}
      staleResults={staleResults}
      requestedPage={page}
      loading={loading || (loadedQuery !== query && !loadError)}
      loadError={loadError}
      onRetryLoad={() => void loadTasks(page).catch(() => undefined)}
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
        if (staleResults && !selectMode) return;
        if (deletingRef.current) return;
        setSelectMode((value) => !value);
        setSelectedIds(new Set());
      }}
      onToggleSelectAll={() => {
        if (staleResults || deletingRef.current) return;
        setSelectedIds(() => {
          const deletableIds = tasks.filter(isDeletableTask).map((task) => task.id);
          return selectedIds.size === deletableIds.length ? new Set() : new Set(deletableIds);
        });
      }}
      onDeleteSelected={handleDeleteSelected}
      onClearAll={handleClearAll}
      onDeleteFiltered={handleDeleteFiltered}
      onToggleSelect={handleToggleSelect}
      onToggleExpand={handleToggleExpand}
      onStopTask={handleStopTask}
      onDeleteOne={handleDeleteOne}
      onPreviousPage={() => goToPage(Math.max(1, page - 1))}
      onNextPage={() => goToPage(Math.min(totalPages, page + 1))}
    />
  );
}

export default AiTasksPage;
