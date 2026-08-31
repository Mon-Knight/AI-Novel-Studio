import { ArrowRight, Database } from 'lucide-react';
import type {
  ContextSourceReceiptItem,
  ContextSourceStatus,
  ToolContextReceipt,
} from './workbenchContextReceiptModel';

const CONTEXT_SOURCE_STATUS_LABELS: Record<ContextSourceStatus, string> = {
  used: '已实际注入',
  read: '已读取',
  snapshot: '快照存在 · Provider 注入未核验',
  truncated: '快照存在 · Provider 请求被截断',
  omitted: 'Provider 请求未纳入',
  missing: '本轮无来源',
  fallback: '使用默认',
};

const CONTEXT_SOURCE_GROUP_LABELS: Record<ContextSourceStatus, string> = {
  used: '已注入',
  read: '已读取',
  snapshot: '仅快照',
  truncated: '请求截断',
  omitted: '未纳入',
  missing: '本轮未使用',
  fallback: '已降级',
};

const CONTEXT_SOURCE_STATUS_ORDER: ContextSourceStatus[] = [
  'used',
  'read',
  'truncated',
  'omitted',
  'snapshot',
  'missing',
  'fallback',
];

type CoreContextStatus = ContextSourceStatus | 'unverified';

const CORE_CONTEXT_DEFINITIONS = [
  { key: 'world', label: '正式世界', sourceTypes: ['world_setting'] },
  { key: 'rules', label: '正式规则', sourceTypes: ['rule_system'] },
  { key: 'protagonist', label: '正式主角', sourceTypes: ['protagonist'] },
  { key: 'master_outline', label: '全书大纲', sourceTypes: ['master_outline'] },
  { key: 'volume_outline', label: '分卷大纲', sourceTypes: ['volume_outline'] },
  { key: 'chapter_outline', label: '章节大纲', sourceTypes: ['chapter_outline'] },
  { key: 'adopted_chapter', label: '前章采用稿', sourceTypes: ['adopted_chapter'] },
  { key: 'context', label: 'Context', sourceTypes: ['context_record'] },
  { key: 'memory', label: 'Memory', sourceTypes: ['memory_context'] },
  { key: 'world_state', label: '世界状态', sourceTypes: ['world_state'] },
  { key: 'controls', label: '风格 / 输出', sourceTypes: ['style_profile', 'output_profile'] },
  {
    key: 'chapter_roles',
    label: '章内角色',
    sourceTypes: ['chapter_character', 'character_state', 'chapter_event'],
  },
  { key: 'faction', label: '势力', sourceTypes: ['faction'] },
  { key: 'location', label: '地点', sourceTypes: ['location'] },
  { key: 'reference', label: '参考资料', sourceTypes: ['reference_material'] },
] as const;

const CORE_CONTEXT_STATUS_LABELS: Record<CoreContextStatus, string> = {
  used: '已注入',
  read: '已读取',
  snapshot: '仅快照',
  truncated: '请求截断',
  omitted: '未纳入',
  missing: '无来源',
  fallback: '默认',
  unverified: '来源未核验',
};

const PROVIDER_EVIDENCE_STATUS_LABELS = {
  included: '来源核验完成',
  truncated: '部分来源截断',
  omitted_empty: '快照未纳入',
  omitted_budget: '预算未纳入',
  unverified: '注入未核验',
} as const;

function evidenceCopy(receipt: ToolContextReceipt): string {
  if (receipt.evidence === 'observed') {
    return '仅从本轮工具记录确认已读取，运行时未证明这些内容进入最终生成。';
  }
  if (receipt.evidence === 'unavailable') {
    return '当前运行时没有提供可核验的来源明细，无法判断正式资产是否用于本次结果。';
  }
  if (receipt.snapshotRequestSourceStatus === 'included') {
    return '状态综合本次生成快照与逐条 Provider 来源证据；“已实际注入”仅表示对应来源已进入本次请求。';
  }
  if (receipt.snapshotRequestSourceStatus === 'truncated') {
    return '总体 Provider 证据显示来源在进入本次请求时被截断；请以各来源状态为准，截断项不能视为完整注入。';
  }
  if (
    receipt.snapshotRequestSourceStatus === 'omitted_empty' ||
    receipt.snapshotRequestSourceStatus === 'omitted_budget'
  ) {
    return '总体 Provider 证据显示快照来源未进入本次请求；标为“未纳入”的来源没有实际注入。';
  }
  if (receipt.snapshotRequestSourceStatus === 'unverified') {
    return '状态来自本次生成快照，但缺少 Provider 来源证据；“仅快照”不代表已经进入本次请求。';
  }
  return '状态来自运行时显式回执；“已实际注入”仅表示运行时明确报告对应来源已用于本次结果。';
}

