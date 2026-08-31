import { useState, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Bot,
  Database,
  Palette,
  Search,
  Settings2,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { aiSettingsService } from '../../services/ai/aiClient';
import type { AiSettings } from '../../types/ai';
import { describeUnknownError } from '../../utils/errorMessage';
import { isAiRequestCancelled } from '../../services/ai/aiCancellation';
import AppearanceSettingsCard from '../../components/settings/AppearanceSettingsCard';
import AiGovernanceSettingsCard from '../../components/settings/AiGovernanceSettingsCard';
import AiProviderSettingsCard from '../../components/settings/AiProviderSettingsCard';
import LocalChapterModelSettingsCard from '../../components/settings/LocalChapterModelSettingsCard';
import AiGatewaySettingsCard from '../../components/settings/AiGatewaySettingsCard';
import AiRuntimeOverviewCard from '../../components/settings/AiRuntimeOverviewCard';
import DataStorageSettingsCard from '../../components/settings/DataStorageSettingsCard';
import SecuritySettingsCard from '../../components/settings/SecuritySettingsCard';
import AboutSettingsCard from '../../components/settings/AboutSettingsCard';
import {
  checkLocalChapterModel,
  type LocalChapterModelHealthResult,
} from '../../services/ai/localChapterModelHealthService';
import DiagnosticsSettingsCard from '../../components/settings/DiagnosticsSettingsCard';
import AppUpdateSettingsCard from '../../components/settings/AppUpdateSettingsCard';

export type SettingsTabKey = 'general' | 'ai_models' | 'governance' | 'data' | 'diagnostics';

interface SettingsNavTab {
  key: SettingsTabKey;
  label: string;
  icon: LucideIcon;
  description: string;
}

const SETTINGS_TABS: SettingsNavTab[] = [
  { key: 'general', label: '常规与外观', icon: Palette, description: '主题、更新与基本偏好' },
  {
    key: 'ai_models',
    label: 'AI 模型配置',
    icon: Bot,
    description: 'Cloud / Local / Gateway 模型',
  },
  { key: 'governance', label: '网关与流控', icon: ShieldCheck, description: '预算限制与安全合规' },
  { key: 'data', label: '数据与存储', icon: Database, description: '数据库、备份与数据修复' },
  { key: 'diagnostics', label: '诊断与关于', icon: Search, description: '系统诊断与软件信息' },
];

function SettingsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<SettingsTabKey>('general');
  const [settings, setSettings] = useState<AiSettings>(aiSettingsService.getSettings());
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const [localHealthChecking, setLocalHealthChecking] = useState(false);
  const [localHealthResult, setLocalHealthResult] = useState<LocalChapterModelHealthResult | null>(
    null,
  );
  const [policySnapshotVersion, setPolicySnapshotVersion] = useState(0);
  const connectionAbortRef = useRef<AbortController | null>(null);
  const localHealthAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setSettings(aiSettingsService.getSettings());
    let disposed = false;
    void aiSettingsService
      .restoreSessionCredentials()
      .then(() => {
        if (!disposed) setSettings(aiSettingsService.getSettings());
      })
      .catch(() => {
        if (!disposed) setMessage('本次应用会话的模型凭据恢复失败，请重新填写 API Key');
      });
    return () => {
      disposed = true;
      connectionAbortRef.current?.abort();
      localHealthAbortRef.current?.abort();
    };
  }, []);

  const handleCheckLocalHealth = async () => {
    if (localHealthAbortRef.current) return;
    const local = settings.localChapterModel;
    if (!local) {
      setLocalHealthResult(null);
      setMessage('请先填写并保存本地模型设置');
      return;
    }
    const controller = new AbortController();
    localHealthAbortRef.current = controller;
    setLocalHealthChecking(true);
    setLocalHealthResult(null);
    try {
      const result = await checkLocalChapterModel(local, controller.signal);
      setLocalHealthResult(result);
      const [{ localModelRef }, { modelLifecycleManager }] = await Promise.all([
        import('../../services/ai/runtime/modelCatalog'),
        import('../../services/ai/runtime/modelLifecycle'),
      ]);
      modelLifecycleManager.observeHealth(
        localModelRef(local).endpointId,
        result.healthOk && result.modelOk && result.smokeOk ? 'ok' : 'down',
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        const [{ localModelRef }, { modelLifecycleManager }] = await Promise.all([
          import('../../services/ai/runtime/modelCatalog'),
          import('../../services/ai/runtime/modelLifecycle'),
        ]);
        modelLifecycleManager.observeHealth(localModelRef(local).endpointId, 'down');
        setLocalHealthResult({
          healthOk: false,
          modelOk: false,
          smokeOk: false,
          modelName: local.modelName,
          message: describeUnknownError(error, '本地模型检查失败'),
        });
      }
    } finally {
      if (localHealthAbortRef.current === controller) localHealthAbortRef.current = null;
      setLocalHealthChecking(false);
    }
  };

  const handleSave = async (nextSettings?: AiSettings) => {
    const source = nextSettings ?? settings;
    const final = { ...source, mockMode: source.runtimeMode === 'mock' };
    try {
      await aiSettingsService.saveSettings(final);
      setSettings(aiSettingsService.getSettings());
      setPolicySnapshotVersion((version) => version + 1);
      setMessage('AI 设置已保存，API Key 仅保留到本次应用会话结束');
    } catch (error) {
      setMessage(`AI 设置保存失败：${describeUnknownError(error, '未知错误')}`);
    }
    setTimeout(() => setMessage(''), 2500);
  };

  const handleTestConnection = async () => {
    if (connectionAbortRef.current) return;
    if (settings.runtimeMode === 'mock') {
      setMessage('Mock 模式无需测试连接，Mock 工作流可用');
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    if (!settings.baseUrl || !settings.apiKey || !settings.modelName) {
      setMessage('请先填写 API Base URL、API Key 和模型名称');
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    setTesting(true);
    setMessage('正在测试连接...');
    const controller = new AbortController();
    connectionAbortRef.current = controller;
    const start = Date.now();
    try {
      const result = await aiSettingsService.testConnection(settings, {
        signal: controller.signal,
        cancel: () => controller.abort(),
      });
      const latency = Date.now() - start;
      const updated = {
        ...settings,
        lastTestAt: new Date().toISOString(),
        lastTestOk: result.ok,
        lastTestMessage: result.message,
      };
      await aiSettingsService.saveSettings(updated);
      setSettings(updated);
      setPolicySnapshotVersion((version) => version + 1);
      setMessage(result.ok ? `连接成功！（${latency}ms）` : `连接失败：${result.message}`);
    } catch (e: unknown) {
      setMessage(
        controller.signal.aborted || isAiRequestCancelled(e)
          ? '连接测试已停止'
          : `连接失败：${describeUnknownError(e, '未知错误')}`,
      );
    } finally {
      if (connectionAbortRef.current === controller) connectionAbortRef.current = null;
      setTesting(false);
    }
  };

  const update = (patch: Partial<AiSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      if ('runtimeMode' in patch) {
        next.mockMode = next.runtimeMode === 'mock';
        next.provider =
          next.runtimeMode === 'mock'
            ? 'mock'
            : next.provider === 'mock'
              ? 'openai_compatible'
              : next.provider;
      }
      const modelIdentityChanged =
        next.provider !== s.provider ||
        next.baseUrl !== s.baseUrl ||
        next.modelName !== s.modelName;
      if (modelIdentityChanged) {
        const currentSessionKey = aiSettingsService.resolveSessionApiKey({
          scope: 'provider',
          providerId: s.provider,
          baseUrl: s.baseUrl,
          modelId: s.modelName,
        });
        if (s.apiKey === currentSessionKey) {
          next.apiKey = aiSettingsService.resolveSessionApiKey({
            scope: 'provider',
            providerId: next.provider,
            baseUrl: next.baseUrl,
            modelId: next.modelName,
          });
        }
      }
      return next;
    });
  };

  return (
    <div
      className="settings-layout"
      data-testid="settings-layout"
      style={{
        display: 'flex',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
        background: 'var(--color-bg-app, #ffffff)',
      }}
    >
      {/* 1. 左侧分类导航栏 */}
      <aside
        className="settings-sidebar"
        data-testid="settings-sidebar"
        style={{
          width: 220,
          flexShrink: 0,
          background: 'var(--color-bg-sidebar, #f8fafc)',
          borderRight: '1px solid var(--color-border, #e2e8f0)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '20px 12px',
        }}
      >
        <div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              padding: '0 8px 16px 8px',
              color: 'var(--color-text-primary, #0f172a)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              borderBottom: '1px solid var(--color-border-light, #f1f5f9)',
              marginBottom: 12,
            }}
          >
            <Settings2 aria-hidden="true" size={18} strokeWidth={1.8} />
            <span>设置中心</span>
          </div>

          <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {SETTINGS_TABS.map((tab) => {
              const isActive = activeTab === tab.key;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  type="button"
                  data-testid={`settings-nav-${tab.key}`}
                  onClick={() => setActiveTab(tab.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 12px',
                    borderRadius: 6,
                    border: 'none',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 13,
                    fontWeight: isActive ? 600 : 400,
                    background: isActive ? 'var(--color-primary-light, #e0e7ff)' : 'transparent',
                    color: isActive
                      ? 'var(--color-primary, #4338ca)'
                      : 'var(--color-text-secondary, #475569)',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          data-testid="settings-back-home-btn"
          onClick={() => navigate('/')}
          style={{ width: '100%', marginTop: 16 }}
        >
          <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.8} />
          返回首页
        </button>
      </aside>

      {/* 2. 右侧对应分类配置面板 */}
      <main
        className="settings-content-pane"
        data-testid="settings-content-pane"
        style={{
          flex: 1,
          height: '100%',
          overflowY: 'auto',
          padding: '28px 36px',
        }}
      >
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          {/* 分类 1: 常规与外观 */}
          {activeTab === 'general' && (
            <div data-testid="settings-tab-pane-general">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 18,
                  fontWeight: 700,
                  marginBottom: 16,
                }}
              >
                <Palette aria-hidden="true" size={18} strokeWidth={1.8} />
                常规与外观偏好
              </div>
              <AppearanceSettingsCard />
              <AppUpdateSettingsCard />
            </div>
          )}

          {/* 分类 2: AI 模型与运行时 */}
          {activeTab === 'ai_models' && (
            <div data-testid="settings-tab-pane-ai-models">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 18,
                  fontWeight: 700,
                  marginBottom: 16,
                }}
              >
                <Bot aria-hidden="true" size={18} strokeWidth={1.8} />
                AI 模型服务与运行时
              </div>
              <AiRuntimeOverviewCard settings={settings} localHealthResult={localHealthResult} />
              <AiProviderSettingsCard
                settings={settings}
                message={message}
                testing={testing}
                update={update}
                handleTestConnection={handleTestConnection}
                onStopTest={() => connectionAbortRef.current?.abort()}
                handleSave={handleSave}
              />
              <LocalChapterModelSettingsCard
                settings={settings}
                onChange={update}
                onSave={handleSave}
                healthResult={localHealthResult}
                healthChecking={localHealthChecking}
                onCheckHealth={handleCheckLocalHealth}
              />
              <AiGatewaySettingsCard settings={settings} onChange={update} onSave={handleSave} />
            </div>
          )}

          {/* 分类 3: 网关与治理 */}
          {activeTab === 'governance' && (
            <div data-testid="settings-tab-pane-governance">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 18,
                  fontWeight: 700,
                  marginBottom: 16,
                }}
              >
                <ShieldCheck aria-hidden="true" size={18} strokeWidth={1.8} />
                AI 网关与流控治理
              </div>
              <AiGovernanceSettingsCard
                settings={settings}
                onChange={update}
                onSave={handleSave}
                refreshVersion={policySnapshotVersion}
              />
              <SecuritySettingsCard />
            </div>
          )}

          {/* 分类 4: 数据与存储 */}
          {activeTab === 'data' && (
            <div data-testid="settings-tab-pane-data">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 18,
                  fontWeight: 700,
                  marginBottom: 16,
                }}
              >
                <Database aria-hidden="true" size={18} strokeWidth={1.8} />
                本地数据与存储架构
              </div>
              <DataStorageSettingsCard />
            </div>
          )}

          {/* 分类 5: 诊断与关于 */}
          {activeTab === 'diagnostics' && (
            <div data-testid="settings-tab-pane-diagnostics">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 18,
                  fontWeight: 700,
                  marginBottom: 16,
                }}
              >
                <Search aria-hidden="true" size={18} strokeWidth={1.8} />
                系统诊断与关于
              </div>
              <DiagnosticsSettingsCard />
              <AboutSettingsCard />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

export default SettingsPage;
