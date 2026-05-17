/**
 * AI Novel Studio - 统一返回按钮组件
 */
import { useNavigate } from 'react-router-dom';

interface BackButtonProps {
  label?: string;
  to?: string;
  fallbackTo?: string;
  onBeforeBack?: () => boolean; // 返回 true 则继续，false 则取消
}

function BackButton({ label = '返回', to, fallbackTo = '/', onBeforeBack }: BackButtonProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (onBeforeBack && !onBeforeBack()) return;
    if (to) { navigate(to); return; }
    if (window.history.length > 2) { navigate(-1); }
    else { navigate(fallbackTo); }
  };

  return (
    <button className="back-button" onClick={handleClick} title={label}>
      ← <span style={{ marginLeft: 4 }}>{label}</span>
    </button>
  );
}

export default BackButton;
