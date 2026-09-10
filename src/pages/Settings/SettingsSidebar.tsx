import { HubSidebar, type SettingsTabKey } from '../../components/layout/HubSidebar';

export type { SettingsTabKey };

interface SettingsSidebarProps {
  activeTab: SettingsTabKey;
  onSelectTab: (tab: SettingsTabKey) => void;
}

/** The settings categories live inside the shared resource-center navigation. */
export function SettingsSidebar({ activeTab, onSelectTab }: SettingsSidebarProps) {
  return <HubSidebar activeSettingsTab={activeTab} onSelectSettingsTab={onSelectTab} />;
}