function statusToneClass(status: ContextSourceStatus): string {
  if (status === 'snapshot' || status === 'truncated') return 'has-warning-tone';
  if (status === 'omitted') return 'has-error-tone';
  return '';
}

function providerInclusionStatus(status: CoreContextStatus): 'included' | 'omitted' | 'unverified' {
  if (status === 'used') return 'included';
  if (status === 'omitted') return 'omitted';
  return 'unverified';
}

function sourceStatusLabel(source: ContextSourceReceiptItem): string {
  if (source.status === 'omitted' && source.providerStatus === 'omitted_empty') {
    return '空来源未纳入';
  }
  if (source.status === 'omitted' && source.providerStatus === 'omitted_budget') {
    return '预算未纳入';
  }
  return CONTEXT_SOURCE_STATUS_LABELS[source.status];
}

function coreContextStatuses(
  receipt: ToolContextReceipt,
  sourceTypes: readonly string[],
): Array<{ status: CoreContextStatus; count: number }> {
  if (receipt.evidence === 'unavailable') return [{ status: 'unverified', count: 0 }];
  const sources = receipt.sources.filter((source) => sourceTypes.includes(source.type));
  if (sources.length === 0) return [{ status: 'unverified', count: 0 }];
  return CONTEXT_SOURCE_STATUS_ORDER.flatMap((status) => {
    const count = sources.reduce(
      (total, source) => total + (source.status === status ? source.count : 0),
      0,
    );
    return count > 0 ? [{ status, count }] : [];
  });
}

