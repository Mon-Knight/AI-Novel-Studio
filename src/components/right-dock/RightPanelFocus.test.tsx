import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import RightPanel from './RightPanel';

vi.mock('./panels/OutlinePanel', () => ({ default: () => <button>面板内容</button> }));

function FocusHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <textarea
        data-testid="chapter-editor"
        aria-label="正文"
        defaultValue="既有正文，继续阅读和编辑。"
      />
      <div className="right-toolbar">
        <button
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setOpen((value) => !value)}
        >
          大纲
        </button>
      </div>
      <button>其它控件</button>
      <RightPanel panelType={open ? 'outline' : null} onClose={() => setOpen(false)} />
    </>
  );
}

describe('non-modal review panel focus', () => {
  it('names the region without trapping focus and returns to the editor selection on close', async () => {
    const user = userEvent.setup();
    render(<FocusHarness />);
    const editor = screen.getByRole('textbox', { name: '正文' }) as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(2, 5);
    editor.scrollTop = 24;
    await user.click(screen.getByRole('button', { name: '大纲' }));
    const region = screen.getByRole('region', { name: '大纲查看' });
    expect(region.getAttribute('aria-modal')).toBeNull();
    expect(document.activeElement).toBe(editor);
    const content = await screen.findByRole('button', { name: '面板内容' });
    await user.click(content);
    fireEvent.keyDown(content, { key: 'Escape', keyCode: 229 });
    expect(screen.getByRole('region', { name: '大纲查看' })).toBe(region);
    fireEvent.keyDown(content, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(editor));
    expect([editor.selectionStart, editor.selectionEnd, editor.scrollTop]).toEqual([2, 5, 24]);
    expect(region.parentElement?.getAttribute('inert')).toBe('');
  });

  it('does not steal focus back when the user deliberately clicks outside the panel', async () => {
    const user = userEvent.setup();
    render(<FocusHarness />);
    await user.click(screen.getByRole('button', { name: '大纲' }));
    await user.click(await screen.findByRole('button', { name: '面板内容' }));
    const outside = screen.getByRole('button', { name: '其它控件' });
    await user.click(outside);
    expect(document.activeElement).toBe(outside);
    expect(screen.queryByRole('region', { name: '大纲查看' })).toBeNull();
  });

  it('preserves the latest reading position, not the opening snapshot, after a locate action', async () => {
    const user = userEvent.setup();
    render(<FocusHarness />);
    const editor = screen.getByRole('textbox', { name: '正文' }) as HTMLTextAreaElement;
    editor.focus();
    editor.setSelectionRange(0, 2);
    await user.click(screen.getByRole('button', { name: '大纲' }));
    await user.click(await screen.findByRole('button', { name: '面板内容' }));
    editor.setSelectionRange(5, 9);
    editor.scrollTop = 72;
    await user.click(screen.getByRole('button', { name: '关闭大纲查看' }));
    expect(document.activeElement).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd, editor.scrollTop]).toEqual([5, 9, 72]);
  });
});
