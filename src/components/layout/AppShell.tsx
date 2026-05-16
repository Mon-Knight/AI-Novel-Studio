import { ReactNode } from 'react';
import Sidebar from '../sidebar/Sidebar';
import TopBar from '../topbar/TopBar';
import '../../styles/app-shell.css';

interface AppShellProps {
  children: ReactNode;
}

function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <Sidebar />
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
