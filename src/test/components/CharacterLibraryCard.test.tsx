import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Character } from '../../types/character';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('../../services/characters/characterService', () => ({
  characterService: {
    getByNovelId: mocks.list,
    saveProfile: mocks.save,
    create: mocks.create,
    remove: mocks.remove,
  },
}));
import CharacterLibraryCard from '../../components/novel-card/CharacterLibraryCard';

const character: Character = {
  id: 'c',
  novelId: 'n',
  name: '人物甲',
  roleType: 'supporting',
  identity: '记录员',
  faction: '档案馆',
  relationToProtagonist: '同事',
  personality: '谨慎',
  goal: '查明原委',
  behaviorLimits: '旧边界',
  forbiddenBehaviors: '不得毁损原件',
  currentState: '调查中',
  source: 'manual',
  isActive: true,
  createdAt: 'created',
  updatedAt: 'old',
};
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.list.mockResolvedValue([character]);
  mocks.save.mockResolvedValue({ ...character, behaviorLimits: '新边界', updatedAt: 'new' });
});

async function edit() {
  fireEvent.click(await screen.findByRole('button', { name: '编辑角色 人物甲' }));
  const dialog = screen.getByRole('dialog', { name: '编辑角色 · 人物甲' });
  fireEvent.change(within(dialog).getByLabelText('行为限制（允许但不限制范围）'), {
    target: { value: '新边界' },
  });
  return dialog;
}

it('edits every existing profile field and waits for the authoritative save', async () => {
  let resolve!: (value: Character) => void;
  mocks.save.mockReturnValue(
    new Promise<Character>((done) => {
      resolve = done;
    }),
  );
  render(<CharacterLibraryCard novelId="n" />);
  const dialog = await edit();
  for (const label of [
    '角色名称 *',
    '角色类型',
    '身份',
    '阵营',
    '与主角关系',
    '性格特征',
    '目标',
    '禁止行为（绝对不能做的）',
  ])
    expect(within(dialog).getByLabelText(label)).toBeTruthy();
  fireEvent.change(within(dialog).getByLabelText('禁止行为（绝对不能做的）'), {
    target: { value: '' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: '保存角色' }));
  expect(
    (within(dialog).getByRole('button', { name: '处理中…' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect((within(dialog).getByLabelText('身份') as HTMLInputElement).disabled).toBe(true);
  expect(mocks.save).toHaveBeenCalledWith(
    expect.objectContaining({
      novelId: 'n',
      characterId: 'c',
      expectedUpdatedAt: 'old',
      expectedSource: 'manual',
      behaviorLimits: '新边界',
      forbiddenBehaviors: '',
      identity: '记录员',
      name: '人物甲',
    }),
  );
  expect(mocks.create).not.toHaveBeenCalled();
  expect(mocks.remove).not.toHaveBeenCalled();
  await act(async () => {
    resolve({ ...character, behaviorLimits: '新边界', updatedAt: 'new' });
  });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByText('人物甲'));
  expect(screen.getByText('行为限制：新边界')).toBeTruthy();
});

it('preserves failed input and requires explicit review of a refreshed baseline', async () => {
  mocks.save.mockRejectedValueOnce(new Error('CHARACTER_PROFILE_CONFLICT: 已变化'));
  render(<CharacterLibraryCard novelId="n" />);
  const dialog = await edit();
  fireEvent.click(within(dialog).getByRole('button', { name: '保存角色' }));
  expect((await screen.findByRole('alert')).textContent).toContain('CHARACTER_PROFILE_CONFLICT');
  expect(
    (within(dialog).getByLabelText('行为限制（允许但不限制范围）') as HTMLTextAreaElement).value,
  ).toBe('新边界');
  expect(
    (within(dialog).getByRole('button', { name: '保存角色' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  mocks.list.mockResolvedValue([
    { ...character, name: '他处新名称', behaviorLimits: '他处修改', updatedAt: 'refreshed' },
  ]);
  fireEvent.click(within(dialog).getByRole('button', { name: '刷新正式版本（保留输入）' }));
  await screen.findByText('他处修改');
  expect(
    (within(dialog).getByRole('button', { name: '保存角色' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  fireEvent.click(within(dialog).getByRole('button', { name: '已核对，使用最新基线（保留输入）' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '保存角色' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[1][0]).toMatchObject({
    expectedUpdatedAt: 'refreshed',
    behaviorLimits: '新边界',
    name: '他处新名称',
  });
});

it('keeps a bound protagonist role locked and repairs a legacy inconsistent role on explicit save', async () => {
  mocks.list.mockResolvedValue([{ ...character, protagonistKey: 'bound', isProtagonist: false }]);
  render(<CharacterLibraryCard novelId="n" />);
  const dialog = await edit();
  const role = within(dialog).getByLabelText('角色类型') as HTMLSelectElement;
  expect(role.disabled).toBe(true);
  expect(role.value).toBe('protagonist');
  fireEvent.click(within(dialog).getByRole('button', { name: '保存角色' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ characterId: 'c', roleType: 'protagonist' });
});

it('does not resurrect a removed character when refreshing after a conflict', async () => {
  mocks.save.mockRejectedValue(new Error('CHARACTER_PROFILE_CONFLICT: 已停用'));
  render(<CharacterLibraryCard novelId="n" />);
  const dialog = await edit();
  fireEvent.click(within(dialog).getByRole('button', { name: '保存角色' }));
  await screen.findByRole('alert');
  mocks.list.mockResolvedValue([]);
  fireEvent.click(within(dialog).getByRole('button', { name: '刷新正式版本（保留输入）' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('人物已停用或删除'));
  expect(
    (within(dialog).getByLabelText('行为限制（允许但不限制范围）') as HTMLTextAreaElement).value,
  ).toBe('新边界');
  expect(within(dialog).queryByRole('button', { name: /已核对/ })).toBeNull();
});

it('ignores a late save response after changing projects', async () => {
  let resolve!: (value: Character) => void;
  mocks.save.mockReturnValue(
    new Promise<Character>((done) => {
      resolve = done;
    }),
  );
  const view = render(<CharacterLibraryCard novelId="n" />);
  const dialog = await edit();
  fireEvent.click(within(dialog).getByRole('button', { name: '保存角色' }));
  mocks.list.mockResolvedValue([
    { ...character, id: 'other', novelId: 'other', name: '另一个人物' },
  ]);
  view.rerender(<CharacterLibraryCard novelId="other" />);
  await screen.findByRole('button', { name: '编辑角色 另一个人物' });
  await act(async () => {
    resolve({ ...character, name: '迟到的修改' });
  });
  expect(screen.queryByText('迟到的修改')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});
