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
  const isWritingWorkspace = /^\/novels\/[^/]+\/workspace\/?$/.test(location.pathname);

  return (
    <div className={`app-shell${isWritingWorkspace ? ' workspace-shell' : ''}`}>
      {!isWritingWorkspace && <Sidebar />}
      <div className="app-main">
        <TopBar />
        <div className="app-content">
          {children}
        </div>
      </div>
    </div>
  );
}

export default AppShell;
