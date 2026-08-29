import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RightToolbar from './RightToolbar';

describe('RightToolbar', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('keeps review commands without exposing legacy history or AI panels in production', () => {
    const onRunCommand = vi.fn();
    const onTogglePanel = vi.fn();
    const onToggleReadiness = vi.fn();

    render(
      <RightToolbar
        activePanel="draft-history"
        onTogglePanel={onTogglePanel}
        onRunCommand={onRunCommand}
        onToggleReadiness={onToggleReadiness}
      />,
    );

    expect(screen.queryByText('草稿')).toBeNull();
    expect(screen.queryByText('AI生成')).toBeNull();
    expect(screen.getByText('保存')).not.toBeNull();
    expect(screen.getByText('准备')).not.toBeNull();
    expect(screen.getByText('总结')).not.toBeNull();
    expect(screen.getByText('排版')).not.toBeNull();
    expect(screen.getByText('采用')).not.toBeNull();

    fireEvent.click(screen.getByTestId('chapter-save'));
    fireEvent.click(screen.getByTestId('chapter-readiness-toggle'));
    fireEvent.click(screen.getByTestId('chapter-summary'));
    fireEvent.click(screen.getByTestId('chapter-adopt'));

    expect(onRunCommand).toHaveBeenCalledWith('save');
    expect(onRunCommand).toHaveBeenCalledWith('adopt-current');
    expect(onToggleReadiness).toHaveBeenCalledOnce();
    expect(onTogglePanel).toHaveBeenCalledWith('chapter-summary');
    expect(onTogglePanel).not.toHaveBeenCalledWith('draft-history');
  });

  it('keeps legacy history and AI panels available only in the E2E build', () => {
    vi.stubEnv('VITE_AI_NOVEL_STUDIO_E2E', '1');
    const onTogglePanel = vi.fn();

    render(
      <RightToolbar
        activePanel="draft-history"
        onTogglePanel={onTogglePanel}
        onRunCommand={vi.fn()}
        onToggleReadiness={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '收起草稿' }));
    expect(screen.getByText('AI生成')).not.toBeNull();
    expect(screen.getByText('工程')).not.toBeNull();
    expect(screen.getByText('设定')).not.toBeNull();
    expect(screen.getByText('检查')).not.toBeNull();
    expect(onTogglePanel).toHaveBeenCalledWith('draft-history');
  });

  it('exposes icon actions and toggle state without relying on symbol text', () => {
    const { container } = render(
      <RightToolbar
        activePanel="chapter-summary"
        onTogglePanel={vi.fn()}
        onRunCommand={vi.fn()}
        onToggleReadiness={vi.fn()}
        readinessOpen
      />,
    );

    const toolbar = screen.getByRole('toolbar', { name: '章节工具' });
    expect(toolbar.getAttribute('aria-orientation')).toBe('vertical');

    const readinessButton = screen.getByRole('button', { name: '收起准备' });
    const summaryButton = screen.getByRole('button', { name: '收起总结' });
    const saveButton = screen.getByRole('button', { name: '保存' });

    expect(readinessButton.getAttribute('aria-pressed')).toBe('true');
    expect(readinessButton.getAttribute('aria-expanded')).toBe('true');
    expect(summaryButton.classList.contains('active')).toBe(true);
    expect(summaryButton.getAttribute('aria-pressed')).toBe('true');
    expect(saveButton.hasAttribute('aria-pressed')).toBe(false);
    expect(container.querySelectorAll('.tb-icon svg')).toHaveLength(5);

    saveButton.focus();
    fireEvent.keyDown(saveButton, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '收起准备' }));
  });

  it('keeps unavailable document actions labelled and disabled', () => {
    render(
      <RightToolbar
        activePanel={null}
        onTogglePanel={vi.fn()}
        onRunCommand={vi.fn()}
        onToggleReadiness={vi.fn()}
        documentAvailable={false}
      />,
    );

    expect(
      (screen.getByRole('button', { name: '保存，完整正文不可用' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: '总结，完整正文不可用' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: '打开准备' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});
