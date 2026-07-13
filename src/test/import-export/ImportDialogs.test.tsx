import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  readText: vi.fn(),
  importTxt: vi.fn(),
  executeJson: vi.fn(),
}));

vi.mock('../../services/import/systemFilePickerService', () => ({
  systemFilePickerService: {
    select: mocks.select,
    readText: mocks.readText,
  },
}));
vi.mock('../../services/import/projectImportService', () => ({ importTxtNovel: mocks.importTxt }));
vi.mock('../../services/import/jsonImportExecutionService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/import/jsonImportExecutionService')>();
  return { ...actual, executeJsonImport: mocks.executeJson };
});
vi.mock('../../lib/runWithLoading', () => ({
  runWithLoading: async (
    _options: unknown,
    task: (helpers: {
      setMessage: (message: string) => void;
      setStage: (stage: string) => void;
      setPercent: (percent: number) => void;
    }) => Promise<unknown>,
  ) => task({ setMessage: vi.fn(), setStage: vi.fn(), setPercent: vi.fn() }),
}));

import ImportJsonDialog from '../../components/import/ImportJsonDialog';
import ImportTxtDialog from '../../components/import/ImportTxtDialog';

const txtFile = {
  kind: 'txt' as const,
  name: '长篇测试.txt',
  path: 'D:\\小说\\长篇测试.txt',
  source: 'tauri' as const,
};
const jsonFile = {
  kind: 'json' as const,
  name: '项目备份.json',
  path: 'D:\\小说\\项目备份.json',
  source: 'tauri' as const,
};

function renderTxt() {
  return render(<MemoryRouter><ImportTxtDialog onClose={vi.fn()} /></MemoryRouter>);
}

function renderJson() {
  return render(<MemoryRouter><ImportJsonDialog onClose={vi.fn()} /></MemoryRouter>);
}

describe('system file import dialogs', () => {
  beforeEach(() => {
    mocks.select.mockReset();
    mocks.readText.mockReset();
    mocks.importTxt.mockReset();
    mocks.executeJson.mockReset();
  });

  it('keeps each dialog inside its fixed overlay so controls remain visible', () => {
    const txtView = renderTxt();
    expect(screen.getByRole('dialog', { name: '导入 TXT' }).closest('.import-dialog-overlay')).not.toBeNull();
    txtView.unmount();

    renderJson();
    expect(screen.getByRole('dialog', { name: '导入 JSON' }).closest('.import-dialog-overlay')).not.toBeNull();
  });

  it('does not report an error when the user cancels system file selection', async () => {
    mocks.select.mockResolvedValue(null);
    renderTxt();

    fireEvent.click(screen.getByRole('button', { name: '选择文件' }));

    await waitFor(() => expect(mocks.select).toHaveBeenCalledWith('txt'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.readText).not.toHaveBeenCalled();
  });

  it('shows name, path and parsing status before reading, then renders a TXT preview', async () => {
    mocks.select.mockResolvedValue(txtFile);
    mocks.readText.mockResolvedValue('第一章 初见\n这是正文。\n第二章 重逢\n这是第二章。');
    renderTxt();

    fireEvent.click(screen.getByRole('button', { name: '选择文件' }));
    expect(await screen.findByText(txtFile.name)).toBeTruthy();
    expect(screen.getByText(txtFile.path)).toBeTruthy();
    expect(screen.getByText('等待解析')).toBeTruthy();
    expect(mocks.readText).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '解析并预览' }));
    expect(await screen.findByText('解析完成')).toBeTruthy();
    expect(screen.getByTestId('txt-import-preview').textContent).toContain('导入预览');
    expect(screen.getByTestId('txt-import-preview').textContent).toContain('2 章');
  });

  it('clears an old preview when another file is selected', async () => {
    const replacement = { ...txtFile, name: '重新选择.txt', path: 'D:\\小说\\重新选择.txt' };
    mocks.select.mockResolvedValueOnce(txtFile).mockResolvedValueOnce(replacement);
    mocks.readText.mockResolvedValue('第一章\n正文');
    renderTxt();

    fireEvent.click(screen.getByRole('button', { name: '选择文件' }));
    fireEvent.click(await screen.findByRole('button', { name: '解析并预览' }));
    expect(await screen.findByTestId('txt-import-preview')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '重新选择文件' }));
    expect(await screen.findByText(replacement.name)).toBeTruthy();
    expect(screen.queryByTestId('txt-import-preview')).toBeNull();
    expect(screen.getByText('等待解析')).toBeTruthy();
  });

  it('uses a synchronous lock to prevent duplicate TXT imports', async () => {
    let resolveImport: ((value: unknown) => void) | undefined;
    mocks.select.mockResolvedValue(txtFile);
    mocks.readText.mockResolvedValue('第一章\n正文');
    mocks.importTxt.mockImplementation(() => new Promise((resolve) => { resolveImport = resolve; }));
    renderTxt();

    fireEvent.click(screen.getByRole('button', { name: '选择文件' }));
    fireEvent.click(await screen.findByRole('button', { name: '解析并预览' }));
    const confirm = await screen.findByTestId('confirm-txt-import');
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(mocks.importTxt).toHaveBeenCalledTimes(1);
    resolveImport?.({ novelId: 'new', novelTitle: '长篇测试', adoptedChapterCount: 1 });
  });

  it('shows JSON parsing errors without starting a formal import', async () => {
    mocks.select.mockResolvedValue(jsonFile);
    mocks.readText.mockResolvedValue('{not-json');
    renderJson();

    fireEvent.click(screen.getByRole('button', { name: '选择文件' }));
    fireEvent.click(await screen.findByRole('button', { name: '解析并预览' }));

    expect((await screen.findByRole('alert')).textContent).toContain('JSON 解析失败');
    expect(screen.getByText('解析失败')).toBeTruthy();
    expect(mocks.executeJson).not.toHaveBeenCalled();
  });

  it('shows the message from a structured Rust file-read error', async () => {
    mocks.select.mockResolvedValue(txtFile);
    mocks.readText.mockRejectedValue({
      code: 'IMPORT_FILE_ENCODING_INVALID',
      message: '文件不是有效的 UTF-8 文本，请转换编码后重试',
      retryable: false,
    });
    renderTxt();

    fireEvent.click(screen.getByRole('button', { name: '选择文件' }));
    fireEvent.click(await screen.findByRole('button', { name: '解析并预览' }));

    expect((await screen.findByRole('alert')).textContent).toContain('文件不是有效的 UTF-8 文本');
    expect(screen.getByText('解析失败')).toBeTruthy();
    expect(mocks.importTxt).not.toHaveBeenCalled();
  });

  it('imports JSON only after preview confirmation and reports success', async () => {
    mocks.select.mockResolvedValue(jsonFile);
    mocks.readText.mockResolvedValue(JSON.stringify({
      type: 'ai_novel_studio_project',
      novel: { title: '恢复作品' },
      volumes: [],
      chapters: [],
    }));
    mocks.executeJson.mockResolvedValue({ message: '作品导入成功。', destination: '/novels/new' });
    renderJson();

    fireEvent.click(screen.getByRole('button', { name: '选择文件' }));
    fireEvent.click(await screen.findByRole('button', { name: '解析并预览' }));
    expect(await screen.findByTestId('json-import-preview')).toBeTruthy();
    expect(mocks.executeJson).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('confirm-json-import'));
    expect((await screen.findByRole('status')).textContent).toContain('作品导入成功');
    expect(mocks.executeJson).toHaveBeenCalledTimes(1);
  });
});
