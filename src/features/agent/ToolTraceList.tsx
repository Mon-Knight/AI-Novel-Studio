import { memo, useState } from 'react';
import type { AgentToolExecutionRecord } from '../../types/agentHarness';
import { AGENT_TOOL_METADATA } from '../../services/agent/agentConversationService';

export interface ToolTraceListProps {
  toolRecords: AgentToolExecutionRecord[];
  onAdoptProse?: (content: string) => void;
}

export const ToolTraceCard = memo(function ToolTraceCard({
  record,
  onAdoptProse,
}: {
  record: AgentToolExecutionRecord;
  onAdoptProse?: (content: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const meta = AGENT_TOOL_METADATA[record.toolName] || {
    label: record.toolName,
    icon: '⚙️',
  };
  const isProseGen = record.toolName === 'generate_prose';
  const proseText =
    typeof (record.output as Record<string, unknown>)?.prose === 'string'
      ? String((record.output as Record<string, unknown>).prose)
      : undefined;

  return (
    <div
      className="agent-tool-card"
      data-testid="agent-tool-card"
      data-tool-name={record.toolName}
      style={{
        border: '1px solid var(--color-border-light, #e2e8f0)',
        borderRadius: 8,
        padding: '10px 12px',
        background: '#ffffff',
        fontSize: 12,
        marginBottom: 8,
      }}
    >
      {/* 摘要栏 (Summary Bar) - 点击可展开/折叠 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
        }}
        onClick={() => setExpanded((prev) => !prev)}
        title={expanded ? '点击折叠详情' : '点击展开参数与返回结果'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>{meta.icon}</span>
          <strong style={{ fontSize: 13 }}>{meta.label}</strong>
          <span style={{ color: '#94a3b8', fontSize: 11 }}>({record.toolName})</span>
          <span style={{ color: '#64748b', fontSize: 11 }}>{expanded ? '▲ 折叠' : '▼ 详情'}</span>
        </div>
        <span
          style={{
            fontSize: 11,
            padding: '1px 6px',
            borderRadius: 4,
            background: record.success ? '#dcfce7' : '#fee2e2',
            color: record.success ? '#15803d' : '#b91c1c',
          }}
        >
          {record.success ? `✓ 完成 ${record.durationMs}ms` : `! 失败`}
        </span>
      </div>

      {/* 默认折叠内容：展开后展示输入输出详情 */}
      {expanded && (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e2e8f0' }}>
          {/* 输入参数 */}
          <div style={{ marginBottom: 6, color: '#64748b' }}>
            <span style={{ fontWeight: 500 }}>输入参数: </span>
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
              {JSON.stringify(record.inputArgs)}
            </span>
          </div>

          {/* 输出结果摘要 */}
          <div
            style={{
              background: '#f8fafc',
              padding: 8,
              borderRadius: 4,
              maxHeight: 140,
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: 11,
              whiteSpace: 'pre-wrap',
            }}
          >
            {record.success ? JSON.stringify(record.output, null, 2) : `错误: ${record.error}`}
          </div>
        </div>
      )}

      {/* 采纳正文动作 (如果是正文生成工具) */}
      {isProseGen && proseText && onAdoptProse && (
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            data-testid="agent-adopt-prose-btn"
            onClick={() => onAdoptProse(proseText)}
            style={{ fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}
          >
            采纳为章节正文
          </button>
        </div>
      )}
    </div>
  );
});

export const ToolTraceList = memo(function ToolTraceList({
  toolRecords,
  onAdoptProse,
}: ToolTraceListProps) {
  if (toolRecords.length === 0) return null;

  return (
    <div
      className="agent-tool-trace-list"
      data-testid="agent-tool-trace-list"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' }}
    >
      {toolRecords.map((record, i) => (
        <ToolTraceCard
          key={record.callId || `tool-${i}`}
          record={record}
          onAdoptProse={onAdoptProse}
        />
      ))}
    </div>
  );
});
