import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BackButton from '../../components/common/BackButton';
import NormalizedCandidateReview, { type CandidateReviewStatus } from '../../components/ai-tasks/NormalizedCandidateReview';
import { useAiTaskCenter } from '../../hooks/useAiTaskCenter';
import { AI_TASK_USER_STATUS_LABELS, type AiTaskCenterItem } from '../../types/aiTaskCenter';
import { formatDateTime } from '../../utils/date';
import { getAiTaskDisplayLabel } from '../../utils/aiTaskDisplay';
import '../../styles/ai-tasks.css';
import { aiTaskCenterService, type TaskArtifactContent } from '../../services/ai-tasks/aiTaskCenterService';
import { placementApplyService } from '../../services/ai-tasks/placementApplyService';
import { confirmDanger, confirmInfo } from '../../utils/nativeDialog';
import { normalizeCandidate } from '../../services/ai-tasks/normalizedCandidateService';
import type { NormalizedCandidate } from '../../types/normalizedCandidate';

function scopeLabel(item: AiTaskCenterItem): string {
  if (item.chapterTitle && item.novelTitle) return `${item.novelTitle} · ${item.chapterTitle}`;
  return item.chapterTitle || item.novelTitle || (item.novelId === 'system' ? '应用设置' : '未关联作品');
}

