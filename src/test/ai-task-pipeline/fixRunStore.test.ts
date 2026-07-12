import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dbCall: vi.fn(),
  lsGet: vi.fn(),
  lsSet: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock('../../services/database/db', () => ({
  dbCall: mocks.dbCall,
  isTauri: mocks.isTauri,
  lsGet: mocks.lsGet,
  lsSet: mocks.lsSet,
  nowISO: () => '2026-07-12T16:00:00.000Z',
}));

import { fixRunStore } from '../../services/ai/fixRunStore';

describe('quality fix run persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauri.mockReturnValue(true);
  });

  it('wraps the Tauri payload under input and never falls back to localStorage', async () => {
    const run = {
      id: 'fix-a',
      novelId: 'novel-a',
      chapterId: 'chapter-a',
      sourceDraftId: 'draft-a',
      sourceDraftVersion: 5,
      sourceContentHash: 'hash-a',
      beforeReportId: 'report-a',
      beforeScore: 80,
      beforePendingCount: 2,
      beforeSeriousCount: 0,
      fixedIssueIds: [],
      newIssueIds: [],
      mode: 'conservative' as const,
      status: 'validated' as const,
      model: 'configured-model',
      createdAt: '2026-07-12T15:59:00.000Z',
      updatedAt: '2026-07-12T15:59:00.000Z',
    };
    mocks.dbCall.mockResolvedValue({ ...run });

    await fixRunStore.save(run);

    expect(mocks.dbCall).toHaveBeenCalledWith('save_quality_fix_run', {
      input: expect.objectContaining({
        id: 'fix-a',
        chapterId: 'chapter-a',
        status: 'validated',
      }),
    });
    expect(mocks.lsGet).not.toHaveBeenCalled();
    expect(mocks.lsSet).not.toHaveBeenCalled();
  });

  it('fails closed when the authoritative Tauri write fails', async () => {
    mocks.dbCall.mockRejectedValue(new Error('authoritative write failed'));

    await expect(fixRunStore.save({
      id: 'fix-b',
      novelId: 'novel-a',
      chapterId: 'chapter-a',
      sourceDraftId: 'draft-a',
      sourceDraftVersion: 5,
      sourceContentHash: 'hash-a',
      beforeReportId: 'report-a',
      fixedIssueIds: [],
      newIssueIds: [],
      mode: 'conservative',
      status: 'running',
      beforeScore: 80,
      beforePendingCount: 2,
      beforeSeriousCount: 0,
      createdAt: '2026-07-12T15:59:00.000Z',
      updatedAt: '2026-07-12T15:59:00.000Z',
    })).rejects.toThrow('authoritative write failed');
    expect(mocks.lsSet).not.toHaveBeenCalled();
  });
});
