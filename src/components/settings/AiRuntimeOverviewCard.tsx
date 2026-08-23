import type { AiSettings } from '../../types/ai';
import type { LocalChapterModelHealthResult } from '../../services/ai/localChapterModelHealthService';

export interface AiRuntimeOverviewCardProps {
  settings: AiSettings;
  localHealthResult: LocalChapterModelHealthResult | null;
}

export default function AiRuntimeOverviewCard({
  settings,
  localHealthResult,
}: AiRuntimeOverviewCardProps) {
  const isMock = settings.runtimeMode === 'mock';
  const isCloudOk = isMock || Boolean(settings.lastTestOk);
  const localConfig = settings.localChapterModel;
  const isLocalEnabled = Boolean(localConfig?.enabled);
  const isLocalOk = isLocalEnabled && Boolean(localHealthResult?.healthOk);
  const gatewayConfig = settings.gateway ?? settings.remoteWriter;
  const isGatewayEnabled = Boolean(gatewayConfig?.enabled);

  return (
    <div
      className="detail-card"
      data-testid="ai-runtime-overview-card"
      style={{
        marginBottom: 20,
        background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
        border: '1px solid #cbd5e1',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>⚡</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text-primary)' }}>
            AI 运行时全局概览 (AI Runtime Overview)
          </span>
        </div>
        <span
          style={{
            fontSize: 12,
            padding: '2px 8px',
            borderRadius: 12,
            background: isCloudOk ? '#dcfce7' : '#fee2e2',
            color: isCloudOk ? '#166534' : '#991b1b',
            fontWeight: 600,
          }}
        >
          {isMock ? '🔶 Mock 离线仿真' : isCloudOk ? '🟢 运行时就绪' : '🔴 待配置连接'}
        </span>
      </div>

      {/* 模型调度优先级指示 */}
      <div
        style={{
          padding: '8px 12px',
          background: '#ffffff',
          borderRadius: 6,
          border: '1px solid #e2e8f0',
          marginBottom: 14,
          fontSize: 12,
        }}
      >
        <strong style={{ color: 'var(--color-text-secondary)' }}>模型调度优先级：</strong>
        <span style={{ color: isLocalEnabled ? '#0284c7' : '#94a3b8', fontWeight: 600 }}>
          ① Local Writer (本地写作)
        </span>
        <span style={{ margin: '0 6px', color: '#94a3b8' }}>→</span>
        <span style={{ color: isGatewayEnabled ? '#8b5cf6' : '#94a3b8', fontWeight: 600 }}>
          ② AI Gateway (模型网关)
        </span>
        <span style={{ margin: '0 6px', color: '#94a3b8' }}>→</span>
        <span style={{ color: '#16a34a', fontWeight: 600 }}>
          ③ Cloud Provider (云端保底)
        </span>
      </div>

      {/* 4 大引擎状态格网 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 10,
        }}
      >
        {/* 1. Cloud Provider */}
        <div
          data-testid="runtime-cloud-status"
          style={{
            padding: 10,
            background: '#ffffff',
            borderRadius: 6,
            border: '1px solid #e2e8f0',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontWeight: 600, color: '#334155' }}>☁️ Cloud Provider</span>
            <span
              style={{
                color: isCloudOk ? '#16a34a' : '#dc2626',
                fontWeight: 600,
              }}
            >
              {isMock ? 'Mock' : settings.lastTestOk ? '在线' : '待测试'}
            </span>
          </div>
          <div style={{ color: '#64748b' }}>
            <div>模型: {settings.modelName || '未指定'}</div>
            <div>
              {settings.lastTestAt
                ? `最近测试: ${new Date(settings.lastTestAt).toLocaleTimeString()}`
                : '未进行连通性测试'}
            </div>
          </div>
        </div>

        {/* 2. Local Writer */}
        <div
          data-testid="runtime-local-status"
          style={{
            padding: 10,
            background: '#ffffff',
            borderRadius: 6,
            border: '1px solid #e2e8f0',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontWeight: 600, color: '#334155' }}>💻 Local Writer</span>
            <span
              style={{
                color: !isLocalEnabled ? '#94a3b8' : isLocalOk ? '#0284c7' : '#dc2626',
                fontWeight: 600,
              }}
            >
              {!isLocalEnabled ? '未启用' : isLocalOk ? '在线' : '离线'}
            </span>
          </div>
          <div style={{ color: '#64748b' }}>
            <div>模型: {localConfig?.modelName || '未配置'}</div>
            <div>端点: {localConfig?.baseUrl || 'http://127.0.0.1:11434'}</div>
          </div>
        </div>

        {/* 3. AI Gateway */}
        <div
          data-testid="runtime-gateway-status"
          style={{
            padding: 10,
            background: '#ffffff',
            borderRadius: 6,
            border: '1px solid #e2e8f0',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontWeight: 600, color: '#334155' }}>🌐 AI Gateway</span>
            <span
              style={{
                color: isGatewayEnabled ? '#8b5cf6' : '#94a3b8',
                fontWeight: 600,
              }}
            >
              {isGatewayEnabled ? '已启用' : '未启用'}
            </span>
          </div>
          <div style={{ color: '#64748b' }}>
            <div>提供方: {gatewayConfig?.providerId || 'ai_gateway'}</div>
            <div>模型: {gatewayConfig?.modelName || '默认'}</div>
          </div>
        </div>

        {/* 4. Agent Harness & Memory Layer */}
        <div
          data-testid="runtime-agent-status"
          style={{
            padding: 10,
            background: '#ffffff',
            borderRadius: 6,
            border: '1px solid #e2e8f0',
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontWeight: 600, color: '#334155' }}>🧠 Agent & Memory</span>
            <span style={{ color: '#16a34a', fontWeight: 600 }}>就绪</span>
          </div>
          <div style={{ color: '#64748b' }}>
            <div>循环: 5 阶段自主循环</div>
            <div>记忆: 三层长中短期引擎</div>
          </div>
        </div>
      </div>
    </div>
  );
}
