/**
 * AI Novel Studio - 统一返回按钮组件
 */
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

interface BackButtonProps {
  label?: string;
  to?: string;
  fallbackTo?: string;
  onBeforeBack?: () => boolean | Promise<boolean>;
}

function BackButton({ label = '返回', to, fallbackTo = '/', onBeforeBack }: BackButtonProps) {
  const navigate = useNavigate();

  const handleClick = async () => {
    if (onBeforeBack && !(await onBeforeBack())) return;
    if (to) {
      navigate(to);
      return;
    }
    if (window.history.length > 2) {
      navigate(-1);
    } else {
      navigate(fallbackTo);
    }
  };

  return (
    <button className="back-button" onClick={handleClick} title={label}>
      <ArrowLeft aria-hidden="true" size={15} strokeWidth={1.8} />
      <span>{label}</span>
    </button>
  );
}

export default BackButton;
