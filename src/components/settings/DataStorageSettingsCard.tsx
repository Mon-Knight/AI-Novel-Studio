import { useState } from 'react';
import { novelRepository } from '../../services/database/novelRepository';
import { getDbMode } from '../../services/database/db';
import { confirmInfo } from '../../utils/nativeDialog';
import { describeUnknownError } from '../../utils/errorMessage';

export default function DataStorageSettingsCard() {
  const [repairMsg, setRepairMsg] = useState('');
  const [repairing, setRepairing] = useState(false);

  const handleRepairData = async () => {
    if (
      !(await confirmInfo({
        title: '数据修复',
        message:
          getDbMode() === 'tauri'
            ? '将对 SQLite 作品基础字段执行可回滚事务并检查完整性。是否继续？'
            : '将修复浏览器开发数据，并在修复前创建 LocalStorage 备份。是否继续？',
      }))
    ) {
      return;
    }

    setRepairing(true);
    try {
      const result = await novelRepository.repairData();
      if (result.storage === 'sqlite') {
        setRepairMsg(
          result.integrityOk
            ? `✅ SQLite 检查完成：${result.repairedCount} 条记录已规范化，完整性正常`
            : `⚠️ SQLite 检查发现问题：${result.integrityMessage}，外键问题 ${result.foreignKeyViolations ?? 0} 条`,
        );
      } else {
        setRepairMsg(
          `✅ 浏览器数据修复完成：${result.before} 条 → ${result.after} 条（已自动备份原数据）`,
        );
      }
      setTimeout(() => setRepairMsg(''), 5000);
    } catch (e: unknown) {
      setRepairMsg(`❌ 修复失败：${describeUnknownError(e, '未知错误')}`);
    } finally {
      setRepairing(false);
    }
  };

  return (
    <div
      className="detail-card"
      data-testid="settings-data-storage-card"
      style={{ marginBottom: 16 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 18 }}>💾</span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>数据与存储架构</span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
        <div>
          <strong>存储引擎：</strong> SQLite（Tauri 桌面模式）/ LocalStorage（开发调试模式）
        </div>
        <div>
          <strong>数据根目录：</strong> <code>%LOCALAPPDATA%\AI Novel Studio\</code>
        </div>
        <div
          style={{
            marginTop: 10,
            padding: 10,
            background: 'var(--color-bg-hover, #f8fafc)',
            borderRadius: 6,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--color-text-primary)' }}>
            📦 备份与安全恢复机制
          </div>
          <div>· 在「导入导出中心」或「作品详情页」可导出完整 JSON 数据备份文件</div>
          <div>· 在首页「导入 JSON」可完整恢复作品、章节、草稿、设定、角色与事件状态</div>
          <div>· 支持章节不可变版本（Revision）与创作溯源数据持久化归档</div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--color-text-primary)' }}>
            🔧 数据库异常诊断与修复
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleRepairData}
            disabled={repairing}
            data-testid="settings-repair-data-btn"
            style={{ marginTop: 4 }}
          >
            {repairing ? '正在扫描修复...' : '🔧 扫描并修复异常作品数据'}
          </button>
          {repairMsg && (
            <div
              data-testid="settings-repair-message"
              style={{
                marginTop: 6,
                fontSize: 12,
                color: repairMsg.includes('✅')
                  ? 'var(--color-success, #16a34a)'
                  : 'var(--color-error, #dc2626)',
              }}
            >
              {repairMsg}
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4 }}>
            桌面端规范化 SQLite 作品基础字段并执行完整性检查；浏览器开发模式会先生成 LocalStorage
            安全镜像。
          </div>
        </div>
      </div>
    </div>
  );
}
