import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sourcePath = 'C:\\Users\\Writer\\reference.txt';
const sourceBytes = new TextEncoder().encode('第一章 开始\n可信原始字节🙂');
const open = vi.fn();
const readBinaryFile = vi.fn();
const inspectDuplicates = vi.fn();
const importReference = vi.fn();

vi.mock('@tauri-apps/api/dialog', () => ({ open }));
vi.mock('@tauri-apps/api/fs', () => ({ readBinaryFile }));
vi.mock('../../services/database/db', () => ({
  generateId: () => 'operation-fallback',
  isTauri: () => true,
}));
vi.mock('../../services/references/referenceLibraryService', () => ({
  referenceLibraryService: {
    inspectDuplicates,
    import: importReference,
  },
}));

const { default: ReferenceImportCard } =
  await import('../../components/references/ReferenceImportCard');

describe('ReferenceImportCard desktop source-byte trust boundary', () => {
  beforeEach(() => {
    open.mockReset().mockResolvedValue(sourcePath);
    readBinaryFile.mockReset().mockResolvedValue(sourceBytes);
    inspectDuplicates.mockReset().mockResolvedValue({
      novelId: 'novel-1',
      sourceHash: '',
      matches: [],
    });
    importReference.mockReset().mockImplementation(async (input) => ({
      action: 'createWork',
      created: true,
      bundle: { work: { id: 'work-created' } },
      input,
    }));
  });

  it('analyzes dialog-selected bytes and commits the same trusted desktop path', async () => {
    const onImported = vi.fn(async () => {});
    const onStatus = vi.fn();
    render(
      <ReferenceImportCard
        novelId="novel-1"
        works={[]}
        onImported={onImported}
        onStatus={onStatus}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '选择 TXT' }));

    expect(await screen.findByText('reference.txt')).toBeTruthy();
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ multiple: false, directory: false }),
    );
    expect(readBinaryFile).toHaveBeenCalledWith(sourcePath);
    fireEvent.click(screen.getByRole('button', { name: '确认导入' }));

    await waitFor(() => expect(importReference).toHaveBeenCalledTimes(1));
    const input = importReference.mock.calls[0][0];
    expect(input.sourceFilePath).toBe(sourcePath);
    expect(input.analysis.fileName).toBe('reference.txt');
    expect(input.analysis.sourceByteLength).toBe(sourceBytes.byteLength);
    expect(input.analysis.sourceHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(input.analysis.text).toBe('第一章 开始\n可信原始字节🙂');
    expect(onImported).toHaveBeenCalledWith('work-created');
  });
});
