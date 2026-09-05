import { useState, useEffect, useRef } from 'react';
import { Bot, Database, Palette, Search, ShieldCheck } from 'lucide-react';
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
import { SettingsSidebar, type SettingsTabKey } from './SettingsSidebar';

export type { SettingsTabKey };

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
      <SettingsSidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onBackHome={() => navigate('/')}
      />

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
          {message && (
            <div
              style={{
                fontSize: 13,
                padding: '8px 14px',
                background: message.includes('失败')
                  ? 'var(--color-error-bg, #fee2e2)'
                  : 'var(--color-primary-light, #e0e7ff)',
                borderRadius: 6,
                marginBottom: 16,
                color: message.includes('失败')
                  ? 'var(--color-error, #b91c1c)'
                  : 'var(--color-primary, #4338ca)',
              }}
            >
              {message}
            </div>
          )}

          {/* 分类 1: 常规与外观 */}
          {activeTab === 'general' && (
            <div data-testid="settings-tab-pane-general">
              <div style={{ marginBottom: 20 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 20,
                    fontWeight: 700,
                    marginBottom: 6,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <Palette aria-hidden="true" size={20} strokeWidth={1.8} />
                  常规与外观偏好
                </div>
                <div className="text-sm text-muted">
                  配置桌面写作环境外观主题、版本更新以及基础交互偏好。
                </div>
              </div>
              <AppearanceSettingsCard />
              <AppUpdateSettingsCard />
            </div>
          )}

          {/* 分类 2: AI 模型与运行时 */}
          {activeTab === 'ai_models' && (
            <div data-testid="settings-tab-pane-ai-models">
              <div style={{ marginBottom: 20 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 20,
                    fontWeight: 700,
                    marginBottom: 6,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <Bot aria-hidden="true" size={20} strokeWidth={1.8} />
                  AI 模型服务与运行时
                </div>
                <div className="text-sm text-muted">
                  配置云端 API、本地离线模型与网关服务，管理模型凭据与运行健康。
                </div>
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
              <div style={{ marginBottom: 20 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 20,
                    fontWeight: 700,
                    marginBottom: 6,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <ShieldCheck aria-hidden="true" size={20} strokeWidth={1.8} />
                  AI 网关与流控治理
                </div>
                <div className="text-sm text-muted">
                  配置调用预算阈值、请求速率并发限制与安全审计规则。
                </div>
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
              <div style={{ marginBottom: 20 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 20,
                    fontWeight: 700,
                    marginBottom: 6,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <Database aria-hidden="true" size={20} strokeWidth={1.8} />
                  本地数据与存储架构
                </div>
                <div className="text-sm text-muted">
                  管理 SQLite 数据库健康、自动备份机制与数据完整性修复。
                </div>
              </div>
              <DataStorageSettingsCard />
            </div>
          )}

          {/* 分类 5: 诊断与关于 */}
          {activeTab === 'diagnostics' && (
            <div data-testid="settings-tab-pane-diagnostics">
              <div style={{ marginBottom: 20 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 20,
                    fontWeight: 700,
                    marginBottom: 6,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  <Search aria-hidden="true" size={20} strokeWidth={1.8} />
                  系统诊断与关于
                </div>
                <div className="text-sm text-muted">
                  查看运行环境诊断报告、系统组件版本与软件发行信息。
                </div>
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
