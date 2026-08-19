import type { ComponentProps } from 'react';
import { multiAgentService } from '../../../services/multi-agent/multiAgentRuntime';
import MultiAgentPanel from './MultiAgentPanel';

type RuntimeProps = Omit<ComponentProps<typeof MultiAgentPanel>, 'service'>;

function MultiAgentPanelRuntime(props: RuntimeProps) {
  return <MultiAgentPanel {...props} service={multiAgentService} />;
}

export default MultiAgentPanelRuntime;
