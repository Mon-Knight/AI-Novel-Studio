import { useEffect, useState } from 'react';
import { Bot, Compass, FileSearch, Gauge, TriangleAlert, X } from 'lucide-react';
import type { Chapter } from '../../../types/chapter';
import type { RouteDecision } from '../../../types/modelRuntime';
import { ROUTE_DECISION_TASK_INPUT_KEY } from '../../../types/modelRuntime';
import { chapterVersionService } from '../../../services/chapters/chapterVersionService';

export interface GenerationTraceData {
  taskType?: string;
  operationId?: string;
  routeDecision?: RouteDecision;
  providerId?: string;
  modelId?: string;
  memoryVersion?: number | string;
  compilationHash?: string;
  promptTemplate?: string;
  promptTemplateVersion?: string;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  durationMs?: number;
  fallbackReason?: string;
  executedAt?: string;
}

export interface GenerationTracePanelProps {
  novelId?: string;
  chapter?: Chapter;
  traceData?: GenerationTraceData;
  taskInput?: Record<string, unknown>;
  onClose?: () => void;
}

export default function GenerationTracePanel({
  novelId,
  chapter,
  traceData: propsTraceData,
  taskInput,
  onClose,
}: GenerationTracePanelProps) {
  const [trace, setTrace] = useState<GenerationTraceData | null>(propsTraceData ?? null);

  useEffect(() => {
    if (propsTraceData) {
      setTrace(propsTraceData);
      return;
    }

    // 1. 尝试从 taskInput 中提取
    if (taskInput) {
      const route = taskInput[ROUTE_DECISION_TASK_INPUT_KEY] as RouteDecision | undefined;
      if (route || taskInput.compilationHash || taskInput.memoryVersion) {
        setTrace({
          taskType: (taskInput.taskType as string) || route?.taskType || 'chapter_scene_generate',
          operationId: (taskInput.operationId as string) || (taskInput.traceId as string),
          routeDecision: route,
          providerId: route?.selected.providerId || (taskInput.providerId as string),
          modelId: route?.selected.modelId || (taskInput.modelId as string),
          memoryVersion: (taskInput.memoryVersion as number | string) || 1,
          compilationHash: (taskInput.compilationHash as string) || undefined,
          promptTemplate: (taskInput.promptTemplate as string) || 'chapter/scene_generation_local',
          fallbackReason: route?.fallbackUsed ? route.reason : undefined,
          executedAt: route?.decidedAt || new Date().toISOString(),
        });
        return;
      }
    }

    // 2. 尝试从章节最新历史版本中读取 Provenance 溯源存证
    if (chapter?.id) {
      const revisions = chapterVersionService.listRevisions(chapter.id);
      if (revisions.length > 0) {
        const latest = revisions[revisions.length - 1];
        const prov = latest.provenance;
        if (prov) {
          setTrace({
            taskType: 'chapter_generation',
            operationId: `rev-${latest.revisionId}`,
            providerId: prov.providerId,
            modelId: prov.modelId,
            memoryVersion: prov.memorySnapshotVersion,
            compilationHash: prov.compilationHash,
            promptTemplate: prov.promptSnapshot,
            fallbackReason: prov.routeReason?.includes('fallback') ? prov.routeReason : undefined,
            executedAt: latest.createdAt,
          });
          return;
        }
      }
    }

    setTrace(null);
  }, [propsTraceData, taskInput, chapter?.id, novelId]);

  const hasTrace = Boolean(
    trace &&
    (trace.taskType ||
      trace.routeDecision ||
      trace.providerId ||
      trace.modelId ||
      trace.compilationHash ||
      trace.memoryVersion),
  );

  const fallbackReason =
    trace?.fallbackReason ||
    (trace?.routeDecision?.fallbackUsed ? trace.routeDecision.reason : undefined);

  return (
    <div
      className="right-panel generation-trace-panel"
      data-testid="generation-trace-panel"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      <div
        className="right-panel-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid var(--color-border-light, #e2e8f0)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Compass size={18} strokeWidth={1.8} aria-hidden="true" />
          <strong style={{ fontSize: 14 }}>Generation Trace</strong>
        </div>
        {onClose && (
          <button
            type="button"
            className="right-panel-close"
            onClick={onClose}
            aria-label="关闭生成追踪"
            title="关闭生成追踪"
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 16,
              color: 'var(--color-text-muted, #64748b)',
            }}
          >
            <X size={17} strokeWidth={1.8} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="right-panel-body" style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {!hasTrace ? (
          <div
            className="generation-trace-empty"
            data-testid="generation-trace-empty"
            style={{
              padding: 24,
              textAlign: 'center',
              color: 'var(--color-text-muted, #64748b)',
              fontSize: 13,
            }}
          >
            No generation trace available
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* 1. 任务与唯一标识 */}
            <div
              style={{
                background: 'var(--color-bg-subtle, #f8fafc)',
                border: '1px solid var(--color-border-light, #e2e8f0)',
                borderRadius: 8,
                padding: 12,
                fontSize: 12,
              }}
            >
              <div style={{ marginBottom: 6 }}>
                <span style={{ color: 'var(--color-text-muted, #64748b)' }}>当前任务: </span>
                <strong data-testid="trace-task-type">
                  {trace?.taskType || 'chapter_scene_generate'}
                </strong>
              </div>
              {trace?.operationId && (
                <div style={{ marginBottom: 6 }}>
                  <span style={{ color: 'var(--color-text-muted, #64748b)' }}>Operation ID: </span>
                  <span
                    style={{
                      fontFamily: 'monospace',
                      color: 'var(--color-text-secondary, #475569)',
                    }}
                  >
                    {trace.operationId}
                  </span>
                </div>
              )}
              {trace?.executedAt && (
                <div>
                  <span style={{ color: 'var(--color-text-muted, #64748b)' }}>执行时间: </span>
                  <span style={{ color: 'var(--color-text-secondary, #475569)' }}>
                    {trace.executedAt}
                  </span>
                </div>
              )}
            </div>

            {/* 2. Fallback 状态告警 (如有) */}
            {fallbackReason && (
              <div
                data-testid="trace-fallback-alert"
                style={{
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  color: '#b45309',
                  borderRadius: 6,
                  padding: 10,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <TriangleAlert size={16} strokeWidth={1.8} aria-hidden="true" />
                <div>
                  <strong>触发 Fallback 回退: </strong>
                  <span>{fallbackReason}</span>
                </div>
              </div>
            )}

            {/* 3. 模型与路由分配 (Model & Route Decision) */}
            <section
              data-testid="trace-model-route"
              style={{
                border: '1px solid var(--color-border-light, #e2e8f0)',
                borderRadius: 8,
                padding: 12,
                background: 'var(--color-bg-card, #ffffff)',
                fontSize: 12,
              }}
            >
              <h4
                style={{
                  fontSize: 13,
                  marginBottom: 8,
                  color: 'var(--color-text-primary, #1e293b)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Bot size={14} strokeWidth={1.8} aria-hidden="true" />
                模型与路由决策 (Model Route)
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <span style={{ color: 'var(--color-text-muted, #64748b)' }}>Provider: </span>
                  <strong data-testid="trace-provider-id">
                    {trace?.providerId || trace?.routeDecision?.selected.providerId || 'mock'}
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--color-text-muted, #64748b)' }}>Model Name: </span>
                  <strong data-testid="trace-model-id">
                    {trace?.modelId || trace?.routeDecision?.selected.modelId || 'default'}
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--color-text-muted, #64748b)' }}>Route Kind: </span>
                  <span>{trace?.routeDecision?.selected.kind || 'direct'}</span>
                </div>
                <div>
                  <span style={{ color: 'var(--color-text-muted, #64748b)' }}>Route Reason: </span>
                  <span>{trace?.routeDecision?.reason || 'role_default'}</span>
                </div>
              </div>
            </section>

            {/* 4. 上下文与契约审计 (Context & Compilation) */}
            <section
              data-testid="trace-compilation-audit"
              style={{
                border: '1px solid var(--color-border-light, #e2e8f0)',
                borderRadius: 8,
                padding: 12,
                background: 'var(--color-bg-card, #ffffff)',
                fontSize: 12,
              }}
            >
              <h4
                style={{
                  fontSize: 13,
                  marginBottom: 8,
                  color: 'var(--color-text-primary, #1e293b)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <FileSearch size={14} strokeWidth={1.8} aria-hidden="true" />
                上下文与契约审计 (Audit & Provenance)
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div>
                  <span style={{ color: 'var(--color-text-muted, #64748b)' }}>
                    Memory Version:{' '}
                  </span>
                  <strong data-testid="trace-memory-version">v{trace?.memoryVersion ?? 1}</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--color-text-muted, #64748b)' }}>
                    Prompt Template:{' '}
                  </span>
                  <span data-testid="trace-prompt-template">
                    {trace?.promptTemplate || 'chapter/scene_generation_local'}
                  </span>
                </div>
                {trace?.compilationHash && (
                  <div>
                    <span style={{ color: 'var(--color-text-muted, #64748b)' }}>
                      Compilation Hash:{' '}
                    </span>
                    <div
                      data-testid="trace-compilation-hash"
                      style={{
                        marginTop: 2,
                        fontFamily: 'monospace',
                        fontSize: 11,
                        background: 'var(--color-bg-subtle, #f1f5f9)',
                        padding: '4px 8px',
                        borderRadius: 4,
                        wordBreak: 'break-all',
                      }}
                    >
                      {trace.compilationHash}
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* 5. 性能与消耗 (Token Usage & Duration) */}
            {(trace?.durationMs !== undefined || trace?.tokenUsage) && (
              <section
                data-testid="trace-performance"
                style={{
                  border: '1px solid var(--color-border-light, #e2e8f0)',
                  borderRadius: 8,
                  padding: 12,
                  background: 'var(--color-bg-card, #ffffff)',
                  fontSize: 12,
                }}
              >
                <h4
                  style={{
                    fontSize: 13,
                    marginBottom: 8,
                    color: 'var(--color-text-primary, #1e293b)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <Gauge size={14} strokeWidth={1.8} aria-hidden="true" />
                  性能与消耗 (Performance & Usage)
                </h4>
                <div style={{ display: 'flex', gap: 16 }}>
                  {trace.durationMs !== undefined && (
                    <div>
                      <span style={{ color: 'var(--color-text-muted, #64748b)' }}>耗时: </span>
                      <strong data-testid="trace-duration">{trace.durationMs} ms</strong>
                    </div>
                  )}
                  {trace.tokenUsage?.totalTokens !== undefined && (
                    <div>
                      <span style={{ color: 'var(--color-text-muted, #64748b)' }}>
                        Token 总消耗:{' '}
                      </span>
                      <strong data-testid="trace-token-usage">
                        {trace.tokenUsage.totalTokens}
                      </strong>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
