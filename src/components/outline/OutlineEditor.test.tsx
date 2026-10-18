import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChapterOutline,
  MasterOutline,
  OutlineType,
  VolumeOutline,
} from '../../types/outline';
import OutlineEditor from './OutlineEditor';

const services = vi.hoisted(() => {
  const service = () => ({
    getActive: vi.fn(),
    getVersions: vi.fn(),
    save: vi.fn(),
    setActive: vi.fn(),
  });
  return { master: service(), volume: service(), chapter: service() };
});

vi.mock('../../services/outlines/outlineService', () => ({
  masterOutlineService: services.master,
  volumeOutlineService: services.volume,
  chapterOutlineService: services.chapter,
  loadOutlineContext: vi.fn(),
}));
vi.mock('../../lib/runWithLoading', () => ({
  runWithLoading: async (_options: unknown, execute: () => Promise<void>) => execute(),
  cancelLoadingOperation: vi.fn(),
}));
vi.mock('../../utils/reportAndPresentError', () => ({ reportAndPresentError: vi.fn() }));

type Outline = MasterOutline | VolumeOutline | ChapterOutline;

function outline(version: number, isActive = false): Outline {
  return {
    id: `outline-${version}`,
    projectId: 'novel-1',
    chapterId: 'chapter-14',
    chapterIndex: 14,
    title: `章纲标题 ${version}`,
    content: `已保存章纲 ${version}`,
    status: isActive ? 'active' : 'draft',
    version,
    isActive,
    sourceType: 'manual',
    createdAt: '2026-10-15T00:00:00Z',
    updatedAt: '2026-10-15T00:00:00Z',
  };
}

function setup(type: OutlineType = 'chapter', versions = [outline(2), outline(1, true)]) {
  const service = services[type];
  service.getActive.mockImplementation(async () => versions.find((version) => version.isActive));
  service.getVersions.mockImplementation(async () => [...versions]);
  service.save.mockImplementation(async (input: { title: string; content: string }) => {
    const saved = { ...outline(3), title: input.title, content: input.content };
    versions.unshift(saved);
    return saved;
  });
  service.setActive.mockImplementation(async (id: string) => {
    versions.forEach((version) => {
      version.isActive = version.id === id;
    });
  });
  render(
    <OutlineEditor
      projectId="novel-1"
      outlineType={type}
      targetId={type === 'master' ? undefined : 'target-1'}
      targetTitle="标题"
      targetIndex={14}
    />,
  );
  return { service, versions };
}

beforeEach(() => vi.clearAllMocks());

describe('OutlineEditor saved version selection', () => {
  for (const type of ['master', 'volume', 'chapter'] as const) {
    it(`${type}: keeps a new save visible until explicit adoption`, async () => {
      const { service, versions } = setup(type);
      const content = await screen.findByDisplayValue('已保存章纲 1');
      fireEvent.change(content, { target: { value: '第十四章仅疑似身份关联' } });
      fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }));

      await screen.findByRole('button', { name: '查看版本 v3', pressed: true });
      expect(screen.getByDisplayValue('第十四章仅疑似身份关联')).not.toBeNull();
      expect(service.save).toHaveBeenCalledWith(
        expect.objectContaining({ content: '第十四章仅疑似身份关联', saveAsNewVersion: true }),
      );
      expect(service.setActive).not.toHaveBeenCalled();
      expect(versions.find((version) => version.id === 'outline-1')?.isActive).toBe(true);
      expect(versions.find((version) => version.id === 'outline-1')?.content).toBe('已保存章纲 1');

      fireEvent.click(screen.getByRole('button', { name: '设为采用版本' }));
      await waitFor(() => expect(service.setActive).toHaveBeenCalledWith('outline-3', 'novel-1'));
      await screen.findByRole('button', { name: '查看版本 v3（当前采用）', pressed: true });
    });
  }

  it('lets keyboard users select a saved historical title and content without adopting it', async () => {
    const { service } = setup();
    await screen.findByDisplayValue('已保存章纲 1');
    const version = screen.getByRole('button', { name: '查看版本 v2' });
    const user = userEvent.setup();
    version.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByDisplayValue('已保存章纲 2')).not.toBeNull();
    expect(screen.getByDisplayValue('章纲标题 2')).not.toBeNull();
    expect(version.getAttribute('aria-pressed')).toBe('true');
    expect(service.setActive).not.toHaveBeenCalled();
    expect(service.save).not.toHaveBeenCalled();
  });

  it('preserves unsaved edits when a different version or adoption is attempted', async () => {
    const { service } = setup();
    fireEvent.change(await screen.findByDisplayValue('已保存章纲 1'), {
      target: { value: '尚未保存的修改' },
    });
    const history = screen.getByRole('button', { name: '查看版本 v2' });
    const adopt = screen.getByRole('button', { name: '设为采用版本' });
    expect((history as HTMLButtonElement).disabled).toBe(true);
    expect((adopt as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(history);
    fireEvent.click(adopt);

    expect(screen.getByDisplayValue('尚未保存的修改')).not.toBeNull();
    expect(service.setActive).not.toHaveBeenCalled();
  });

  it('saves edits of an unadopted version separately without overwriting the active version', async () => {
    const { service, versions } = setup();
    await screen.findByDisplayValue('已保存章纲 1');
    fireEvent.click(screen.getByRole('button', { name: '查看版本 v2' }));
    fireEvent.change(screen.getByDisplayValue('已保存章纲 2'), {
      target: { value: '修改过的历史章纲' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 *' }));

    await screen.findByRole('button', { name: '查看版本 v3', pressed: true });
    expect(service.save).toHaveBeenCalledWith(
      expect.objectContaining({ content: '修改过的历史章纲', saveAsNewVersion: true }),
    );
    expect(versions.find((version) => version.id === 'outline-1')?.content).toBe('已保存章纲 1');
    expect(versions.find((version) => version.id === 'outline-1')?.isActive).toBe(true);
    expect(service.setActive).not.toHaveBeenCalled();
  });

  it('keeps edited text and its dirty state after a failed new save', async () => {
    const { service } = setup();
    fireEvent.change(await screen.findByDisplayValue('已保存章纲 1'), {
      target: { value: '需要保留的未保存文本' },
    });
    service.save.mockRejectedValueOnce(new Error('storage unavailable'));
    fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }));
    await waitFor(() => expect(service.save).toHaveBeenCalledTimes(1));

    expect(screen.getByDisplayValue('需要保留的未保存文本')).not.toBeNull();
    expect(screen.getByText('未保存')).not.toBeNull();
    expect(service.setActive).not.toHaveBeenCalled();
  });

  it('retains the persisted save if refreshing the version list fails afterwards', async () => {
    const { service } = setup();
    fireEvent.change(await screen.findByDisplayValue('已保存章纲 1'), {
      target: { value: '保存成功但刷新失败' },
    });
    service.getVersions.mockRejectedValueOnce(new Error('refresh unavailable'));
    fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }));

    await screen.findByRole('button', { name: '查看版本 v3', pressed: true });
    expect(screen.getByDisplayValue('保存成功但刷新失败')).not.toBeNull();
    expect(screen.queryByText('未保存')).toBeNull();
    expect(service.setActive).not.toHaveBeenCalled();
  });
});
