import { LoaderCircle } from 'lucide-react';

interface PanelLoaderIconProps {
  size?: number;
}

export function PanelLoaderIcon({ size = 14 }: PanelLoaderIconProps) {
  return (
    <LoaderCircle
      className="workspace-spinning-icon"
      aria-hidden="true"
      size={size}
      strokeWidth={1.8}
    />
  );
}
