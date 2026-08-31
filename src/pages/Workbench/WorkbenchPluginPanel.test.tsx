import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentPluginProjection } from '../../services/conversation/currentPluginService';
import { PluginPanel } from './WorkbenchPluginPanel';

function plugin(status: CurrentPluginProjection['status'], name: string): CurrentPluginProjection {
  return {
    id: `plugin-${status}`,
    name,
    category: 'function',
    version: '1.0.0',
    description: '测试插件',
    status,
    availability: status === 'loaded' ? 'available' : 'unavailable',
    initialization: status === 'loaded' ? 'initialized' : 'failed',
    health: status === 'loaded' ? 'healthy' : 'failed',
    source: 'test',
    capabilities: ['test'],
  };
}

describe('WorkbenchPluginPanel', () => {
  it('localizes runtime status while preserving the raw diagnostic state', () => {
    render(
      <PluginPanel
        plugins={[
          plugin('loaded', '已加载插件'),
          plugin('failed', '失败插件'),
          plugin('unavailable', '不可用插件'),
        ]}
        onClose={vi.fn()}
      />,
    );

    const rows = screen.getAllByTestId('workbench-plugin-row');
    expect(rows.map((row) => row.getAttribute('data-status'))).toEqual([
      'loaded',
      'failed',
      'unavailable',
    ]);
    expect(screen.getByText('已加载', { selector: '.workbench-plugin-state' })).not.toBeNull();
    expect(screen.getByText('失败', { selector: '.workbench-plugin-state' })).not.toBeNull();
    expect(screen.getByText('不可用', { selector: '.workbench-plugin-state' })).not.toBeNull();
  });
});
