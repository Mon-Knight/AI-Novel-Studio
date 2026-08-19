import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReferenceWorkBundle } from '../../types/reference';

const listWorks = vi.fn();
const getBundle = vi.fn();
const activateImport = vi.fn();
const deleteWork = vi.fn();
const inspectDuplicates = vi.fn();
const importReference = vi.fn();
const createStyle = vi.fn();

vi.mock('../../services/references/referenceLibraryService', () => ({
  referenceLibraryService: {
    listWorks,
    getBundle,
    activateImport,
    deleteWork,
    inspectDuplicates,
    import: importReference,
  },
}));

vi.mock('../../services/references/referenceStyleProfileService', () => ({
  createReferenceStyleProfile: createStyle,
}));

vi.mock('../../utils/nativeDialog', () => ({
  confirmDanger: vi.fn(async () => true),
}));

const { default: ReferenceLibraryPage } =
  await import('../../pages/ReferenceLibrary/ReferenceLibraryPage');

function fixture(): ReferenceWorkBundle {
  const work = {
    id: 'work-1',
    novelId: 'novel-1',
    title: '风格参考作品',
    purpose: 'style' as const,
    description: '用于验证分层风格分析',
    activeImportId: 'import-2',
    activeSourceHash: 'b'.repeat(64),
    revision: 2,
    sourceStatus: 'available' as const,
    sectionCount: 1,
    totalChars: 1200,
    createdAt: '2026-07-27T00:00:00Z',
    updatedAt: '2026-07-28T00:00:00Z',
  };
  return {
    work,
    imports: [
      {
        id: 'import-2',
        workId: work.id,
        novelId: work.novelId,
        version: 2,
        isCurrent: true,
        operationId: 'operation-2',
        fileName: 'reference-v2.txt',
        fileType: 'txt',
        encoding: 'utf-8',
        encodingSource: 'utf8_valid',
        sourceHash: 'b'.repeat(64),
        decodedTextHash: 'c'.repeat(64),
        sourceByteLength: 1200,
        decodedUtf8ByteLength: 1200,
        totalChars: 1200,
        sectionCount: 1,
        parserVersion: 'reference_txt_parser_v1',
        sectionPlanHash: 'd'.repeat(64),
        warnings: [],
        importedAt: '2026-07-28T00:00:00Z',
      },
      {
        id: 'import-1',
        workId: work.id,
        novelId: work.novelId,
        version: 1,
        isCurrent: false,
        operationId: 'operation-1',
        fileName: 'reference-v1.txt',
        fileType: 'txt',
        encoding: 'utf-16le',
        encodingSource: 'bom',
        sourceHash: 'a'.repeat(64),
        decodedTextHash: 'e'.repeat(64),
        sourceByteLength: 1000,
        decodedUtf8ByteLength: 1000,
        totalChars: 1000,
        sectionCount: 1,
        parserVersion: 'reference_txt_parser_v1',
        sectionPlanHash: 'f'.repeat(64),
        warnings: [],
        importedAt: '2026-07-27T00:00:00Z',
      },
    ],
    sections: [
      {
        id: 'section-1',
        importId: 'import-2',
        workId: work.id,
        novelId: work.novelId,
        orderIndex: 1,
        title: '第一章',
        contentHash: '1'.repeat(64),
        charCount: 1200,
        sourceStartUtf16: 0,
        sourceEndUtf16: 1200,
      },
    ],
    sectionTotal: 1,
    sectionOffset: 0,
    sectionLimit: 100,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/novels/novel-1/references']}>
      <Routes>
        <Route path="/novels/:novelId/references" element={<ReferenceLibraryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ReferenceLibraryPage', () => {
  beforeEach(() => {
    const data = fixture();
    listWorks.mockResolvedValue([data.work]);
    getBundle.mockResolvedValue(data);
    activateImport.mockResolvedValue({
      ...data,
      work: { ...data.work, activeImportId: 'import-1', revision: 3 },
      imports: data.imports.map((item) => ({ ...item, isCurrent: item.id === 'import-1' })),
    });
    inspectDuplicates.mockResolvedValue({ novelId: 'novel-1', sourceHash: '', matches: [] });
    createStyle.mockResolvedValue({
      profile: { id: 'style-1', name: '分层画像' },
      analysis: {},
    });
  });

  it('renders a scoped desktop library with versions and paged section metadata', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: '参考资料库' })).toBeTruthy();
    expect((await screen.findAllByText('风格参考作品')).length).toBeGreaterThan(0);
    expect(screen.getByText('用于验证分层风格分析')).toBeTruthy();
    expect(screen.getByText('reference-v2.txt', { exact: false })).toBeTruthy();
    expect(screen.getByText('第一章', { exact: false })).toBeTruthy();
    expect(screen.getByText(/当前章节与片段（1-1 \/ 1）/u)).toBeTruthy();
    expect(screen.queryByText('参考片段正文。', { exact: false })).toBeNull();
    expect(listWorks).toHaveBeenCalledWith('novel-1');
    expect(getBundle).toHaveBeenCalledWith('novel-1', 'work-1');
  });

  it('uses revision-checked version activation and saves abstract style analysis', async () => {
    renderPage();
    await screen.findByText('reference-v1.txt', { exact: false });

    fireEvent.click(screen.getByRole('button', { name: '设为当前' }));
    await waitFor(() => {
      expect(activateImport).toHaveBeenCalledWith('novel-1', 'work-1', 'import-1', 2);
    });

    fireEvent.click(screen.getByRole('button', { name: '生成分层风格画像' }));
    await waitFor(() => expect(createStyle).toHaveBeenCalled());
    expect(await screen.findByText(/风格画像“分层画像”已保存/u)).toBeTruthy();
  });

  it('requests the next metadata page without loading section bodies', async () => {
    const first = fixture();
    first.sectionTotal = 250;
    first.sectionLimit = 100;
    first.sections = Array.from({ length: 100 }, (_value, index) => ({
      ...first.sections[0],
      id: `section-${index + 1}`,
      orderIndex: index + 1,
      title: `Chapter ${index + 1}`,
    }));
    const second = {
      ...first,
      sectionOffset: 100,
      sections: Array.from({ length: 100 }, (_value, index) => ({
        ...first.sections[0],
        id: `section-${index + 101}`,
        orderIndex: index + 101,
        title: `Chapter ${index + 101}`,
      })),
    };
    listWorks.mockResolvedValue([first.work]);
    getBundle.mockImplementation(async (_novelId: string, _workId: string, offset?: number) =>
      offset === 100 ? second : first,
    );

    renderPage();
    expect(await screen.findByText(/当前章节与片段（1-100 \/ 250）/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));

    await waitFor(() => expect(getBundle).toHaveBeenCalledWith('novel-1', 'work-1', 100, 100));
    expect(await screen.findByText(/当前章节与片段（101-200 \/ 250）/u)).toBeTruthy();
    expect(screen.getByText('Chapter 101', { exact: false })).toBeTruthy();
  });
});
