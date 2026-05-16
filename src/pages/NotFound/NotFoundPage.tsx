/**
 * AI Novel Studio - 404 页面
 */
import { useNavigate } from 'react-router-dom';

function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <div style={{ textAlign: 'center', padding: 80, height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ fontSize: 64, marginBottom: 16 }}>🔍</div>
      <h2 style={{ marginBottom: 8 }}>页面不存在</h2>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 20 }}>你访问的路径可能已被移除或地址有误</p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={() => navigate('/')}>← 返回首页</button>
        <button className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>返回上一页</button>
      </div>
    </div>
  );
}

export default NotFoundPage;
