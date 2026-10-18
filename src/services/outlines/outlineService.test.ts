import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chapterOutlineService } from './outlineService';

const runtime = vi.hoisted(() => ({ desktop: false, invoke: vi.fn() }));
vi.mock('../tauri/runtime', () => ({
  isTauriRuntime: () => runtime.desktop,
  tauriInvoke: runtime.invoke,
}));

beforeEach(() => {
  runtime.desktop = false;
  runtime.invoke.mockReset();
});

describe('chapter outline persistence boundary', () => {
  it('rejects unsupported browser saves and adoption without changing existing browser data', async () => {
    const existing = JSON.stringify({ id: 'chapter', outline: '原材料', goal: '独立目标' });
    localStorage.setItem('outline-test-chapter', existing);
    await expect(
      chapterOutlineService.save({
        projectId: 'novel',
        chapterId: 'chapter',
        title: '章纲',
        content: '新材料',
      }),
    ).rejects.toThrow('浏览器模式暂不支持大纲持久化');
    await expect(chapterOutlineService.setActive('outline', 'novel')).rejects.toThrow(
      '浏览器模式暂不支持大纲持久化',
    );
    expect(localStorage.getItem('outline-test-chapter')).toBe(existing);
    expect(runtime.invoke).not.toHaveBeenCalled();
  });

  it('uses one native adoption command and surfaces transaction failure without a browser fallback', async () => {
    runtime.desktop = true;
    runtime.invoke.mockRejectedValueOnce(new Error('source projection transaction failed'));
    await expect(chapterOutlineService.setActive('outline', 'novel')).rejects.toThrow(
      'source projection transaction failed',
    );
    expect(runtime.invoke).toHaveBeenCalledExactlyOnceWith('set_active_chapter_outline', {
      input: { id: 'outline', projectId: 'novel' },
    });
  });
});
