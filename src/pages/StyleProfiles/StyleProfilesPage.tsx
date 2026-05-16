import { useParams, useNavigate } from 'react-router-dom';

function StyleProfilesPage() {
  const navigate = useNavigate();

  return (
    <div className="flex-center" style={{ height: '100%', flexDirection: 'column', gap: 16 }}>
      <span style={{ fontSize: 48, opacity: 0.3 }}>🎨</span>
      <span style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)' }}>
        风格方案管理
      </span>
      <span className="text-secondary">该功能将在后续版本开放</span>
      <button
        className="btn btn-secondary"
        onClick={() => navigate('/')}
      >
        返回首页
      </button>
    </div>
  );
}

export default StyleProfilesPage;
