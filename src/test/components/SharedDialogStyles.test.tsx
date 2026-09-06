import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChapterFormModal from '../../components/outline/ChapterFormModal';
import VolumeFormModal from '../../components/outline/VolumeFormModal';
import RecoveryDialog from '../../components/workspace/RecoveryDialog';
import WorkspaceLeaveDialog from '../../components/workspace/WorkspaceLeaveDialog';

const globalCss = readFileSync(resolve('src/styles/global.css'), 'utf8');
const variablesCss = readFileSync(resolve('src/styles/variables.css'), 'utf8');
const novelDetailCss = readFileSync(resolve('src/styles/novel-detail.css'), 'utf8');
const settingSuggestionsCss = readFileSync(resolve('src/styles/setting-suggestions.css'), 'utf8');

// JSDOM does not perform layout or resolve all CSS custom-property shorthands.
// These tests cover real selector/declaration application and non-layout cascade
// values, not pixel geometry, final theme colors, or desktop visual acceptance.
const injectedStyles: HTMLStyleElement[] = [];

function injectStyles(css: string): HTMLStyleElement {
  const element = document.createElement('style');
  // The variable sheet is explicitly injected first; relative @imports cannot
  // resolve from the synthetic document and must not trigger a network fetch.
  element.textContent = css.replace(/@import\s+[^;]+;/gu, '');
  document.head.append(element);
  injectedStyles.push(element);
  return element;
}

