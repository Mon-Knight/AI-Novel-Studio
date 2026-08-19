import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { confirmInfo } from '../../utils/nativeDialog';
import { aiSettingsService } from '../../services/ai/aiClient';
import { novelRepository } from '../../services/database/novelRepository';
import type { AiSettings } from '../../types/ai';
import { APP_VERSION, APP_PLATFORM_LABEL } from '../../constants/version';
import '../../styles/novel-detail.css';
import { describeUnknownError } from '../../utils/errorMessage';
import { isAiRequestCancelled } from '../../services/ai/aiCancellation';
import AppearanceSettingsCard from '../../components/settings/AppearanceSettingsCard';
import AiGovernanceSettingsCard from '../../components/settings/AiGovernanceSettingsCard';
import AiProviderSettingsCard from '../../components/settings/AiProviderSettingsCard';
import LocalChapterModelSettingsCard from '../../components/settings/LocalChapterModelSettingsCard';
import { checkLocalChapterModel, type LocalChapterModelHealthResult } from '../../services/ai/localChapterModelHealthService';
import DiagnosticsSettingsCard from '../../components/settings/DiagnosticsSettingsCard';
import AppUpdateSettingsCard from '../../components/settings/AppUpdateSettingsCard';

function SettingsPage() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<AiSettings>(aiSettingsService.getSettings());
  const [message, setMessage] = useState('');
  const [testing, setTesting] = useState(false);
  const [localHealthChecking, setLocalHealthChecking] = useState(false);
  const [localHealthResult, setLocalHealthResult] = useState<LocalChapterModelHealthResult | null>(null);
  const [repairMsg, setRepairMsg] = useState('');
  const [policySnapshotVersion, setPolicySnapshotVersion] = useState(0);
  const connectionAbortRef = useRef<AbortController | null>(null);
  const localHealthAbortRef = useRef<AbortController | null>(null);

  const handleRepairData = async () => {
    if (
      !(await confirmInfo({
        title: '数据修复',
        message: '将尝试修复异常作品数据，修复前会自动备份。是否继续？',
      }))
    )
      return;
    try {
      const result = await novelRepository.repairData();
      setRepairMsg(`✅ 修复完成：${result.before} 条 → ${result.after} 条（已备份原数据）`);
      setTimeout(() => setRepairMsg(''), 4000);
    } catch (e: unknown) {
      setRepairMsg(`❌ 修复失败：${describeUnknownError(e, '未知错误')}`);
    }
  };

  useEffect(() => {
    setSettings(aiSettingsService.getSettings());
    return () => {
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
      setLocalHealthResult(await checkLocalChapterModel(local, controller.signal));
    } catch (error) {
      if (!controller.signal.aborted) {
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

  const handleSave = async () => {
    // 保存前确保 mockMode 与 runtimeMode 一致
    const final = { ...settings, mockMode: settings.runtimeMode === 'mock' };
    try {
      await aiSettingsService.saveSettings(final);
      setSettings(aiSettingsService.getSettings());
      setPolicySnapshotVersion((version) => version + 1);
      setMessage('✅ AI 设置已保存，API Key 仅保留到本次应用会话结束');
    } catch (error) {
      setMessage(`❌ AI 设置保存失败：${describeUnknownError(error, '未知错误')}`);
    }
    setTimeout(() => setMessage(''), 2000);
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
      setMessage(result.ok ? `✅ 连接成功！（${latency}ms）` : `❌ 连接失败：${result.message}`);
    } catch (e: unknown) {
      setMessage(
        controller.signal.aborted || isAiRequestCancelled(e)
          ? '连接测试已停止'
          : `❌ 连接失败：${describeUnknownError(e, '未知错误')}`,
      );
    } finally {
      if (connectionAbortRef.current === controller) connectionAbortRef.current = null;
      setTesting(false);
    }
  };

  const update = (patch: Partial<AiSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      // 保持 mockMode 与 runtimeMode 同步
      if ('runtimeMode' in patch) {
        next.mockMode = next.runtimeMode === 'mock';
        next.provider =
          next.runtimeMode === 'mock'
            ? 'mock'
            : next.provider === 'mock'
              ? 'openai_compatible'
              : next.provider;
      }
      return next;
    });
  };

  return (
    <div
      style={{ padding: 32, maxWidth: 640, margin: '0 auto', height: '100%', overflowY: 'auto' }}
    >
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>⚙️ 设置中心</div>

      <AppearanceSettingsCard />
      <AppUpdateSettingsCard />

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
      <AiGovernanceSettingsCard
        settings={settings}
        onChange={update}
        onSave={handleSave}
        refreshVersion={policySnapshotVersion}
      />

      {/* 安全提示 */}
      <div
        className="detail-card"
        style={{
          marginBottom: 16,
          border: '1px solid var(--color-error-border)',
          background: 'var(--color-error-bg)',
        }}
      >
        <div style={{ fontSize: 14, color: 'var(--color-error-text)', lineHeight: 1.8 }}>
          <strong>⚠️ 安全提醒</strong>
          <ul style={{ paddingLeft: 18, marginTop: 4, fontSize: 13 }}>
            <li>API Key 仅保存在本地，不会上传到任何服务器</li>
            <li>请勿将 API Key 提交到 GitHub</li>
            <li>AI 任务记录不会保存完整 API Key</li>
          </ul>
        </div>
      </div>

      <DiagnosticsSettingsCard />

      <div className="detail-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>💾</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>数据与存储</span>
        </div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
          <div>存储方式：LocalStorage（浏览器模式）/ SQLite（Tauri 桌面模式）</div>
          <div>
            数据目录：<code>C:\Users\...\AppData\Local\AI Novel Studio\</code>
          </div>
          <div style={{ marginTop: 8 }}>
            <strong>📦 备份与恢复：</strong>
            <br />
            · 在导入导出中心或作品详情页使用「💾 备份完整 JSON」导出全部数据
            <br />
            · 在首页使用「📋 导入 JSON」恢复已备份的作品
            <br />· 备份文件包含作品、章节、草稿、设定、角色、事件等
          </div>
          <div style={{ marginTop: 8 }}>
            <strong>🔧 数据修复：</strong>
            <br />
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleRepairData}
              style={{ marginTop: 4 }}
            >
              🔧 修复异常作品数据
            </button>
            {repairMsg && (
              <div
                style={{
                  marginTop: 4,
                  fontSize: 12,
                  color: repairMsg.includes('✅') ? 'var(--color-success)' : 'var(--color-error)',
                }}
              >
                {repairMsg}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
              修复缺失字段、异常日期、损坏记录。修复前自动备份。
            </div>
          </div>
        </div>
      </div>

      <div className="detail-card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 18 }}>ℹ️</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>关于软件</span>
        </div>
        <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
          <div>
            <strong>AI Novel Studio {APP_VERSION}</strong>
          </div>
          <div>{APP_PLATFORM_LABEL} AI 小说创作工作台</div>
          <div>技术路线：Tauri + React + TypeScript + SQLite</div>
          <div>本地路径：F:\ai-novel-studio</div>
          <div>项目定位：逐章辅助完成长篇小说创作</div>
          <div style={{ marginTop: 8 }}>
            GitHub：
            <a href="https://github.com/Mon-Knight/AI-Novel-Studio" target="_blank" rel="noopener">
              Mon-Knight/AI-Novel-Studio
            </a>
          </div>
        </div>
      </div>

      <button className="btn btn-secondary" onClick={() => navigate('/')} style={{ marginTop: 8 }}>
        ← 返回首页
      </button>
    </div>
  );
}

export default SettingsPage;
