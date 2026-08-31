// DshPreparationCard：章节准备提案双源卡片（挂在 AI 生成面板 readiness 卡之后）。
// 遵循桌面写作风格：复用 agent-plan-card 样式族，浅色克制，无后台管理感。

import type { ChapterPreparationProposal } from '../../types/chapterPreparation';
import { CheckCircle2, CircleHelp, TriangleAlert } from 'lucide-react';
import { useDshPreparation } from './useDshPreparation';

export interface DshPreparationCardProps {
  novelId?: string;
  chapterId?: string;
  /** 用户配置的 Provider Key（runtimeMode === 'api' 时传入；不落盘）。 */
  apiKey?: string;
  baseUrl?: string;
  modelName?: string;
  /** 测试注入点。 */
  hook?: typeof useDshPreparation;
}

const severityLabels: Record<string, string> = { low: '低', medium: '中', high: '高' };

function ProposalSummary({ proposal }: { proposal: ChapterPreparationProposal }) {
  const metrics = proposal.metrics;
  const coercion = metrics.plannerCoerced;
  return (
    <div className="agent-plan-result is-ready" data-testid="dsh-proposal">
      <div style={{ fontSize: 12, lineHeight: 1.7 }}>
        <div>
          来源：
          {proposal.planner === 'dsh_spike_v0'
            ? 'DSH 大脑（进程外 · 只读工具）'
            : '当前 Planner（确定性映射）'}
          {coercion ? (
            <span
              data-testid="dsh-coercion-mark"
              style={{ color: 'var(--color-warning)', marginLeft: 8 }}
            >
              <TriangleAlert aria-hidden="true" size={13} strokeWidth={1.8} />
              planner 枚举已归一（原始：{coercion.original}）
            </span>
          ) : null}
        </div>
        <div style={{ color: 'var(--color-text-muted)' }}>
          度量：耗时 {(metrics.durationMs / 1000).toFixed(1)}s
          {metrics.promptTokens !== undefined ? ' · 输入 ' + metrics.promptTokens : ''}
          {metrics.completionTokens !== undefined ? ' · 输出 ' + metrics.completionTokens : ''}
          {metrics.toolCallCount !== undefined ? ' · 工具 ' + metrics.toolCallCount + ' 次' : ''}
        </div>
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 12 }}>本章目标</div>
        <ul className="agent-plan-steps" style={{ marginTop: 4 }}>
          {proposal.chapterGoals.map((goal) => (
            <li key={goal} className="agent-plan-step agent-plan-step--completed">
              <CheckCircle2 aria-hidden="true" size={13} strokeWidth={1.8} />
              <span>{goal}</span>
            </li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 12 }}>场景计划</div>
        {proposal.scenePlan.map((scene) => (
          <div key={scene.title} style={{ fontSize: 12, marginTop: 4, lineHeight: 1.6 }}>
            <div>
              · {scene.title} —— {scene.purpose}
            </div>
            {scene.conflicts && scene.conflicts.length > 0 ? (
              <div style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>
                冲突：{scene.conflicts.join('、')}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {proposal.characterConstraints.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 12 }}>人物约束</div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            {proposal.characterConstraints.map((item) => (
              <div key={item.characterId + item.constraint}>
                · {item.characterId}：{item.constraint}
              </div>
            ))}
          </div>
        </div>
      )}

      {proposal.continuityRisks.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 12 }}>连续性风险</div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            {proposal.continuityRisks.map((risk) => (
              <div key={risk.kind + risk.description}>
                · [{severityLabels[risk.severity] ?? risk.severity}] {risk.description}
              </div>
            ))}
          </div>
        </div>
      )}

      {proposal.unresolvedQuestions.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 12 }}>未决问题</div>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            {proposal.unresolvedQuestions.map((question) => (
              <div key={question} style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                <CircleHelp aria-hidden="true" size={13} strokeWidth={1.8} />
                {question}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        <div style={{ fontWeight: 600, fontSize: 12 }}>建议动作（不自动执行）</div>
        <div style={{ fontSize: 12, lineHeight: 1.6 }}>
          {proposal.recommendedActions.map((action) => (
            <div key={action.type + action.description}>
              · [{action.type === 'read_tool' ? '读取' : '询问用户'}] {action.description}
              {action.target ? '（' + action.target + '）' : ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DshPreparationCard({
  novelId,
  chapterId,
  apiKey,
  baseUrl,
  modelName,
  hook = useDshPreparation,
}: DshPreparationCardProps) {
  const preparation = hook(novelId, chapterId);
  const {
    proposal,
    planner,
    running,
    error,
    elapsedMs,
    revisions,
    revisionsLoading,
    revisionsError,
    summary,
    summaryError,
    run,
  } = preparation;
  const dshModel = modelName?.trim() || undefined;
  const dshBaseUrl = baseUrl?.trim() || undefined;
  const revisionsReady = !revisionsLoading && revisions !== null;
  const dshDisabled = running || !novelId || !chapterId || !apiKey || !revisionsReady;

  return (
    <section
      className="agent-plan-card"
      data-testid="dsh-preparation"
      data-planner={proposal?.planner ?? 'none'}
    >
      <div className="agent-plan-card__header">
        <div>
          <div className="agent-plan-card__title">章节准备提案（DSH 融合实验）</div>
          <div className="agent-plan-card__subtitle">进程外大脑 · 只读工具 · 提案不自动采用</div>
        </div>
        {proposal && (
          <span className="agent-plan-status agent-plan-status--completed">
            {proposal.planner === 'dsh_spike_v0' ? 'DSH 大脑' : '当前 Planner'}
          </span>
        )}
      </div>

      <div
        className="agent-plan-card__actions"
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
      >
        <button
          className="btn btn-secondary btn-sm"
          type="button"
          data-testid="dsh-run-current"
          disabled={running || !novelId || !chapterId || !revisionsReady}
          onClick={() => void run('current')}
        >
          {planner === 'current' && running ? '映射中…' : '当前 Planner（零成本）'}
        </button>
        <button
          className="btn btn-primary btn-sm"
          type="button"
          data-testid="dsh-run-dsh"
          disabled={dshDisabled}
          onClick={() =>
            void run('dsh', {
              apiKey: apiKey ?? '',
              baseUrl: dshBaseUrl,
              model: dshModel,
            })
          }
        >
          {planner === 'dsh' && running ? '生成中…' : 'DSH 大脑（真实 API）'}
        </button>
      </div>

      {revisionsLoading && (
        <div className="agent-plan-card__notice" data-testid="dsh-revisions-loading">
          正在加载基线修订号（六来源）…
        </div>
      )}
      {revisionsError && (
        <div className="agent-plan-card__notice is-warning" data-testid="dsh-revisions-error">
          {revisionsError}
        </div>
      )}
      {revisionsReady && (
        <div
          className="agent-plan-card__notice"
          style={{ fontSize: 11 }}
          data-testid="dsh-revisions-ready"
        >
          基线修订号已加载：{revisions?.map((item) => item.source + '=' + item.revision).join('，')}
        </div>
      )}
      {summary.runs > 0 && (
        <div
          className="agent-plan-card__notice"
          style={{ fontSize: 11 }}
          data-testid="dsh-usage-summary"
        >
          本章 DSH 用量：{summary.runs} 次 · 输入 {summary.promptTokens} tokens · 输出{' '}
          {summary.completionTokens} tokens · 累计 {(summary.durationMs / 1000).toFixed(1)}s
          （观测汇总，不替代全局预算门禁）
        </div>
      )}
      {summaryError && (
        <div className="agent-plan-card__notice is-warning" data-testid="dsh-summary-error">
          {summaryError}
        </div>
      )}
      {!apiKey && (
        <div className="agent-plan-card__notice is-warning" data-testid="dsh-no-key">
          未配置 API Key，DSH 大脑不可用；请先在设置中心配置 Cloud Provider。
        </div>
      )}
      {running && (
        <div className="agent-plan-card__notice" data-testid="dsh-running">
          正在生成提案…
          {elapsedMs !== null ? ' 已耗时 ' + Math.round(elapsedMs / 1000) + 's' : ''}
        </div>
      )}
      {error && (
        <div className="agent-plan-card__error" role="alert" data-testid="dsh-error">
          {error}
        </div>
      )}

      {proposal && <ProposalSummary proposal={proposal} />}
    </section>
  );
}