function styleRules(element: HTMLStyleElement): CSSStyleRule[] {
  return Array.from(element.sheet?.cssRules ?? []).filter(
    (rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE,
  );
}

function matchingDeclaration(element: HTMLElement, property: string): string {
  let value = '';
  for (const sheet of injectedStyles) {
    for (const rule of styleRules(sheet)) {
      if (element.matches(rule.selectorText) && rule.style.getPropertyValue(property)) {
        value = rule.style.getPropertyValue(property);
      }
    }
  }
  return value;
}

function styleSnapshot(element: HTMLElement, properties: string[]): Record<string, string> {
  const style = getComputedStyle(element);
  return Object.fromEntries(
    properties.map((property) => [property, style.getPropertyValue(property)]),
  );
}

function expectSharedDialogChrome(dialog: HTMLElement): void {
  const overlay = dialog.parentElement!;
  const overlayStyle = getComputedStyle(overlay);
  const dialogStyle = getComputedStyle(dialog);
  expect(overlayStyle.position).toBe('fixed');
  expect(overlayStyle.display).toBe('flex');
  expect(overlayStyle.alignItems).toBe('center');
  expect(overlayStyle.justifyContent).toBe('center');
  expect(dialogStyle.position).toBe('relative');
  if (dialog.classList.contains('modal-frame')) {
    expect(dialogStyle.overflowY || dialogStyle.overflow).toBe('hidden');
    const body = dialog.querySelector<HTMLElement>('.modal-frame-body')!;
    expect(getComputedStyle(body).overflow).toBe('auto');
    expect(dialog.querySelector(':scope > .modal-frame-header')).toBeTruthy();
    expect(dialog.querySelector(':scope > .modal-frame-footer')).toBeTruthy();
  } else {
    expect(dialogStyle.overflowY || dialogStyle.overflow).toBe('auto');
  }
  expect(matchingDeclaration(dialog, 'width')).toBe('100%');
  expect(matchingDeclaration(dialog, 'max-width')).toMatch(/\d+px/u);
  expect(matchingDeclaration(dialog, 'max-height')).toMatch(/(?:d|s)?vh/u);
  expect(
    matchingDeclaration(dialog, 'background') || matchingDeclaration(dialog, 'background-color'),
  ).toContain('--color-bg-card');
  expect(matchingDeclaration(dialog, 'border')).not.toBe('');
  expect(dialogStyle.borderRadius).not.toBe('');
}

beforeEach(() => {
  injectStyles(variablesCss);
  injectStyles(globalCss);
});

afterEach(() => {
  for (const element of injectedStyles.splice(0)) element.remove();
});

describe('shared legacy dialog CSS compatibility', () => {
  it('gives a class-only nested dialog a bounded surface without loading any route CSS', () => {
    render(
      <div className="modal-overlay">
        <div className="modal-dialog" data-testid="shared-dialog">
          <div className="modal-title">新建作品</div>
          <input className="form-input" aria-label="作品名称" />
          <textarea className="form-textarea" aria-label="简介" />
        </div>
      </div>,
    );
    expectSharedDialogChrome(screen.getByTestId('shared-dialog'));
  });

  it.each(['volume', 'chapter'] as const)(
    'styles the existing %s form and preserves its explicit save/cancel behavior',
    async (kind) => {
      const user = userEvent.setup();
      const onSave = vi.fn();
      const onClose = vi.fn();
      const view = render(
        kind === 'volume' ? (
          <VolumeFormModal
            initial={null}
            novelId="isolated-novel"
            onSave={onSave}
            onClose={onClose}
          />
        ) : (
          <ChapterFormModal
            initial={null}
            novelId="isolated-novel"
            volumes={[]}
            onSave={onSave}
            onClose={onClose}
          />
        ),
      );
      const dialog = view.container.querySelector<HTMLElement>('.modal-dialog')!;
      expectSharedDialogChrome(dialog);
      expect(getComputedStyle(dialog).maxWidth).toBe(kind === 'volume' ? '520px' : '560px');
      const title = dialog.querySelector<HTMLInputElement>('input.form-input')!;
      const summary = dialog.querySelector<HTMLTextAreaElement>('textarea.form-textarea')!;
      for (const field of [title, summary]) {
        expect(matchingDeclaration(field, 'border')).not.toBe('');
        expect(matchingDeclaration(field, 'background-color')).toContain('--color-bg-card');
        expect(getComputedStyle(field).borderRadius).not.toBe('');
      }
      const label = dialog.querySelector<HTMLElement>('.panel-field-label')!;
      const select = dialog.querySelector<HTMLSelectElement>('.panel-select')!;
      expect(matchingDeclaration(label, 'font-size')).toContain('--font-size-sm');
      expect(matchingDeclaration(select, 'width')).toBe('100%');

      await user.type(title, '隔离测试标题');
      await user.type(summary, '隔离测试说明');
      expect(onSave).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      await user.click(
        screen.getByRole('button', { name: kind === 'volume' ? '创建分卷' : '创建章节' }),
      );
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave.mock.calls[0][0]).toMatchObject({ title: '隔离测试标题' });
      await user.click(screen.getByRole('button', { name: '取消' }));
      expect(onClose).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['form-input', 'form-textarea'] as const)(
    'shares input chrome, focus feedback, and disabled styles with %s',
    (className) => {
      render(
        <>
          <input className="input" aria-label="standard input" />
          {className === 'form-input' ? (
            <input className={className} aria-label="legacy field" />
          ) : (
            <textarea className={className} aria-label="legacy field" />
          )}
        </>,
      );
      const standard = screen.getByRole('textbox', { name: 'standard input' });
      const field = screen.getByRole('textbox', { name: 'legacy field' }) as
        HTMLInputElement | HTMLTextAreaElement;
      const sharedProperties = ['padding', 'border-radius', 'font-size', 'background-color'];
      expect(styleSnapshot(field, sharedProperties)).toEqual(
        styleSnapshot(standard, sharedProperties),
      );
      expect(matchingDeclaration(field, 'border')).not.toBe('');
      expect(matchingDeclaration(field, 'width')).toBe('100%');

      field.focus();
      expect(document.activeElement).toBe(field);
      expect(matchingDeclaration(field, 'box-shadow')).not.toBe('');
      expect(matchingDeclaration(field, 'border-color')).not.toBe('');
      field.blur();
      field.disabled = true;
      expect(getComputedStyle(field).cursor).toBe('not-allowed');
      expect(Number(getComputedStyle(field).opacity)).toBeLessThan(1);
    },
  );

  it('retains fixed centering for the existing overlay-sibling modal-content structure', () => {
    render(
      <>
        <div className="modal-overlay" data-testid="sibling-overlay" />
        <div
          className="modal-content"
          data-testid="sibling-dialog"
          style={{ maxWidth: 480, width: '90%' }}
        >
          JSON 导入预览
        </div>
      </>,
    );
    const dialog = screen.getByTestId('sibling-dialog');
    expect(dialog.previousElementSibling).toBe(screen.getByTestId('sibling-overlay'));
    const style = getComputedStyle(dialog);
    expect(style.position).toBe('fixed');
    expect(style.top).toBe('50%');
    expect(style.left).toBe('50%');
    expect(style.transform).toBe('translate(-50%, -50%)');
    expect(style.maxWidth).toBe('480px');
    expect(style.width).toBe('90%');
  });

  it('keeps the wider setting editor relative and viewport-bounded after its route CSS loads', () => {
    injectStyles(settingSuggestionsCss);
    render(
      <div className="modal-overlay">
        <div className="modal-dialog setting-suggestions-modal" data-testid="setting-dialog">
          设定候选编辑
        </div>
      </div>,
    );
    const dialog = screen.getByTestId('setting-dialog');
    expectSharedDialogChrome(dialog);
    expect(getComputedStyle(dialog).width).toBe('100%');
    expect(getComputedStyle(dialog).maxWidth).toBe('720px');
  });

  it('styles workspace leave and recovery dialogs without changing their guarded actions', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onDiscard = vi.fn();
    const onCancel = vi.fn();
    const leave = render(
      <WorkspaceLeaveDialog
        request={{ id: 'isolated-leave', reason: 'chapter_switch' }}
        busy
        onSave={onSave}
        onDiscard={onDiscard}
        onCancel={onCancel}
      />,
    );
    expectSharedDialogChrome(screen.getByTestId('workspace-leave-dialog'));
    await user.click(screen.getByRole('button', { name: '放弃修改并继续' }));
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    leave.unmount();

    const onRestore = vi.fn();
    render(
      <RecoveryDialog
        state={{
          status: 'available',
          conflict: false,
          snapshot: {
            novelId: 'isolated-novel',
            chapterId: 'isolated-chapter',
            recoveryContent: '隔离恢复内容',
            recoveryContentHash: 'isolated-hash',
            createdAt: '2026-09-05T00:00:00.000Z',
            updatedAt: '2026-09-05T00:00:00.000Z',
          },
        }}
        onRestore={onRestore}
        onDiscard={onDiscard}
        onLater={onCancel}
      />,
    );
    expectSharedDialogChrome(screen.getByTestId('workspace-recovery-dialog'));
    expect(screen.getByText(/它尚未成为正式草稿/)).toBeTruthy();
    expect(onRestore).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '恢复' }));
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('owns shared cards on initial load and keeps unrelated buttons stable after visiting details', () => {
    render(
      <section>
        <div className="detail-card" data-testid="shared-card">
          通用资源卡片
        </div>
        <button className="btn btn-primary" data-testid="shared-button">
          全局按钮
        </button>
        <button className="btn btn-secondary btn-sm" data-testid="shared-small-button">
          小按钮
        </button>
      </section>,
    );
    const card = screen.getByTestId('shared-card');
    expect(matchingDeclaration(card, 'padding')).not.toBe('');
    expect(matchingDeclaration(card, 'border')).not.toBe('');
    const buttons = [
      screen.getByTestId('shared-button'),
      screen.getByTestId('shared-small-button'),
    ];
    const properties = ['font-size', 'padding', 'height', 'border-radius', 'transition'];
    const before = buttons.map((button) => styleSnapshot(button, properties));
    const cardBefore = styleSnapshot(card, properties);
    const detailSheet = injectStyles(novelDetailCss);
    expect(buttons.map((button) => styleSnapshot(button, properties))).toEqual(before);
    expect(styleSnapshot(card, properties)).toEqual(cardBefore);

    const protectedSelectors = [
      '.btn',
      '.btn-primary',
      '.btn-secondary',
      '.btn-sm',
      '.detail-card',
    ];
    const unscoped = styleRules(detailSheet).flatMap((rule) =>
      rule.selectorText
        .split(',')
        .map((selector) => selector.trim())
        .filter((selector) =>
          protectedSelectors.some(
            (shared) => selector === shared || selector.startsWith(`${shared}:`),
          ),
        ),
    );
    expect(unscoped).toEqual([]);
  });

  it('keeps click propagation inside a styled dialog separate from its overlay close action', () => {
    const onClose = vi.fn();
    render(
      <VolumeFormModal
        initial={null}
        novelId="isolated-novel"
        onSave={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText('新建分卷'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.modal-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
