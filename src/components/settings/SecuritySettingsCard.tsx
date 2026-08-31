import { TriangleAlert } from 'lucide-react';

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
          <li>API Key 仅保存在本地客户端内存或加密存储中，不会上传到任何中间服务器</li>
          <li>请勿将包含 API Key 的配置文件或代码提交到 GitHub 等公开仓库</li>
          <li>AI 任务与审计日志记录已进行凭据脱敏处理，绝不保存完整 API Key</li>
        </ul>
      </div>
    </div>
  );
}
