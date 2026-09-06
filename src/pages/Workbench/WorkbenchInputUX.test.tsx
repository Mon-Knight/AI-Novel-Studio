import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GrowingGoalTextarea } from './GrowingGoalTextarea';
import { goalTextareaHeight } from './goalTextareaLayout';
import { WorkbenchTemplateControls } from './WorkbenchTemplateControls';
import { WorkbenchComposer } from './WorkbenchComposer';
import { WorkbenchTaskCreator } from './WorkbenchTaskCreator';
import { WORKBENCH_TASK_TEMPLATES } from './workbenchTaskTemplates';

vi.mock('./hooks/useWorkbenchModelCredential', () => ({
  useWorkbenchModelCredential: () => ({ credentialAvailable: true }),
}));

const model = {
  providerId: 'mock',
  modelId: 'Mock',
  runtimeMode: 'mock' as const,
  capabilities: [],
  options: {},
  capturedAt: '2026-09-05T00:00:00Z',
};

function TemplateHarness({ initial, chapter = true }: { initial: string; chapter?: boolean }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <textarea
        aria-label="测试目标"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <WorkbenchTemplateControls
        templates={WORKBENCH_TASK_TEMPLATES}
        hasChapter={chapter}
        disabled={false}
        value={value}
        onChange={setValue}
      />
    </>
  );
}

describe('workbench input content protection', () => {
  it.each([500, 1000])(
    'requires an explicit template action and restores the exact %i-character goal',
    async (size) => {
      const original = `  ${'目标'.repeat(size / 2)}\n保留尾行与空格。  `;
      const user = userEvent.setup();
      render(<TemplateHarness initial={original} />);
      const input = screen.getByRole('textbox', { name: '测试目标' }) as HTMLTextAreaElement;
      await user.click(screen.getByRole('button', { name: '生成下一章' }));
      expect(input.value).toBe(original);
      await user.click(screen.getByRole('button', { name: '替换目标' }));
      expect(input.value).toBe('生成下一章');
      await user.click(screen.getByRole('button', { name: '撤销模板' }));
      expect(input.value).toBe(original);
      await user.click(screen.getByRole('button', { name: '完善大纲' }));
      await user.click(screen.getByRole('button', { name: '追加到目标' }));
      expect(input.value).toBe(`${original}\n\n完善当前章节大纲`);
      await user.click(screen.getByRole('button', { name: '撤销模板' }));
      expect(input.value).toBe(original);
    },
  );

  it('protects later input from stale undo and keeps out-of-scope templates disabled under More', async () => {
    const user = userEvent.setup();
    render(<TemplateHarness initial="" chapter={false} />);
    expect(screen.queryByRole('button', { name: '生成下一章' })).toBeNull();
    await user.click(screen.getByText('更多模板'));
    expect((screen.getByRole('button', { name: '生成下一章' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: '完善全书规划' }));
    fireEvent.change(screen.getByRole('textbox', { name: '测试目标' }), {
      target: { value: '用户后续新输入' },
    });
    expect((screen.getByRole('button', { name: '撤销模板' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('autogrows in place between two and eight lines with a viewport cap', () => {
    expect(goalTextareaHeight(0, 22, 16, 800)).toBe(60);
    expect(goalTextareaHeight(10000, 22, 16, 800)).toBe(192);
    expect(goalTextareaHeight(10000, 22, 16, 500)).toBe(150);
    const view = render(
      <GrowingGoalTextarea
        aria-label="长目标"
        value="初始目标"
        readOnly
        style={{ lineHeight: '22px', padding: '8px' }}
      />,
    );
    const input = screen.getByRole('textbox') as HTMLTextAreaElement;
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 10000 });
    view.rerender(
      <GrowingGoalTextarea
        aria-label="长目标"
        value={'长目标'.repeat(350)}
        readOnly
        style={{ lineHeight: '22px', padding: '8px' }}
      />,
    );
    expect(screen.getByRole('textbox')).toBe(input);
    expect(parseFloat(input.style.height)).toBeLessThanOrEqual(192);
    expect(input.style.maxHeight).toBe('30vh');
    expect(input.style.overflowY).toBe('auto');
  });

  it('never sends the composer shortcut during native or legacy IME composition', () => {
    const onSend = vi.fn();
    render(
      <WorkbenchComposer
        templates={[]}
        plugins={[]}
        pluginsLoading={false}
        pluginsError=""
        selectedModel={model}
        draft="你能做什么？"
        composerError=""
        selectedConversationPreparing={false}
        selectedConversationRunning={false}
        selectedConversationArchived={false}
        hasTask
        taskReady
        hasChapter
        chaptersLoading={false}
        contextPending={false}
        contextFailed={false}
        assetScope={null}
        assetScopeLoading={false}
        assetScopeError=""
        onDraftChange={vi.fn()}
        onRetryModels={vi.fn()}
        onOpenModelSettings={vi.fn()}
        onCreateTaskWithCurrentModel={vi.fn()}
        onSend={onSend}
        onCancel={vi.fn()}
        onRefreshAssetScope={vi.fn()}
        onOpenAssetScopePath={vi.fn()}
      />,
    );
    const input = screen.getByRole('textbox', { name: '创作目标' });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('uses the same protected templates and IME guard in the task creator', async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const onGoalChange = vi.fn();
    render(
      <WorkbenchTaskCreator
        novelTitle="隔离作品"
        chapters={[]}
        templates={WORKBENCH_TASK_TEMPLATES}
        plugins={[]}
        pluginsLoading={false}
        pluginsError=""
        contextPending={false}
        contextFailed={false}
        goal="你能做什么？"
        chapterId=""
        selectedModel={model}
        creating={false}
        error=""
        onGoalChange={onGoalChange}
        onChapterChange={vi.fn()}
        onModelChange={vi.fn()}
        onRetryModels={vi.fn()}
        onOpenModelSettings={vi.fn()}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    const input = screen.getByRole('textbox', { name: '创作目标' });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true, keyCode: 229 });
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '完善全书规划' }));
    expect(onGoalChange).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('group', { name: '模板插入方式' }), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.queryByRole('group', { name: '模板插入方式' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '完善全书规划' }));
    fireEvent.click(screen.getByRole('button', { name: '替换目标' }));
    expect(onGoalChange).toHaveBeenCalledWith('生成全书规划候选');
    await act(async () => fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
