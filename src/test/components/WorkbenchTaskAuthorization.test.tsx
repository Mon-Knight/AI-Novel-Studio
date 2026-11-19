import { useState } from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IssueTaskAuthorizationInput,
  TaskAuthorization,
  TaskAuthorizationReceipt,
} from '../../types/taskAuthorization';
import { WorkbenchTaskAuthorizationDialog } from '../../pages/Workbench/WorkbenchTaskAuthorizationDialog';
import { WorkbenchTaskAuthorizationStatus } from '../../pages/Workbench/WorkbenchTaskAuthorizationStatus';
import { useWorkbenchTaskAuthorization } from '../../features/workbench/useWorkbenchTaskAuthorization';

const native = vi.hoisted(() => ({
  list: vi.fn(),
  listReceipts: vi.fn(),
  issue: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock('../../services/conversation/taskAuthorizationService', () => ({
  taskAuthorizationService: native,
}));

function spec(): IssueTaskAuthorizationInput {
  return {
    conversationId: 'task-a',
    novelId: 'novel',
    sourceTurnId: 'turn',
    chapterIds: ['chapter'],
    allowNovelPlanning: false,
    actions: [{ action: 'adopt_chapter_text', maxWrites: 1 }],
    maxWrites: 1,
    budget: {
      maxRequests: 8,
      maxToolCalls: 24,
      maxRevisions: 2,
      maxTokens: 32000,
      maxCostUsd: 1,
      maxWallClockMs: 600000,
    },
    expiresAt: '2099-11-11T00:00:00Z',
  };
}
function grant(overrides: Partial<TaskAuthorization> = {}): TaskAuthorization {
  return {
    authorizationId: 'grant',
    conversationId: 'task-a',
    novelId: 'novel',
    sourceTurnId: 'turn',
    status: 'active',
    revision: 1,
    spec: spec(),
    modelSnapshot: {
      providerId: 'offline',
      modelId: 'fixture',
      runtimeMode: 'mock',
      capabilities: [],
      options: {},
      capturedAt: '',
    },
    modelSnapshotHash: 'model-hash',
    baselineHash: 'base-hash',
    usedWrites: 0,
    issuedAt: '2026-11-11T00:00:00Z',
    expiresAt: spec().expiresAt,
    ...overrides,
  };
}
function receipt(): TaskAuthorizationReceipt {
  return {
    receiptId: 'receipt',
    authorizationId: 'grant',
    operationId: 'operation',
    conversationId: 'task-a',
    novelId: 'novel',
    artifactId: 'artifact',
    cardId: 'card',
    action: 'adopt_chapter_text',
    authority: 'task_preauthorized',
    beforeHash: 'before',
    afterHash: 'after',
    result: {},
    createdAt: '2026-11-11T00:01:00Z',
    replayed: false,
  };
}
function props() {
  return {
    conversationId: 'task-a',
    novelId: 'novel',
    sourceTurnId: 'turn',
    novelTitle: '隔离作品',
    chapters: [{ id: 'chapter', title: '旧信', chapterNumber: 1 }],
    activeChapterId: 'chapter',
    authorizations: [] as TaskAuthorization[],
    receipts: [] as TaskAuthorizationReceipt[],
    loading: false,
    busy: false,
    error: '',
    onIssue: vi.fn().mockResolvedValue(true),
    onRevoke: vi.fn().mockResolvedValue(true),
    onRefresh: vi.fn(),
    onDismiss: vi.fn(),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  native.list.mockResolvedValue([]);
  native.listReceipts.mockResolvedValue([]);
  native.issue.mockResolvedValue(grant());
  native.revoke.mockResolvedValue(grant({ status: 'revoked' }));
});

describe('task preauthorization user interface', () => {
  it('defaults to no actions and signs only the separately selected action with finite scope and budgets', async () => {
    const input = props();
    const user = userEvent.setup();
    render(<WorkbenchTaskAuthorizationDialog {...input} />);
    expect(input.onIssue).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: '签发本任务有限预授权' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    for (const checkbox of screen.getAllByRole('checkbox'))
      expect((checkbox as HTMLInputElement).checked).toBe(false);
    await user.click(screen.getByRole('checkbox', { name: '自动采用正文候选' }));
    await user.click(screen.getByRole('button', { name: '签发本任务有限预授权' }));
    await waitFor(() => expect(input.onIssue).toHaveBeenCalledTimes(1));
    const issued = input.onIssue.mock.calls[0][0] as IssueTaskAuthorizationInput;
    expect(issued).toMatchObject({
      conversationId: 'task-a',
      novelId: 'novel',
      sourceTurnId: 'turn',
      chapterIds: ['chapter'],
      allowNovelPlanning: false,
      actions: [{ action: 'adopt_chapter_text', maxWrites: 1 }],
      maxWrites: 1,
    });
    expect(issued.creationScope).toBeUndefined();
    expect(Object.values(issued.budget).every(Number.isFinite)).toBe(true);
    expect(Date.parse(issued.expiresAt)).toBeGreaterThan(Date.now());
    expect('modelSnapshot' in issued).toBe(false);
    expect('baselineHash' in issued).toBe(false);
  });

  it('validates bounded creation volume range and count without granting the entire novel', async () => {
    const input = props();
    const user = userEvent.setup();
    render(<WorkbenchTaskAuthorizationDialog {...input} activeChapterId={undefined} />);
    await user.click(screen.getByRole('checkbox', { name: '自动应用规划' }));
    await user.click(screen.getByRole('checkbox', { name: '允许在明确卷范围内有限新建章节' }));
    fireEvent.change(screen.getByLabelText('允许新建的起始卷序号'), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: '签发本任务有限预授权' }));
    expect(screen.getByRole('alert').textContent).toContain('合法的卷范围');
    expect(input.onIssue).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('允许新建的结束卷序号'), { target: { value: '2' } });
    await user.click(screen.getByRole('button', { name: '签发本任务有限预授权' }));
    expect(input.onIssue).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('分别勾选');
    await user.click(
      screen.getByRole('checkbox', { name: '允许作品级规划（不扩大正文或总结范围）' }),
    );
    await user.click(screen.getByRole('button', { name: '签发本任务有限预授权' }));
    await waitFor(() => expect(input.onIssue).toHaveBeenCalledTimes(1));
    expect(input.onIssue.mock.calls[0][0]).toMatchObject({
      chapterIds: [],
      allowNovelPlanning: true,
      creationScope: {
        firstVolumeIndex: 2,
        lastVolumeIndex: 2,
        maxNewVolumes: 1,
        maxNewChapters: 1,
      },
    });
  });

  it('preserves focus, traps Tab, ignores IME and composer shortcuts, and returns focus to the opener', async () => {
    const user = userEvent.setup();
    const input = props();
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>管理授权</button>
          {open && <WorkbenchTaskAuthorizationDialog {...input} onDismiss={() => setOpen(false)} />}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: '管理授权' });
    await user.click(opener);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: '重新读取授权与写入回执' }),
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(dialog, { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(dialog, { key: 'Escape', isComposing: true });
    expect(input.onIssue).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
    screen.getByRole('button', { name: '关闭授权详情' }).focus();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('never presents an old active grant as covering a new independent goal', () => {
    const onManage = vi.fn();
    const view = render(
      <WorkbenchTaskAuthorizationStatus
        authorizations={[grant()]}
        loading={false}
        sourceTurnId="turn"
        onManage={onManage}
      />,
    );
    expect(screen.getByRole('button').textContent).toContain('剩余 1 次写入');
    fireEvent.click(screen.getByRole('button'));
    expect(onManage).toHaveBeenCalledTimes(1);
    view.rerender(
      <WorkbenchTaskAuthorizationStatus
        authorizations={[grant()]}
        loading={false}
        sourceTurnId="new-goal"
        onManage={onManage}
      />,
    );
    expect(screen.getByRole('button').textContent).toContain('人工确认');
  });

  it('requires a persisted explicit goal before signing even after an action is selected', () => {
    const input = props();
    render(<WorkbenchTaskAuthorizationDialog {...input} sourceTurnId="" />);
    fireEvent.click(screen.getByRole('checkbox', { name: '自动应用总结' }));
    expect(
      (screen.getByRole('button', { name: '签发本任务有限预授权' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText(/请先提交明确的任务目标/)).toBeTruthy();
    expect(input.onIssue).not.toHaveBeenCalled();
  });

  it('allows revocation while generation runs and retains truthful committed receipts', async () => {
    const input = props();
    render(
      <WorkbenchTaskAuthorizationDialog
        {...input}
        stage="生成中"
        authorizations={[grant()]}
        receipts={[receipt()]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '撤销授权 grant' }));
    expect(input.onRevoke).toHaveBeenCalledWith('grant');
    expect(screen.getByText(/撤销后停止新的授权写入/)).toBeTruthy();
    expect(screen.getByText(/根据任务预授权采用正文/)).toBeTruthy();
    expect(screen.getByText(/不表示作者已审阅或内容语义已验证/)).toBeTruthy();
  });

  it.each(['revoked', 'expired', 'exhausted'] as const)(
    'shows %s without an actionable revoke control',
    (status) => {
      const input = props();
      render(<WorkbenchTaskAuthorizationDialog {...input} authorizations={[grant({ status })]} />);
      expect(screen.queryByRole('button', { name: '撤销授权 grant' })).toBeNull();
      expect(screen.getByText(/未授予的动作继续人工确认/)).toBeTruthy();
    },
  );

  it('keeps authorizations visible during errors and does not issue on scope/source changes', async () => {
    const input = props();
    const view = render(<WorkbenchTaskAuthorizationDialog {...input} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '自动应用总结' }));
    view.rerender(
      <WorkbenchTaskAuthorizationDialog
        {...input}
        conversationId="task-b"
        sourceTurnId="other-turn"
        error="授权读取失败，请重试"
      />,
    );
    expect(
      (screen.getByRole('checkbox', { name: '自动应用总结' }) as HTMLInputElement).checked,
    ).toBe(false);
    expect(
      (screen.getByRole('button', { name: '签发本任务有限预授权' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(input.onIssue).not.toHaveBeenCalled();
  });

  it('shows public stage/stop reason and labels preauthorized application as distinct from manual review', () => {
    render(
      <WorkbenchTaskAuthorizationStatus
        authorizations={[grant({ status: 'revoked' })]}
        receipts={[receipt()]}
        loading={false}
        stage="检查"
        stopReason="目标基线变化"
        onManage={vi.fn()}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('当前阶段：检查');
    expect(screen.getByRole('status').textContent).toContain('已停止自动应用：目标基线变化');
    expect(screen.getByRole('status').textContent).toContain('根据任务预授权已采用正文');
    expect(screen.getByRole('button').textContent).toContain('人工确认');
  });
});

describe('task preauthorization asynchronous native projection', () => {
  it('isolates late read responses from a previously selected task', async () => {
    const pending = deferred<TaskAuthorization[]>();
    native.list.mockImplementation((id: string) =>
      id === 'task-a'
        ? pending.promise
        : Promise.resolve([grant({ conversationId: 'task-b', authorizationId: 'grant-b' })]),
    );
    const view = renderHook(
      ({ conversationId }) => useWorkbenchTaskAuthorization({ conversationId, novelId: 'novel' }),
      { initialProps: { conversationId: 'task-a' } },
    );
    view.rerender({ conversationId: 'task-b' });
    await waitFor(() =>
      expect(view.result.current.authorizations[0]?.authorizationId).toBe('grant-b'),
    );
    await act(async () => pending.resolve([grant()]));
    expect(view.result.current.authorizations.map((item) => item.authorizationId)).toEqual([
      'grant-b',
    ]);
  });

  it('deduplicates pending signing and never optimistically grants permission', async () => {
    const pending = deferred<TaskAuthorization>();
    native.issue.mockReturnValue(pending.promise);
    const view = renderHook(() =>
      useWorkbenchTaskAuthorization({ conversationId: 'task-a', novelId: 'novel' }),
    );
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    let first!: Promise<boolean>;
    await act(async () => {
      first = view.result.current.issue(spec());
      void view.result.current.issue(spec());
    });
    expect(native.issue).toHaveBeenCalledTimes(1);
    expect(view.result.current.authorizations).toEqual([]);
    native.list.mockResolvedValue([grant()]);
    await act(async () => {
      pending.resolve(grant());
      await first;
    });
    expect(view.result.current.authorizations[0].authorizationId).toBe('grant');
  });

  it('reconciles uncertain results without repeating signing and preserves the error', async () => {
    native.issue.mockRejectedValue(new Error('DATABASE_COMMIT_UNKNOWN'));
    const view = renderHook(() =>
      useWorkbenchTaskAuthorization({ conversationId: 'task-a', novelId: 'novel' }),
    );
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    native.list.mockResolvedValue([grant()]);
    await act(async () => {
      await view.result.current.issue(spec());
    });
    expect(native.issue).toHaveBeenCalledTimes(1);
    expect(view.result.current.authorizations[0].authorizationId).toBe('grant');
    expect(view.result.current.error).toContain('不会自动重试或重签');
  });

  it('fails closed on mismatched native scope and rejects an old UI issuance spec', async () => {
    native.list.mockResolvedValue([grant({ novelId: 'other-novel' })]);
    const view = renderHook(() =>
      useWorkbenchTaskAuthorization({ conversationId: 'task-a', novelId: 'novel' }),
    );
    await waitFor(() => expect(view.result.current.error).toContain('不匹配'));
    expect(view.result.current.authorizations).toEqual([]);
    await act(async () => {
      await view.result.current.issue({ ...spec(), novelId: 'other-novel' });
    });
    expect(native.issue).not.toHaveBeenCalled();
  });
});
