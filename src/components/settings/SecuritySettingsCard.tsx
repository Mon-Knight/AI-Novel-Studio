import { TriangleAlert } from 'lucide-react';
import { getCredentialStorageCopy } from '../../services/ai/credentialStorageCopy';

export default function SecuritySettingsCard() {
  return (
    <div className="detail-card settings-danger-card" data-testid="settings-security-card">
      <div className="settings-danger-text">
        <div className="settings-danger-title">
          <TriangleAlert aria-hidden="true" size={18} strokeWidth={1.8} />
          <strong>安全与合规提醒</strong>
        </div>
        <ul className="settings-danger-list">
          <li>{getCredentialStorageCopy().storage}鉴权只发送到你明确配置的 Provider Endpoint。</li>
          <li>请勿将包含 API Key 的配置文件或代码提交到 GitHub 等公开仓库</li>
          <li>AI 任务与审计日志记录已进行凭据脱敏处理，绝不保存完整 API Key</li>
        </ul>
      </div>
    </div>
  );
}
