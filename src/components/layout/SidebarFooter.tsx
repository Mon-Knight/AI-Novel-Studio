import type { ReactNode } from 'react';
import { APP_VERSION } from '../../constants/version';

interface SidebarFooterProps {
  className?: string;
  action?: ReactNode;
}

/** ZCode-style identity row shared by the global sidebar and the workbench tree. */
export function SidebarFooter({ className = '', action }: SidebarFooterProps) {
  return (
    <div className={`sidebar-footer ${className}`.trim()}>
      <span className="sidebar-avatar" aria-hidden="true">
        AI
      </span>
      <span className="sidebar-footer-copy">
        <span className="sidebar-footer-name">AI Novel Studio</span>
        <span className="version">{APP_VERSION}</span>
      </span>
      {action}
    </div>
  );
}
