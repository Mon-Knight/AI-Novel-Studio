import { TriangleAlert } from 'lucide-react';
import { getCredentialStorageCopy } from '../../services/ai/credentialStorageCopy';

export default function SecuritySettingsCard() {
  return (
    <div
      className="detail-card"
      data-testid="settings-security-card"
      style={{
        marginBottom: 16,
        border: '1px solid var(--color-error-border)',
        background: 'var(--color-error-bg)',
      }}
    >
      <div style={{ fontSize: 14, color: 'var(--color-error-text)', lineHeight: 1.8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <TriangleAlert aria-hidden="true" size={18} strokeWidth={1.8} />
          <strong>安全与合规提醒</strong>
        </div>
        <ul style={{ paddingLeft: 18, marginTop: 4, fontSize: 13 }}>
          <li>{getCredentialStorageCopy().storage}鉴权只发送到你明确配置的 Provider Endpoint。</li>
          <li>请勿将包含 API Key 的配置文件或代码提交到 GitHub 等公开仓库</li>
          <li>AI 任务与审计日志记录已进行凭据脱敏处理，绝不保存完整 API Key</li>
        </ul>
      </div>
    </div>
  );
}