export function GenerationContextSummary({ receipt }: { receipt: ToolContextReceipt }) {
  const chain = receipt.evidenceChain;
  return (
    <span
      className="workbench-context-summary"
      data-testid="workbench-context-summary"
      data-context-evidence={receipt.evidence}
      aria-label="核心上下文摘要"
    >
      {chain && (
        <span
          className="workbench-context-summary-chain"
          data-testid="workbench-context-chain-summary"
        >
          <span>
            快照 {chain.snapshot.usedCount}/{chain.snapshot.sourceCount}
            {chain.snapshot.reference ? ` · ${chain.snapshot.reference}` : ''}
          </span>
          <ArrowRight aria-hidden="true" size={11} strokeWidth={1.8} />
          <span>
            Provider{' '}
            {chain.provider.includedCount === undefined
              ? '未核验'
              : `${chain.provider.includedCount}/${chain.provider.sourceCount}`}
            {chain.provider.reference ? ` · ${chain.provider.reference}` : ''}
          </span>
        </span>
      )}
      {CORE_CONTEXT_DEFINITIONS.map((definition) => {
        const statuses = coreContextStatuses(receipt, definition.sourceTypes);
        return (
          <span
            className="workbench-context-summary-item"
            data-context-core={definition.key}
            key={definition.key}
          >
            <span className="workbench-context-summary-label">{definition.label}</span>
            <span className="workbench-context-summary-statuses">
              {statuses.map(({ status, count }) => (
                <span
                  className={`workbench-context-summary-status is-${status} ${
                    status === 'unverified' ? '' : statusToneClass(status)
                  }`.trim()}
                  data-context-status={status}
                  data-provider-inclusion={providerInclusionStatus(status)}
                  key={status}
                >
                  {CORE_CONTEXT_STATUS_LABELS[status]}
                  {count > 1 ? ` ${count}` : ''}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

export function GenerationContextReceipt({ receipt }: { receipt: ToolContextReceipt }) {
  const usedCount = receipt.sources.reduce(
    (total, source) =>
      total +
      (source.status === (receipt.evidence === 'observed' ? 'read' : 'used') ? source.count : 0),
    0,
  );
  const countLabel = receipt.evidence === 'observed' ? '已读取' : '已注入';
  const chain = receipt.evidenceChain;
  return (
    <span
      className="workbench-context-receipt"
      data-testid="workbench-context-receipt"
      data-context-evidence={receipt.evidence}
      data-context-stage="provider-receipt"
      aria-label="运行后上下文回执"
    >
      <span className="workbench-context-receipt-title">
        <Database aria-hidden="true" size={12} strokeWidth={1.8} />
        <span>运行后上下文回执</span>
        {receipt.evidence !== 'unavailable' && (
          <span className="workbench-context-receipt-count">
            {countLabel} {usedCount} 项
          </span>
        )}
      </span>
      <span className="workbench-context-receipt-body">
        <span className="workbench-context-receipt-note">{evidenceCopy(receipt)}</span>
        {chain && (
          <span
            className="workbench-context-evidence-chain"
            data-testid="workbench-context-evidence-chain"
          >
            <span className="workbench-context-evidence-stage">
              <strong>冻结快照</strong>
              <span>
                读取 {chain.snapshot.usedCount}/{chain.snapshot.sourceCount}
              </span>
              {chain.snapshot.reference && (
                <span className="workbench-context-evidence-reference">
                  ctx {chain.snapshot.reference}
                </span>
              )}
            </span>
            <ArrowRight
              className="workbench-context-evidence-arrow"
              aria-hidden="true"
              size={13}
              strokeWidth={1.8}
            />
            <span className="workbench-context-evidence-stage">
              <strong>Provider 请求</strong>
              <span>
                {chain.provider.includedCount === undefined
                  ? '注入未核验'
                  : `注入 ${chain.provider.includedCount}/${chain.provider.sourceCount}`}
                {' · '}
                {PROVIDER_EVIDENCE_STATUS_LABELS[chain.provider.status]}
              </span>
              {chain.provider.reference && (
                <span className="workbench-context-evidence-reference">
                  req {chain.provider.reference}
                </span>
              )}
              {chain.provider.messageCount !== undefined && (
                <span className="workbench-context-evidence-message-count">
                  {chain.provider.messageCount} 条消息
                </span>
              )}
            </span>
          </span>
        )}
        {receipt.evidence !== 'unavailable' && (
          <span className="workbench-context-receipt-groups">
            {CONTEXT_SOURCE_STATUS_ORDER.map((status) => {
              const sources = receipt.sources.filter((source) => source.status === status);
              if (sources.length === 0) return null;
              const count = sources.reduce((total, source) => total + source.count, 0);
              return (
                <span
                  className={`workbench-context-receipt-group is-${status} ${statusToneClass(status)}`.trim()}
                  data-context-status={status}
                  key={status}
                >
                  <span className="workbench-context-receipt-group-label">
                    {CONTEXT_SOURCE_GROUP_LABELS[status]} {count}
                  </span>
                  <span className="workbench-context-receipt-items">
                    {sources.map((source) => (
                      <span
                        className={`workbench-context-source is-${source.status} ${statusToneClass(source.status)}`.trim()}
                        data-context-source-type={source.type}
                        data-context-group={source.group}
                        data-provider-inclusion={providerInclusionStatus(source.status)}
                        data-provider-source-status={source.providerStatus}
                        key={`${source.type}:${source.status}:${source.providerStatus ?? ''}`}
                        title={`${source.title}：${sourceStatusLabel(source)}`}
                      >
                        <span className="workbench-context-source-title">
                          {source.title}
                          {source.count > 1 ? ` ${source.count} 项` : ''}
                        </span>
                        {source.detail && (
                          <span className="workbench-context-source-detail">{source.detail}</span>
                        )}
                        <span className="workbench-context-source-status">
                          {sourceStatusLabel(source)}
                        </span>
                      </span>
                    ))}
                  </span>
                </span>
              );
            })}
          </span>
        )}
      </span>
    </span>
  );
}
