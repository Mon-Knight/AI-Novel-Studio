import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ImportJsonDialog from '../../components/import/ImportJsonDialog';
import ImportTxtDialog from '../../components/import/ImportTxtDialog';

const writes = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../../services/styles/outputProfileService', () => ({
  outputProfileService: { create: writes.create },
}));
vi.mock('../../lib/runWithLoading', () => ({
  runWithLoading: async (
    _options: unknown,
    action: (helpers: { setMessage: (message: string) => void }) => Promise<void>,
  ) => action({ setMessage: () => undefined }),
}));

beforeEach(() => {
  writes.create.mockReset();
});

describe('import dialog shared modal behavior', () => {
  it.each(['TXT', 'JSON'])(
    'exposes a named %s modal with a keyboard file chooser and Escape dismissal',
    async (type) => {
      const close = vi.fn();
      render(
        <MemoryRouter>
          {type === 'TXT' ? (
            <ImportTxtDialog onClose={close} />
          ) : (
            <ImportJsonDialog onClose={close} />
          )}
        </MemoryRouter>,
      );
      const dialog = screen.getByRole('dialog', {
        name: type === 'TXT' ? '导入 TXT 小说' : '导入 JSON 配置',
      });
      const chooser = screen.getByRole('button', { name: new RegExp(`点击选择 ${type} 文件`) });
      expect(document.activeElement).toBe(chooser);
      expect(dialog.classList.contains('modal-frame')).toBe(true);
      fireEvent.keyDown(chooser, { key: 'Escape' });
      expect(close).toHaveBeenCalledTimes(1);
      expect(writes.create).not.toHaveBeenCalled();
    },
  );

  it('keeps confirmation in the fixed footer and blocks dismissal while an import is pending', async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    let rejectImport: (error: Error) => void = () => undefined;
    writes.create.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectImport = reject;
        }),
    );
    render(
      <MemoryRouter>
        <ImportJsonDialog onClose={close} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByTestId('project-import-file'), {
      target: {
        files: [
          {
            name: 'isolated-output.json',
            text: async () => JSON.stringify({ name: '隔离输出', targetWordCount: 3200 }),
          },
        ],
      },
    });
    const confirm = await screen.findByTestId('project-import-confirm');
    expect(confirm.closest('.modal-frame-footer')).toBeTruthy();
    await user.click(confirm);
    await waitFor(() => expect(writes.create).toHaveBeenCalledTimes(1));
    const dialog = screen.getByTestId('project-import-dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(dialog.parentElement!);
    expect((screen.getByTestId('project-import-close') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true);
    expect(close).not.toHaveBeenCalled();
    await act(async () => rejectImport(new Error('隔离写入拒绝')));
    expect(await screen.findByText('隔离写入拒绝')).toBeTruthy();
    expect((screen.getByTestId('project-import-close') as HTMLButtonElement).disabled).toBe(false);
    expect(writes.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: '隔离输出', targetWordCount: 3200 }),
    );
  });
});
