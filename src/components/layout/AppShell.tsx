import { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import Sidebar from '../sidebar/Sidebar';
import TopBar from '../topbar/TopBar';
import '../../styles/app-shell.css';

interface AppShellProps {
  children: ReactNode;
}

function AppShell({ children }: AppShellProps) {
  const location = useLocation();
  const usesWorkbenchShell = location.pathname === '/';

  return (
    <div
      className={usesWorkbenchShell ? 'app-shell app-shell--workbench' : 'app-shell'}
      data-testid="app-shell"
      data-layout={usesWorkbenchShell ? 'workbench' : 'standard'}
    >
      <Sidebar compact={usesWorkbenchShell} />
      <div className="app-main">
        {!usesWorkbenchShell && <TopBar />}
        <div className="app-content">{children}</div>
      </div>
    </div>
  );
}

export default AppShell;
