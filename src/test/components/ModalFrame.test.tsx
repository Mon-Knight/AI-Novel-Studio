import { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ModalFrame } from '../../components/common/ModalFrame';
import { VolumeTreeDialogs } from '../../components/workspace/VolumeTreeDialogs';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';

function FrameHarness({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen(true)}>打开</button>
      <aside data-testid="outside">背景区域</aside>
      <main>
        {open && (
          <ModalFrame
            title="编辑作品"
            busy={busy}
            onDismiss={() => setOpen(false)}
            initialFocusSelector='[aria-label="标题"]'
            footer={
              <button onClick={() => setOpen(false)} disabled={busy}>
                完成
              </button>
            }
          >
            <label>
              标题
              <input aria-label="标题" />
            </label>
            <button disabled>不可用</button>
            <button hidden>隐藏</button>
            <p>长内容</p>
          </ModalFrame>
        )}
      </main>
    </div>
  );
}

describe('shared modal focus and dismissal', () => {
  it('keeps only the top modal interactive when sibling dialogs mount in the same commit', () => {
    const view = render(
      <>
        <button>背景操作</button>
        <ModalFrame title="同批底层">
          <button>底层按钮</button>
        </ModalFrame>
        <ModalFrame title="同批顶层">
          <button>顶层按钮</button>
        </ModalFrame>
      </>,
    );
    const top = screen.getByRole('dialog', { name: '同批顶层' });
    expect(top.closest('[inert], [aria-hidden="true"]')).toBeNull();
    expect(screen.queryByRole('dialog', { name: '同批底层' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '顶层按钮' }));
    view.rerender(
      <>
        <button>背景操作</button>
        <ModalFrame title="同批底层">
          <button>底层按钮</button>
        </ModalFrame>
      </>,
    );
    expect(screen.getByRole('dialog', { name: '同批底层' }).closest('[inert]')).toBeNull();
    expect(screen.getByRole('dialog', { name: '同批底层' }).contains(document.activeElement)).toBe(
      true,
    );
    view.unmount();
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('gives a newly opened modal priority over earlier global keyboard shortcuts', () => {
    const backgroundAction = vi.fn();
    function ShortcutsHarness() {
      useKeyboardShortcuts([{ key: 'Escape', action: backgroundAction }]);
      return <FrameHarness />;
    }
    render(<ShortcutsHarness />);
    fireEvent.click(screen.getByRole('button', { name: '打开' }));
    const finish = screen.getByRole('button', { name: '完成' });
    finish.focus();
    fireEvent.keyDown(finish, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(backgroundAction).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });
    expect(backgroundAction).toHaveBeenCalledTimes(1);
  });

  it('names the dialog, isolates ancestor siblings, traps visible focus, and restores the opener', async () => {
    const user = userEvent.setup();
    render(<FrameHarness />);
    const opener = screen.getByRole('button', { name: '打开' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: '编辑作品' });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '标题' }));
    expect(screen.getByTestId('outside').getAttribute('inert')).toBe('');
    expect(opener.getAttribute('aria-hidden')).toBe('true');
    const first = within(dialog).getByRole('button', { name: '关闭' });
    const last = within(dialog).getByRole('button', { name: '完成' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(opener.hasAttribute('inert')).toBe(false);
    expect(opener.hasAttribute('aria-hidden')).toBe(false);
  });

  it('blocks busy Escape/backdrop/close and ignores IME Escape', async () => {
    const user = userEvent.setup();
    const view = render(<FrameHarness busy />);
    await user.click(screen.getByRole('button', { name: '打开' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(dialog.parentElement!);
    expect((screen.getByRole('button', { name: '关闭' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('dialog')).toBe(dialog);
    view.rerender(<FrameHarness />);
    fireEvent.keyDown(dialog, { key: 'Escape', keyCode: 229 });
    expect(screen.getByRole('dialog')).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps header/footer outside the only scrolling form body', () => {
    render(
      <ModalFrame title="长表单" footer={<button>保存</button>}>
        <textarea aria-label="正文" />
      </ModalFrame>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector(':scope > .modal-frame-header .modal-title')).toBeTruthy();
    expect(dialog.querySelector(':scope > .modal-frame-body textarea')).toBeTruthy();
    expect(dialog.querySelector(':scope > .modal-frame-footer button')).toBeTruthy();
    expect(dialog.querySelector('.modal-frame-body .modal-frame-footer')).toBeNull();
  });

  it('lets an inner disclosure consume Escape before dismissing the enclosing modal', () => {
    const dismiss = vi.fn();
    render(
      <ModalFrame title="含搜索的表单" onDismiss={dismiss}>
        <input
          aria-label="搜索"
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.preventDefault();
          }}
        />
      </ModalFrame>,
    );
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(dismiss).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('restores a text selection and scroll snapshot without changing its value', () => {
    const opener = document.createElement('textarea');
    opener.value = '既有正文，保持选区和阅读位置。';
    document.body.append(opener);
    opener.focus();
    opener.setSelectionRange(2, 6);
    opener.scrollTop = 38;
    const view = render(
      <ModalFrame title="确认" onDismiss={() => undefined}>
        <button>取消</button>
      </ModalFrame>,
    );
    view.unmount();
    expect(document.activeElement).toBe(opener);
    expect([opener.selectionStart, opener.selectionEnd, opener.scrollTop]).toEqual([2, 6, 38]);
    expect(opener.value).toBe('既有正文，保持选区和阅读位置。');
    opener.remove();
  });

  it('only lets the top stacked modal consume Escape and restores the previous modal', async () => {
    function Stacked() {
      const [inner, setInner] = useState(false);
      return (
        <>
          <ModalFrame title="外层" onDismiss={() => undefined}>
            <button onClick={() => setInner(true)}>打开确认</button>
          </ModalFrame>
          {inner && (
            <ModalFrame title="确认" onDismiss={() => setInner(false)}>
              <button>确定</button>
            </ModalFrame>
          )}
        </>
      );
    }
    const user = userEvent.setup();
    render(<Stacked />);
    const opener = screen.getByRole('button', { name: '打开确认' });
    await user.click(opener);
    const top = screen.getByRole('dialog', { name: '确认' });
    fireEvent.keyDown(top, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '确认' })).toBeNull());
    expect(screen.getByRole('dialog', { name: '外层' })).toBeTruthy();
    expect(document.activeElement).toBe(opener);
  });
});

describe('volume creation IME safety', () => {
  it('does not create a volume while the IME owns Enter or creation is busy', () => {
    const create = vi.fn();
    const props = {
      volumes: [],
      showNewVolume: true,
      newVolumeTitle: '第一卷',
      showNewChapter: false,
      newChapterTitle: '',
      newChapterTargetWordCount: '3000',
      newChapterVolumeId: '',
      creating: false,
      volumePlaceholder: '分卷名称',
      onCloseVolume: vi.fn(),
      onCloseChapter: vi.fn(),
      onVolumeTitleChange: vi.fn(),
      onChapterTitleChange: vi.fn(),
      onChapterTargetWordCountChange: vi.fn(),
      onChapterVolumeChange: vi.fn(),
      onCreateVolume: create,
      onCreateChapter: vi.fn(),
    };
    const view = render(<VolumeTreeDialogs {...props} />);
    const input = screen.getByRole('textbox', { name: '分卷名称' });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    expect(create).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(create).toHaveBeenCalledTimes(1);
    view.rerender(<VolumeTreeDialogs {...props} creating />);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});
