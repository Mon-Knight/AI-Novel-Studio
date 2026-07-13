import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  readTextFile: vi.fn(),
}));

vi.mock('../../services/tauri/runtime', () => ({
  isTauriRuntime: () => true,
}));
vi.mock('@tauri-apps/api/dialog', () => ({ open: mocks.open }));
vi.mock('@tauri-apps/api/fs', () => ({ readTextFile: mocks.readTextFile }));

import {
  readSelectedImportFile,
  selectImportFile,
  validateImportFilePath,
} from '../../services/import/systemFilePickerService';

describe('system import file picker', () => {
  beforeEach(() => {
    mocks.open.mockReset();
    mocks.readTextFile.mockReset();
  });

  it('treats cancelling the system picker as a normal no-selection result', async () => {
    mocks.open.mockResolvedValue(null);

    await expect(selectImportFile('txt')).resolves.toBeNull();
    expect(mocks.readTextFile).not.toHaveBeenCalled();
  });

  it('limits the system picker to the requested existing format', async () => {
    mocks.open.mockResolvedValue('D:\\books\\novel.txt');

    await expect(selectImportFile('txt')).resolves.toMatchObject({
      name: 'novel.txt',
      path: 'D:\\books\\novel.txt',
      kind: 'txt',
    });
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({
      multiple: false,
      filters: [{ name: 'TXT 小说文本', extensions: ['txt'] }],
    }));
  });

  it('rejects a mismatched extension even if a picker implementation returns it', async () => {
    mocks.open.mockResolvedValue('D:\\books\\novel.exe');

    await expect(selectImportFile('txt')).rejects.toThrow('文件格式不受支持');
    expect(() => validateImportFilePath('backup.txt', 'json')).toThrow('文件格式不受支持');
  });

  it('reads a selected desktop file only in the explicit parsing phase', async () => {
    mocks.readTextFile.mockResolvedValue('第一章\n正文');
    const selected = {
      kind: 'txt' as const,
      name: 'novel.txt',
      path: 'D:\\books\\novel.txt',
      source: 'tauri' as const,
    };

    await expect(readSelectedImportFile(selected)).resolves.toBe('第一章\n正文');
    expect(mocks.readTextFile).toHaveBeenCalledWith(selected.path);
  });
});