function TaskCard({
  item, onOpenArtifact, onCancel, onRetry, onDelete, allowDelete = true,
}: {
  item: AiTaskCenterItem;
  onOpenArtifact: (artifactId: string) => void;
  onCancel: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  onDelete: (item: AiTaskCenterItem) => void;
  allowDelete?: boolean;
}) {
  const [advanced, setAdvanced] = useState(false);
  const canDelete = allowDelete && ['awaiting_confirmation', 'completed', 'failed', 'cancelled', 'expired'].includes(item.userStatus);
  return (
    <article className={`ai-task-card status-${item.userStatus}`}>
      <div className="ai-task-card-main">
        <div>
          <div className="ai-task-card-title">
            <strong>{getAiTaskDisplayLabel(item.taskType)}</strong>
            <span className={`ai-task-status status-${item.userStatus}`}>
              {AI_TASK_USER_STATUS_LABELS[item.userStatus]}
            </span>
            {item.isLegacy && <span className="ai-task-legacy">历史记录</span>}
          </div>
          <div className="ai-task-card-scope">{scopeLabel(item)}</div>
          {item.progressStage && <div className="ai-task-card-note">{item.progressStage}</div>}
          {item.artifactIssue && <div className="ai-task-card-warning">结果提醒：{item.artifactIssue}</div>}
          {item.errorMessage && <div className="ai-task-card-error">{item.errorMessage}</div>}
          {item.staleReason && <div className="ai-task-card-warning">过期原因：{item.staleReason}</div>}
          {!!item.dependencyCount && item.completedDependencyCount !== item.dependencyCount && (
            <div className="ai-task-card-note">等待依赖：{item.completedDependencyCount || 0}/{item.dependencyCount}</div>
          )}
        </div>
        <div className="ai-task-card-time">
          <span>{formatDateTime(item.createdAt)}</span>
          <button type="button" className="btn btn-text btn-xs" onClick={() => setAdvanced((value) => !value)}>
            {advanced ? '收起详情' : '高级详情'}
          </button>
        </div>
      </div>
      {item.userStatus === 'awaiting_confirmation' && (
        <div className="ai-task-review-callout">候选结果已经准备好，请核对后再决定是否采用。系统不会自动修改正文。</div>
      )}
      <div className="ai-task-card-actions">
        {!item.isLegacy && (
          <>
          {item.artifactId && <button type="button" className="btn btn-primary btn-xs" onClick={() => onOpenArtifact(item.artifactId!)}>查看结果</button>}
          {(item.taskType === 'quality_check' || item.workflowId) && ['preparing', 'working', 'checking'].includes(item.userStatus) && (
            <button type="button" className="btn btn-secondary btn-xs" onClick={() => onCancel(item.id)}>请求取消</button>
          )}
          {(item.taskType === 'quality_check' || item.parentTaskId) && item.userStatus === 'failed' && !item.artifactId && (
            <button type="button" className="btn btn-secondary btn-xs" onClick={() => onRetry(item.id)}>重试</button>
          )}
          </>
        )}
        {canDelete && <button type="button" className="btn btn-text btn-xs ai-task-delete" onClick={() => onDelete(item)}>删除记录</button>}
      </div>
      {advanced && (
        <div className="ai-task-audit" data-testid="ai-task-audit">
          <div><span>来源</span><code>{item.source}</code></div>
          <div><span>Task</span><code>{item.id}</code></div>
          {item.latestAttemptId && <div><span>Attempt</span><code>{item.latestAttemptId} · #{item.latestAttemptNumber}</code></div>}
          {item.latestAttemptStatus && <div><span>Attempt 状态</span><code>{item.latestAttemptStatus}</code></div>}
          {item.artifactId && <div><span>Artifact</span><code>{item.artifactId} · {item.artifactStatus}</code></div>}
          {item.proposalId && <div><span>Proposal</span><code>{item.proposalId}</code></div>}
          {item.applyPlanId && <div><span>ApplyPlan</span><code>{item.applyPlanId} · {item.applyPlanStatus}</code></div>}
          {item.traceId && <div><span>Trace</span><code>{item.traceId}</code></div>}
          {item.operationId && <div><span>Operation</span><code>{item.operationId}</code></div>}
          {item.requestHash && <div><span>Request hash</span><code>{item.requestHash}</code></div>}
          {item.artifactContentHash && <div><span>Content hash</span><code>{item.artifactContentHash}</code></div>}
          {item.errorCode && <div><span>错误码</span><code>{item.errorCode}</code></div>}
          {item.responseMetadataJson && <div><span>响应元数据</span><code>{item.responseMetadataJson}</code></div>}
          {item.workflowId && <div><span>Workflow</span><code>{item.workflowId}</code></div>}
          {item.rootTaskId && <div><span>Root Task</span><code>{item.rootTaskId}</code></div>}
          {item.parentTaskId && <div><span>Parent Task</span><code>{item.parentTaskId}</code></div>}
          {item.stepKey && <div><span>Step</span><code>{item.stepKey} · {item.agentRole}</code></div>}
          {item.concurrencyGroup && <div><span>并发组</span><code>{item.concurrencyGroup}</code></div>}
          {item.staleSourceTaskId && <div><span>Stale 来源</span><code>{item.staleSourceTaskId}</code></div>}
        </div>
      )}
    </article>
  );
}

function WorkflowCard({ root, children, onOpenArtifact, onCancel, onRetry, onDelete }: {
  root: AiTaskCenterItem;
  children: AiTaskCenterItem[];
  onOpenArtifact: (artifactId: string) => void;
  onCancel: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  onDelete: (item: AiTaskCenterItem) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const completed = children.filter((item) => ['completed', 'awaiting_confirmation'].includes(item.userStatus)).length;
  const percent = root.progressPercent ?? (children.length ? Math.round(completed * 100 / children.length) : 0);
  const current = children.find((item) => ['working', 'checking'].includes(item.userStatus))
    || children.find((item) => item.userStatus === 'preparing');
  return (
    <article className={`ai-workflow-card status-${root.userStatus}`} data-testid="ai-workflow-card">
      <header>
        <div>
          <div className="ai-task-card-title"><strong>{root.workflowName || getAiTaskDisplayLabel(root.taskType)}</strong><span className={`ai-task-status status-${root.userStatus}`}>{AI_TASK_USER_STATUS_LABELS[root.userStatus]}</span></div>
          <div className="ai-task-card-scope">{scopeLabel(root)}</div>
          <div className="ai-workflow-current">当前步骤：{current ? getAiTaskDisplayLabel(current.taskType) : root.progressStage || '等待审查'}</div>
        </div>
        <button type="button" className="btn btn-text btn-xs" onClick={() => setExpanded((value) => !value)}>{expanded ? '收起步骤' : '展开步骤'}</button>
      </header>
      <div className="ai-workflow-progress"><span style={{ width: `${percent}%` }} /></div>
      <div className="ai-workflow-summary">
        <span>总进度 {percent}%</span><span>完成 {completed}/{children.length}</span>
        {!!root.failedChildCount && <span className="error">失败 {root.failedChildCount}</span>}
        {!!root.staleChildCount && <span className="warning">过期 {root.staleChildCount}</span>}
      </div>
      <div className="ai-task-card-actions">
        {root.artifactId && <button type="button" className="btn btn-primary btn-xs" onClick={() => onOpenArtifact(root.artifactId!)}>查看汇总候选</button>}
        {['preparing', 'working', 'checking'].includes(root.userStatus) && <button type="button" className="btn btn-secondary btn-xs" onClick={() => onCancel(root.id)}>取消工作流</button>}
        {['awaiting_confirmation', 'completed', 'failed', 'cancelled', 'expired'].includes(root.userStatus) && <button type="button" className="btn btn-text btn-xs ai-task-delete" onClick={() => onDelete(root)}>删除工作流记录</button>}
      </div>
      {expanded && <div className="ai-workflow-steps">{children.sort((a, b) => (a.priority || 0) - (b.priority || 0)).map((item) => <TaskCard key={item.id} item={item} onOpenArtifact={onOpenArtifact} onCancel={onCancel} onRetry={onRetry} onDelete={onDelete} allowDelete={false} />)}</div>}
    </article>
  );
}

function Section({ title, items, emptyText, onOpenArtifact, onCancel, onRetry, onDelete }: {
  title: string;
  items: AiTaskCenterItem[];
  emptyText: string;
  onOpenArtifact: (artifactId: string) => void;
  onCancel: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  onDelete: (item: AiTaskCenterItem) => void;
}) {
  return (
    <section className="ai-task-section">
      <div className="ai-task-section-heading"><h2>{title}</h2><span>{items.length}</span></div>
      {items.length === 0
        ? <div className="ai-task-section-empty">{emptyText}</div>
        : <div className="ai-task-list">{items.map((item) => <TaskCard key={`${item.source}:${item.id}`} item={item} onOpenArtifact={onOpenArtifact} onCancel={onCancel} onRetry={onRetry} onDelete={onDelete} />)}</div>}
    </section>
  );
}

function AiTasksPage() {
  const navigate = useNavigate();
  const { items, loading, initialized, error, refresh, updatedAt } = useAiTaskCenter();
  const [artifact, setArtifact] = useState<TaskArtifactContent | null>(null);
  const [actionError, setActionError] = useState('');
  const repairArtifactId = artifact?.structuredPayload
    && typeof artifact.structuredPayload === 'object'
    && 'repairArtifactId' in artifact.structuredPayload
    && typeof artifact.structuredPayload.repairArtifactId === 'string'
      ? artifact.structuredPayload.repairArtifactId
      : undefined;
  const artifactTask = artifact ? items.find((item) => item.id === artifact.taskId) : undefined;
  const normalizedCandidate = useMemo<NormalizedCandidate | null>(() => {
    if (!artifact || artifact.artifactType !== 'chapter_text') return null;
    return normalizeCandidate({
      content: artifact.content,
      rawResponse: artifact.rawContent || artifact.content,
      structuredPayload: artifact.structuredPayload,
      baseContent: artifact.baseContent,
    });
  }, [artifact]);
  const candidateGate = useMemo((): { canAdopt: boolean; reason?: string; status: CandidateReviewStatus } => {
    if (!artifact || !artifactTask || !normalizedCandidate) {
      return { canAdopt: false, reason: '候选结果尚未读取。', status: { tone: 'working', label: '准备中', message: '正在读取候选。' } };
    }
    if (normalizedCandidate.status !== 'ready') {
      const reason = normalizedCandidate.error || 'AI 返回格式异常，无法重建完整正文。';
      return { canAdopt: false, reason, status: { tone: 'blocked', label: '格式异常', message: reason } };
    }
    if (!['valid', 'valid_with_warnings'].includes(artifact.processingStatus)) {
      return { canAdopt: false, reason: '结果完整性检查未通过。', status: { tone: 'blocked', label: '结果检查失败', message: '结果完整性检查未通过。' } };
    }
    const workflowItems = artifactTask.workflowId
      ? items.filter((item) => item.workflowId === artifactTask.workflowId)
      : [];
    const staleItem = [artifactTask, ...workflowItems].find((item) => item.resultExpired || item.userStatus === 'expired');
    if (staleItem) {
      const reason = staleItem.staleReason || '目标正文已经变化，候选结果已过期。';
      return { canAdopt: false, reason, status: { tone: 'warning', label: '目标已过期', message: reason } };
    }
    const failedItem = workflowItems.find((item) => ['failed', 'cancelled'].includes(item.userStatus));
    if (failedItem) {
      const reason = failedItem.errorMessage || '关联检查未完成，当前候选不可采用。';
      return { canAdopt: false, reason, status: { tone: 'blocked', label: '关联检查失败', message: reason } };
    }
    if (artifactTask.taskType === 'quality_fix') {
      const recheck = workflowItems.find((item) => item.stepKey === 'quality_recheck' || item.taskType === 'quality_recheck');
      if (!recheck || !['completed', 'awaiting_confirmation'].includes(recheck.userStatus)) {
        return { canAdopt: false, reason: '修复结果复检尚未完成。', status: { tone: 'working', label: '检查未完成', message: '修复结果复检尚未完成。' } };
      }
    }
    const validation = artifact.constraintValidation;
    if (validation?.status === 'blocked') {
      return { canAdopt: false, reason: '候选存在阻断性约束问题。', status: { tone: 'blocked', label: '存在阻断问题', message: '候选存在阻断性约束问题。' } };
    }
    if (['chapter_generate', 'chapter_rewrite'].includes(artifactTask.taskType) && !validation) {
      return { canAdopt: false, reason: '章节约束检查尚未完成。', status: { tone: 'working', label: '检查未完成', message: '章节约束检查尚未完成。' } };
    }
    if (artifactTask.targetLinkCount > 0) {
      return { canAdopt: false, reason: '该候选已经采用。', status: { tone: 'neutral', label: '已经采用', message: '该候选已经进入正式正文。' } };
    }
    if (!artifactTask.proposalId) {
      return { canAdopt: false, reason: '候选缺少可验证的采用目标。', status: { tone: 'blocked', label: '采用目标不可用', message: '候选缺少可验证的采用目标。' } };
    }
    const warnings = validation?.warningCount || 0;
    return warnings > 0
      ? { canAdopt: true, status: { tone: 'warning', label: '检查通过，建议复核', message: `有 ${warnings} 项建议性提醒。` } }
      : { canAdopt: true, status: { tone: 'ready', label: '检查通过', message: '候选可以审查并采用。' } };
  }, [artifact, artifactTask, items, normalizedCandidate]);
  const workflowRoots = useMemo(() => items.filter((item) => item.workflowId && !item.parentTaskId), [items]);
  const standaloneItems = useMemo(() => items.filter((item) => !item.workflowId), [items]);
  const groups = useMemo(() => ({
    active: standaloneItems.filter((item) => ['preparing', 'working', 'checking'].includes(item.userStatus)),
    review: standaloneItems.filter((item) => ['awaiting_confirmation', 'expired'].includes(item.userStatus)),
    completed: standaloneItems.filter((item) => ['completed', 'cancelled'].includes(item.userStatus)).slice(0, 100),
    failed: standaloneItems.filter((item) => item.userStatus === 'failed'),
  }), [standaloneItems]);
  const openArtifact = async (artifactId: string) => {
    setActionError('');
    try { setArtifact(await aiTaskCenterService.getArtifact(artifactId)); }
    catch (value) { setActionError(value instanceof Error ? value.message : '结果读取失败'); }
  };
  const cancelTask = async (taskId: string) => {
    setActionError('');
    try { await aiTaskCenterService.cancel(taskId, !!items.find((item) => item.id === taskId)?.workflowId); }
    catch (value) { setActionError(value instanceof Error ? value.message : '取消请求失败'); }
  };
  const retryTask = async (taskId: string) => {
    setActionError('');
    try { await aiTaskCenterService.retry(taskId, !!items.find((item) => item.id === taskId)?.workflowId); }
    catch (value) { setActionError(value instanceof Error ? value.message : '重试请求失败'); }
  };
  const deleteTask = async (item: AiTaskCenterItem) => {
    const workflow = !!item.workflowId && !item.parentTaskId;
    if (!(await confirmDanger({
      title: workflow ? '删除工作流记录' : '删除 AI 任务记录',
      message: workflow
        ? '该工作流及其全部步骤会从任务中心移除。已生成结果与审计证据仍会保留，正文不会受影响。是否继续？'
        : item.source === 'unified'
          ? '该记录会从任务中心移除，任务结果与审计证据仍会保留，正文不会受影响。是否继续？'
          : '该历史记录将被删除，正文和已采用结果不会受影响。是否继续？',
    }))) return;
    setActionError('');
    try {
      await aiTaskCenterService.deleteRecord(item);
      if (artifact?.taskId === item.id || (item.workflowId && artifactTask?.workflowId === item.workflowId)) setArtifact(null);
    } catch (value) {
      setActionError(value instanceof Error ? value.message : '删除任务记录失败');
    }
  };
  const confirmArtifact = async () => {
    if (!artifact) return;
    const task = items.find((item) => item.id === artifact.taskId);
    if (!task?.proposalId) { setActionError('该候选缺少可用的审查建议。'); return; }
    const writesChapter = artifact.artifactType === 'chapter_text';
    if (writesChapter && !candidateGate.canAdopt) {
      setActionError(candidateGate.reason || '当前候选不可采用。');
      return;
    }
    if (!(await confirmInfo({
      title: writesChapter ? '确认采用候选正文' : '确认候选审查结果',
      message: writesChapter
        ? '采用后会创建新草稿并设为当前正式正文。是否继续？'
        : '确认只会记录审查证据，不会自动修改正文、摘要、规划或 Canon。是否继续？',
    }))) return;
    setActionError('');
    try {
      const validation = await placementApplyService.validateProposal(task.proposalId);
      if (validation.stale) throw new Error(validation.reason || '候选结果已过期');
      const plan = await placementApplyService.createPlan({
        proposalId: task.proposalId,
        source: writesChapter ? (task.taskType === 'quality_fix' ? 'ai_fix' : 'ai_polished') : 'ai_review',
        note: writesChapter ? '从统一任务中心确认采用' : '从统一任务中心确认审查',
      });
      await placementApplyService.executePlan(plan);
      setArtifact(null);
      await refresh();
    } catch (value) {
      setActionError(value instanceof Error ? value.message : '采用失败');
    }
  };
  const regenerateArtifact = async () => {
    if (!artifactTask) return;
    setArtifact(null);
    if (['failed', 'cancelled'].includes(artifactTask.userStatus)) {
      await retryTask(artifactTask.id);
      return;
    }
    if (artifactTask.novelId) {
      navigate(`/novels/${artifactTask.novelId}/workspace${artifactTask.chapterId ? `?chapterId=${artifactTask.chapterId}` : ''}`);
    }
  };

  return (
    <div className="ai-task-page">
      <BackButton label="返回首页" to="/" />
      <header className="ai-task-page-header">
        <div>
          <h1>AI 任务中心</h1>
          <p>任务会在后台保持可见。候选内容只有经过你的确认才会进入作品。</p>
        </div>
        <button className="btn btn-secondary btn-sm" type="button" onClick={() => void refresh().catch(() => undefined)} disabled={loading}>
          {loading ? '正在刷新…' : '刷新'}
        </button>
      </header>

      {error && (
        <div className="ai-task-load-error" role="alert">
          <strong>任务记录读取失败</strong>
          <span>{error}</span>
          <button type="button" className="btn btn-secondary btn-xs" onClick={() => void refresh().catch(() => undefined)}>重试</button>
        </div>
      )}
      {actionError && <div className="ai-task-load-error" role="alert"><strong>操作失败</strong><span>{actionError}</span></div>}
      {!initialized && loading && <div className="ai-task-loading">正在读取任务记录…</div>}
      {initialized && !error && items.length === 0 && (
        <div className="ai-task-empty">还没有 AI 任务。开始生成、检查或分析后，任务会显示在这里。</div>
      )}
      {items.length > 0 && (
        <>
          {workflowRoots.length > 0 && (
            <section className="ai-task-section">
              <div className="ai-task-section-heading"><h2>工作流</h2><span>{workflowRoots.length}</span></div>
              <div className="ai-task-list">{workflowRoots.map((root) => (
                <WorkflowCard key={root.id} root={root} children={items.filter((item) => item.parentTaskId === root.id)} onOpenArtifact={openArtifact} onCancel={cancelTask} onRetry={retryTask} onDelete={deleteTask} />
              ))}</div>
            </section>
          )}
          <Section title="正在运行" items={groups.active} emptyText="当前没有正在运行的任务" onOpenArtifact={openArtifact} onCancel={cancelTask} onRetry={retryTask} onDelete={deleteTask} />
          <Section title="等待确认" items={groups.review} emptyText="当前没有等待审查的结果" onOpenArtifact={openArtifact} onCancel={cancelTask} onRetry={retryTask} onDelete={deleteTask} />
          <Section title="最近完成" items={groups.completed} emptyText="还没有已完成任务" onOpenArtifact={openArtifact} onCancel={cancelTask} onRetry={retryTask} onDelete={deleteTask} />
          <Section title="失败任务" items={groups.failed} emptyText="当前没有失败任务" onOpenArtifact={openArtifact} onCancel={cancelTask} onRetry={retryTask} onDelete={deleteTask} />
        </>
      )}
      {updatedAt && <div className="ai-task-updated">最近同步：{formatDateTime(updatedAt)}</div>}
      {artifact && (
        <div className="ai-task-result-backdrop" role="presentation" onClick={() => setArtifact(null)}>
          <section className={`ai-task-result-panel${normalizedCandidate ? ' candidate-result' : ''}`} role="dialog" aria-modal="true" aria-label="AI 检查结果" onClick={(event) => event.stopPropagation()}>
            {normalizedCandidate && artifactTask ? (
              <NormalizedCandidateReview
                eyebrow="AI 候选结果"
                title={artifactTask.chapterTitle || getAiTaskDisplayLabel(artifactTask.taskType)}
                metadata={[
                  `${Array.from(normalizedCandidate.fullText).length.toLocaleString()} 字`,
                  normalizedCandidate.mode === 'targeted_fix' ? '定向修订' : '全文改写',
                  artifactTask.novelTitle || '',
                ].filter(Boolean)}
                candidate={normalizedCandidate}
                status={candidateGate.status}
                constraintIssues={artifact.constraintValidation
                  ? [...artifact.constraintValidation.must, ...artifact.constraintValidation.should, ...artifact.constraintValidation.forbid]
                    .filter((item) => item.status !== 'passed').map((item) => item.message)
                  : []}
                technicalDetails={[
                  { label: 'Artifact', value: artifact.artifactId },
                  { label: 'Task', value: artifact.taskId },
                  { label: 'Artifact status', value: artifact.processingStatus },
                  { label: 'Proposal', value: artifactTask.proposalId },
                  { label: 'Workflow', value: artifactTask.workflowId },
                ]}
                canAdopt={candidateGate.canAdopt}
                cannotAdoptReason={candidateGate.reason}
                onDiscard={() => setArtifact(null)}
                onRegenerate={() => void regenerateArtifact()}
                onAdopt={() => void confirmArtifact()}
              />
            ) : (
              <>
                <header><div><strong>AI 候选结果</strong><span>{artifact.processingStatus}</span></div><button type="button" className="btn btn-text btn-sm" onClick={() => setArtifact(null)}>关闭</button></header>
                <div className="ai-task-result-note">此结果仅供审查，不会自动修改正文或作品数据。</div>
                <pre>{artifact.structuredPayload ? JSON.stringify(artifact.structuredPayload, null, 2) : artifact.content}</pre>
                {repairArtifactId && (
                  <div className="ai-task-card-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void openArtifact(repairArtifactId)}>
                      查看并决定是否采用修复候选
                    </button>
                  </div>
                )}
                {artifactTask?.proposalId && (
                  <div className="ai-task-card-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void confirmArtifact()}>
                      确认已审查候选
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

export default AiTasksPage;
