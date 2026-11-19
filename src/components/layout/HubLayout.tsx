import type { ReactNode } from 'react';
import { HubSidebar } from './HubSidebar';
import '../../styles/hub.css';

/** Wraps a resource page (styles, templates, assets, records) in the resource-center frame. */
export function HubLayout({ children }: { children: ReactNode }) {
  return (
    <div className="settings-layout hub-layout" data-testid="hub-layout">
      <HubSidebar />
      <main className="hub-content" data-testid="hub-content">
        {children}
      </main>
    </div>
  );
}
