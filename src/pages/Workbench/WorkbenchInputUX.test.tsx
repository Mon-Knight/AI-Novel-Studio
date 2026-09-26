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
function ComposerHarness({
  initial = '',
  ...overrides
}: {
  initial?: string;
} & Partial<Parameters<typeof WorkbenchComposer>[0]>) {
  const [value, setValue] = useState(initial);
  const noop = () => undefined;
  return (
    <WorkbenchComposer
      scopeKey="task-a"
      templates={WORKBENCH_TASK_TEMPLATES}
      plugins={[]}
      pluginsLoading={false}
      pluginsError=""
      selectedModel={model}
      draft={value}
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
      assetScopeError="可重试的上下文读取提示"
      onDraftChange={setValue}
      onRetryModels={noop}
      onOpenModelSettings={noop}
      onCreateTaskWithCurrentModel={noop}
      onSend={noop}
      onCancel={noop}
      onRefreshAssetScope={noop}
      onOpenAssetScopePath={noop}
      onShowPlugins={noop}
      {...overrides}
    />
  );
}

describe('composer transient controls', () => {
  it('enters templates by keyboard, closes after insertion and exposes undo beside the input', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(<ComposerHarness onSend={onSend} />);
    screen.getByTestId('workbench-composer-attach').focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '生成下一章' }));
    await user.keyboard('{Enter}');
    const input = screen.getByRole('textbox', { name: '创作目标' }) as HTMLTextAreaElement;
    expect(input.value).toBe('生成下一章');
    expect(document.activeElement).toBe(input);
    expect(screen.getByTestId('workbench-composer-attach-menu').hidden).toBe(true);
    const undo = screen.getByTestId('workbench-template-undo');
    expect(undo.closest('.workbench-attach-menu')).toBeNull();
    await user.click(screen.getByRole('button', { name: '撤销模板' }));
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);
    expect(onSend).not.toHaveBeenCalled();
  });

  it.each(['追加到目标', '替换目标'])(
    'keeps existing text until %s is confirmed and restores it exactly',
    async (action) => {
      const user = userEvent.setup();
      const original = '  保留原有目标与空格\n最后一行。  ';
      const onSend = vi.fn();
      render(<ComposerHarness initial={original} onSend={onSend} />);
      await user.click(screen.getByTestId('workbench-composer-attach'));
      await user.click(screen.getByRole('button', { name: '生成下一章' }));
      const input = screen.getByRole('textbox', { name: '创作目标' }) as HTMLTextAreaElement;
      expect(input.value).toBe(original);
      const confirmation = screen.getByRole('group', { name: '模板插入方式' });
      fireEvent.keyDown(confirmation, { key: 'Escape', isComposing: true });
      expect(screen.queryByRole('group', { name: '模板插入方式' })).not.toBeNull();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('group', { name: '模板插入方式' })).toBeNull();
      expect(screen.getByTestId('workbench-composer-attach-menu').hidden).toBe(false);
      await user.click(screen.getByRole('button', { name: '生成下一章' }));
      await user.click(screen.getByRole('button', { name: action }));
      expect(input.value).toBe(
        action === '追加到目标' ? original + '\n\n生成下一章' : '生成下一章',
      );
      expect(screen.getByTestId('workbench-composer-attach-menu').hidden).toBe(true);
      expect(document.activeElement).toBe(input);
      await user.click(screen.getByRole('button', { name: '撤销模板' }));
      expect(input.value).toBe(original);
      expect(onSend).not.toHaveBeenCalled();
    },
  );

  it('keeps disclosures mutually exclusive and clears only transient state on task changes', async () => {
    const user = userEvent.setup();
    const view = render(<ComposerHarness initial="保留此目标" />);
    await user.click(screen.getByTestId('workbench-asset-scope-toggle'));
    expect(screen.queryByTestId('workbench-asset-scope-panel')).not.toBeNull();
    await user.click(screen.getByTestId('workbench-composer-attach'));
    expect(screen.queryByTestId('workbench-asset-scope-panel')).toBeNull();
    expect(screen.getByTestId('workbench-composer-attach-menu').hidden).toBe(false);
    view.rerender(<ComposerHarness initial="保留此目标" scopeKey="task-b" />);
    expect(screen.getByTestId('workbench-composer-attach-menu').hidden).toBe(true);
    expect(screen.getByTestId('workbench-asset-scope-toggle').getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect((screen.getByRole('textbox', { name: '创作目标' }) as HTMLTextAreaElement).value).toBe(
      '保留此目标',
    );
  });

  it('dismisses the insertion menu on outside focus and returns Escape to its trigger', async () => {
    const user = userEvent.setup();
    render(<ComposerHarness />);
    const trigger = screen.getByTestId('workbench-composer-attach');
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
    expect(screen.getByTestId('workbench-composer-attach-menu').hidden).toBe(true);
    await user.click(trigger);
    await user.click(screen.getByRole('textbox', { name: '创作目标' }));
    expect(screen.getByTestId('workbench-composer-attach-menu').hidden).toBe(true);
  });

  it('presents the fixed model as information rather than a disabled dropdown', () => {
    render(<ComposerHarness />);
    const fixed = screen.getByRole('group', { name: '当前任务固定模型' });
    expect(fixed.getAttribute('data-model-value')).toBe('mock:Mock');
    expect(fixed.getAttribute('data-model-locked')).toBe('true');
    expect(fixed.querySelector('select')).toBeNull();
    expect(fixed.querySelector('.workbench-fixed-model-name')?.textContent).toContain('Mock');
    const reason = screen.getByTestId('workbench-fixed-model-reason') as HTMLDetailsElement;
    expect(reason.open).toBe(false);
    expect(reason.textContent).toContain('任务创建时固定');
    expect(reason.textContent).toContain('更换模型请新建任务');
    fireEvent.click(reason.querySelector('summary')!);
    expect(reason.open).toBe(true);
  });

  it('shows readable revision provenance and removes only its source binding', async () => {
    const clear = vi.fn();
    const onSend = vi.fn();
    render(
      <ComposerHarness
        initial="已有修订要求"
        onSend={onSend}
        onClearRevisionSource={clear}
        revisionSource={{
          conversationId: 'task-a',
          novelId: 'novel-a',
          cardId: 'private-card-id',
          artifactId: 'private-artifact-id',
          artifactHash: 'private-hash',
          artifactType: 'chapter_text',
          title: '第二章候选',
          sourceDraftVersion: 3,
        }}
      />,
    );
    const chip = screen.getByTestId('workbench-revision-source');
    expect(chip.textContent).toContain('第二章候选');
    expect(chip.textContent).toContain('v3');
    expect(chip.textContent).not.toContain('private-');
    fireEvent.click(screen.getByTestId('workbench-clear-revision-source'));
    expect(clear).toHaveBeenCalledOnce();
    expect((screen.getByRole('textbox', { name: '创作目标' }) as HTMLTextAreaElement).value).toBe(
      '已有修订要求',
    );
    expect(onSend).not.toHaveBeenCalled();
  });
});
