import {
  Activity,
  ArrowRight,
  Bot,
  CircleAlert,
  CircleCheck,
  Cloud,
  FlaskConical,
  Monitor,
  Network,
} from 'lucide-react';
import type { AiSettings } from '../../types/ai';
import type { LocalChapterModelHealthResult } from '../../services/ai/localChapterModelHealthService';

export interface AiRuntimeOverviewCardProps {
  settings: AiSettings;
  localHealthResult: LocalChapterModelHealthResult | null;
}

type RuntimeTone = 'ok' | 'info' | 'warn' | 'error' | 'off';

interface RuntimeTile {
  testId: string;
  icon: typeof Cloud;
  title: string;
  state: string;
  tone: RuntimeTone;
  lines: string[];
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
  const RuntimeStatusIcon = isMock ? FlaskConical : isCloudOk ? CircleCheck : CircleAlert;

  const tiles: RuntimeTile[] = [
    {
      testId: 'runtime-cloud-status',
      icon: Cloud,
      title: 'Cloud Provider',
      state: isMock ? 'Mock' : settings.lastTestOk ? '在线' : '待测试',
      tone: isCloudOk ? 'ok' : 'error',
      lines: [
        `模型: ${settings.modelName || '未指定'}`,
        settings.lastTestAt
          ? `最近测试: ${new Date(settings.lastTestAt).toLocaleTimeString()}`
          : '未进行连通性测试',
      ],
    },
    {
      testId: 'runtime-local-status',
      icon: Monitor,
      title: 'Local Writer',
      state: !isLocalEnabled ? '未启用' : isLocalOk ? '在线' : '离线',
      tone: !isLocalEnabled ? 'off' : isLocalOk ? 'info' : 'error',
      lines: [
        `模型: ${localConfig?.modelName || '未配置'}`,
        `端点: ${localConfig?.baseUrl || 'http://127.0.0.1:11434'}`,
      ],
    },
    {
      testId: 'runtime-gateway-status',
      icon: Network,
      title: 'AI Gateway',
      state: isGatewayEnabled ? '已启用' : '未启用',
      tone: isGatewayEnabled ? 'info' : 'off',
      lines: [
        `提供方: ${gatewayConfig?.providerId || 'ai_gateway'}`,
        `模型: ${gatewayConfig?.modelName || '默认'}`,
      ],
    },
    {
      testId: 'runtime-agent-status',
      icon: Bot,
      title: 'Agent & Memory',
      state: '就绪',
      tone: 'ok',
      lines: ['循环: 5 阶段自主循环', '记忆: 三层长中短期引擎'],
    },
  ];

  return (
    <div
      className="detail-card runtime-overview"
      data-testid="ai-runtime-overview-card"
      data-runtime-ok={isCloudOk ? 'true' : 'false'}
    >
      <div className="runtime-overview-header">
        <div className="resource-card-title resource-card-title--lg">
          <Activity aria-hidden="true" size={20} strokeWidth={1.8} />
          <span>AI 运行时全局概览 (AI Runtime Overview)</span>
        </div>
        <span
          className={`resource-pill ${isCloudOk ? 'resource-pill--success' : 'resource-pill--error'}`}
        >
          <RuntimeStatusIcon aria-hidden="true" size={13} strokeWidth={1.8} />
          {isMock ? 'Mock 离线仿真' : isCloudOk ? '运行时就绪' : '待配置连接'}
        </span>
      </div>

      {/* 模型调度优先级指示 */}
      <div className="runtime-priority">
        <strong className="runtime-priority-label">模型调度优先级：</strong>
        <span className="runtime-priority-step" data-active={isLocalEnabled ? 'true' : 'false'}>
          <Monitor aria-hidden="true" size={13} strokeWidth={1.8} />
          Local Writer (本地写作)
        </span>
        <ArrowRight
          aria-hidden="true"
          size={14}
          strokeWidth={1.8}
          className="runtime-priority-arrow"
        />
        <span className="runtime-priority-step" data-active={isGatewayEnabled ? 'true' : 'false'}>
          <Network aria-hidden="true" size={13} strokeWidth={1.8} />
          AI Gateway (模型网关)
        </span>
        <ArrowRight
          aria-hidden="true"
          size={14}
          strokeWidth={1.8}
          className="runtime-priority-arrow"
        />
        <span className="runtime-priority-step" data-active="true">
          <Cloud aria-hidden="true" size={13} strokeWidth={1.8} />
          Cloud Provider (云端保底)
        </span>
      </div>

      {/* 4 大引擎状态格网 */}
      <div className="runtime-grid">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <div key={tile.testId} className="runtime-tile" data-testid={tile.testId}>
              <div className="runtime-tile-header">
                <span className="runtime-tile-title">
                  <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
                  {tile.title}
                </span>
                <span className="runtime-tile-state" data-tone={tile.tone}>
                  {tile.state}
                </span>
              </div>
              <div className="runtime-tile-body">
                {tile.lines.map((line, index) => (
                  <div key={`${tile.testId}-${index}`}>{line}</div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
