import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OutlineRuntimeEntry } from '../../types/outlineGeneration';
const state = vi.hoisted(() => ({ native: vi.fn(), legacy: vi.fn(), settings: vi.fn() }));
vi.mock('../database/db', async (original) => ({
  ...(await original<typeof import('../database/db')>()),
  isTauri: () => true,
}));
vi.mock('../outlines/outlineRuntimeService', () => ({ generateNativeOutline: state.native }));
vi.mock('./aiClient', async (original) => {
  const value = await original<typeof import('./aiClient')>();
  return {
    ...value,
    createAiClient: state.legacy,
    aiSettingsService: { ...value.aiSettingsService, getSettings: state.settings },
  };
});
import { outlineGenerateService } from './outlineGenerateService';
beforeEach(() => {
  vi.clearAllMocks();
  state.legacy.mockImplementation(() => {
    throw new Error('desktop cannot use raw legacy client');
  });
  state.settings.mockImplementation(() => {
    throw new Error('desktop cannot use legacy request settings');
  });
  state.native.mockImplementation(async (_novel: string, request: OutlineRuntimeEntry) => ({
    format: request.format,
    value:
      request.format === 'editor_text'
        ? '总纲候选'
        : request.format === 'volume_candidate'
          ? { title: '卷候选', summary: '摘要', goal: '目标' }
          : [{ title: '章候选', outline: '提纲', runtimeIndex: 0 }],
  }));
});
describe('live outline production entry migration', () => {
  it('novel, volume and chapter public services all use native typed capability and retain their old return shapes', async () => {
    const onCandidate = vi.fn();
    expect(await outlineGenerateService.generateNovelOutline('novel', { onCandidate })).toBe(
      '总纲候选',
    );
    expect(
      await outlineGenerateService.generateVolumeOutline({
        novelId: 'novel',
        volumeId: 'volume',
        volumeTitle: '所选卷',
      }),
    ).toEqual({ title: '卷候选', summary: '摘要', goal: '目标' });
    expect(
      await outlineGenerateService.generateChapterOutlines({
        novelId: 'novel',
        volumeId: 'volume',
        chapterCount: 3,
      }),
    ).toEqual([{ title: '章候选', outline: '提纲', runtimeIndex: 0 }]);
    expect(state.native).toHaveBeenCalledTimes(3);
    expect(state.native.mock.calls[0]).toEqual([
      'novel',
      { kind: 'outline_generate', outlineType: 'master', format: 'editor_text' },
      { onCandidate },
    ]);
    expect(state.native.mock.calls[1][1]).toEqual(
      expect.objectContaining({ format: 'volume_candidate', targetId: 'volume' }),
    );
    expect(state.native.mock.calls[2][1]).toEqual(
      expect.objectContaining({
        format: 'chapter_candidates',
        volumeId: 'volume',
        chapterCount: 3,
      }),
    );
    expect(state.legacy).not.toHaveBeenCalled();
    expect(state.settings).not.toHaveBeenCalled();
  });
  it('native errors fail closed without calling the old business pipeline or raw model client', async () => {
    state.native.mockRejectedValueOnce(new Error('NATIVE_OUTLINE_SCOPE_CONFLICT'));
    await expect(outlineGenerateService.generateNovelOutline('novel')).rejects.toThrow(
      'NATIVE_OUTLINE_SCOPE_CONFLICT',
    );
    expect(state.native).toHaveBeenCalledOnce();
    expect(state.legacy).not.toHaveBeenCalled();
    expect(state.settings).not.toHaveBeenCalled();
  });
});
