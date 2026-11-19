import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ChapterOutline,
  MasterOutline,
  OutlineType,
  VolumeOutline,
} from '../../types/outline';
import type {
  OutlineRuntimeEntry,
  OutlineGenerationEvidence,
  OutlineCandidateApplicationAction,
} from '../../types/outlineGeneration';
import OutlineEditor from './OutlineEditor';

const services = vi.hoisted(() => {
  const service = () => ({
    getActive: vi.fn(),
    getVersions: vi.fn(),
    save: vi.fn(),
    setActive: vi.fn(),
  });
  return {
    master: service(),
    volume: service(),
    chapter: service(),
    desktop: false,
    generate: vi.fn(),
    apply: vi.fn(),
    readSource: vi.fn(),
    context: vi.fn(),
    legacyGenerate: vi.fn(),
    settings: vi.fn(),
  };
});

vi.mock('../../services/outlines/outlineService', () => ({
  masterOutlineService: services.master,
  volumeOutlineService: services.volume,
  chapterOutlineService: services.chapter,
  loadOutlineContext: services.context,
}));
vi.mock('../../services/database/db', async (original) => ({
  ...(await original<typeof import('../../services/database/db')>()),
  isTauri: () => services.desktop,
}));
vi.mock('../../services/outlines/outlineRuntimeService', () => ({
  generateNativeOutline: services.generate,
}));
vi.mock('../../services/outlines/outlineCandidateApplicationService', () => ({
  applyNativeOutlineCandidate: services.apply,
  outlineSourceFromSnapshot: services.readSource,
}));
vi.mock('../../services/ai/aiClient', () => ({
  runAiGenerate: services.legacyGenerate,
  aiSettingsService: { getSettings: services.settings },
}));
vi.mock('../../lib/runWithLoading', () => ({
  runWithLoading: async (
    _options: unknown,
    execute: (context: {
      signal: AbortSignal;
      setStage: () => void;
      setMessage: () => void;
      operationId: string;
    }) => Promise<void>,
  ) =>
    execute({
      signal: new AbortController().signal,
      setStage: vi.fn(),
      setMessage: vi.fn(),
      operationId: 'isolated-outline-ui',
    }),
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

beforeEach(() => {
  vi.clearAllMocks();
  services.desktop = false;
  services.context.mockResolvedValue({ novelTitle: '隔离作品' });
  services.readSource.mockImplementation((snapshot?: string) =>
    snapshot ? (JSON.parse(snapshot).source ?? null) : null,
  );
});

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

  it('desktop AI generation yields an editable candidate, saves without adoption, then explicitly adopts through a native receipt', async () => {
    services.desktop = true;
    const { service, versions } = setup();
    const sourceFor = (request: OutlineRuntimeEntry): OutlineGenerationEvidence => ({
      version: 1,
      novelId: 'novel-1',
      conversationId: 'native-task',
      turnId: 'native-turn',
      runId: 'native-run',
      cardId: 'native-card',
      artifactId: 'native-artifact',
      artifactHash: 'a'.repeat(64),
      request,
    });
    services.generate.mockImplementation(async (_novel: string, request: OutlineRuntimeEntry) => ({
      format: 'editor_text',
      value: '原生大纲候选，未保存或采用。',
      title: '候选标题',
      source: sourceFor(request),
    }));
    services.apply.mockImplementation(
      async (source: OutlineGenerationEvidence, action: OutlineCandidateApplicationAction) => {
        if (action.kind === 'outline_version') {
          const saved = {
            ...outline(3),
            title: action.title,
            content: action.content,
            sourceType: 'ai_edited' as const,
            contextSnapshot: JSON.stringify({
              schemaVersion: 'outline_candidate_application_v1',
              source,
            }),
          };
          versions.unshift(saved);
          return { outline: saved, receipt: { receiptId: 'native-save' } };
        }
        if (action.kind === 'adopt_outline_version') {
          versions.forEach((version) => {
            version.isActive = version.id === action.outlineId;
          });
          return {
            outline: versions.find((version) => version.id === action.outlineId),
            receipt: { receiptId: 'native-adopt' },
          };
        }
        throw new Error('unexpected native action');
      },
    );
    await screen.findByDisplayValue('已保存章纲 1');
    fireEvent.click(screen.getByRole('button', { name: 'AI 生成' }));
    const candidate = await screen.findByDisplayValue('原生大纲候选，未保存或采用。');
    expect(services.generate).toHaveBeenCalledWith(
      'novel-1',
      expect.objectContaining({
        kind: 'outline_generate',
        outlineType: 'chapter',
        format: 'editor_text',
        targetId: 'target-1',
        targetIndex: 14,
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(services.legacyGenerate).not.toHaveBeenCalled();
    expect(services.settings).not.toHaveBeenCalled();
    expect(services.apply).not.toHaveBeenCalled();
    fireEvent.change(candidate, { target: { value: '作者编辑后的完整章纲，不提升未核验事实。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }));
    await screen.findByRole('button', { name: '查看版本 v3', pressed: true });
    expect(services.apply.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        kind: 'outline_version',
        content: '作者编辑后的完整章纲，不提升未核验事实。',
        saveAsNewVersion: true,
      }),
    );
    expect(service.save).not.toHaveBeenCalled();
    expect(service.setActive).not.toHaveBeenCalled();
    expect(versions.find((version) => version.id === 'outline-1')?.isActive).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '设为采用版本' }));
    await waitFor(() => expect(services.apply).toHaveBeenCalledTimes(2));
    expect(services.apply.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        kind: 'adopt_outline_version',
        outlineId: 'outline-3',
        expectedVersion: 3,
        expectedActive: expect.objectContaining({ id: 'outline-1', version: 1 }),
      }),
    );
    expect(service.setActive).not.toHaveBeenCalled();
  });

  it('desktop native baseline rejection preserves author edits and never retries generation or falls back to manual save', async () => {
    services.desktop = true;
    const { service } = setup();
    services.generate.mockImplementation(async (_novel: string, request: OutlineRuntimeEntry) => ({
      format: 'editor_text',
      value: '待修改的原生章纲',
      title: '候选',
      source: {
        version: 1,
        novelId: 'novel-1',
        conversationId: 'task',
        turnId: 'turn',
        runId: 'run',
        cardId: 'card',
        artifactId: 'artifact',
        artifactHash: 'a'.repeat(64),
        request,
      },
    }));
    services.apply.mockRejectedValueOnce(new Error('OUTLINE_BASELINE_CONFLICT'));
    await screen.findByDisplayValue('已保存章纲 1');
    fireEvent.click(screen.getByRole('button', { name: 'AI 生成' }));
    fireEvent.change(await screen.findByDisplayValue('待修改的原生章纲'), {
      target: { value: '冲突后必须保留的作者编辑内容' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }));
    await waitFor(() => expect(services.apply).toHaveBeenCalledOnce());
    expect(screen.getByDisplayValue('冲突后必须保留的作者编辑内容')).not.toBeNull();
    expect(screen.getByText('未保存')).not.toBeNull();
    expect(service.save).not.toHaveBeenCalled();
    expect(services.generate).toHaveBeenCalledOnce();
  });
});
