import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ContextRecordForm from '../../components/context-records/ContextRecordForm';
import ContextRecordList from '../../components/context-records/ContextRecordList';
import VolumeTree from '../../components/workspace/VolumeTree';
import { ChapterSummaryPanelView } from '../../components/right-dock/panels/ChapterSummaryPanelView';
import { TemplateEditorForm } from '../../pages/Templates/TemplateEditorForm';
import { UserTemplateCard } from '../../pages/Templates/TemplatePageSections';
import type { AiSettings } from '../../types/ai';
import type { Chapter } from '../../types/chapter';
import type { ContextRecord } from '../../types/context';

const reviewedFiles = [
  'src/components/workspace/VolumeTree.tsx',
  'src/components/right-dock/panels/ChapterSummaryPanelView.tsx',
  'src/components/right-dock/panels/ContextViewPanel.tsx',
  'src/components/context-records/ContextRecordList.tsx',
  'src/components/context-records/ContextRecordForm.tsx',
  'src/components/settings/DataStorageSettingsCard.tsx',
  'src/pages/Templates/TemplatePageSections.tsx',
  'src/pages/Templates/TemplateEditorForm.tsx',
  'src/pages/StyleProfiles/StyleProfilesContent.tsx',
  'src/pages/StyleProfiles/StyleSourceTrace.tsx',
] as const;

function explicitTextSizes(node: ts.Node): number[] {
  if (ts.isNumericLiteral(node)) return [Number(node.text)];
  if (ts.isStringLiteral(node) && /^\d+(?:\.\d+)?(?:px)?$/u.test(node.text)) {
    return [Number.parseFloat(node.text)];
  }
  if (ts.isConditionalExpression(node)) {
    return [...explicitTextSizes(node.whenTrue), ...explicitTextSizes(node.whenFalse)];
  }
  return [];
}

function expectReadableInlineText(container: HTMLElement): void {
  const textNodes = Array.from(container.querySelectorAll<HTMLElement>('[style]')).filter(
    (element) => Boolean(element.style.fontSize),
  );
  expect(textNodes.length).toBeGreaterThan(0);
  for (const element of textNodes)
    expect(Number.parseFloat(element.style.fontSize)).toBeGreaterThanOrEqual(12);
}

describe('U12 production inline text floor', () => {
  it.each(reviewedFiles)(
    'keeps explicit text sizes at least 12px in %s without treating icon sizes as text',
    (file) => {
      const source = ts.createSourceFile(
        file,
        readFileSync(resolve(file), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const failures: string[] = [];
      const visit = (node: ts.Node) => {
        if (
          ts.isPropertyAssignment(node) &&
          node.name.getText(source).replace(/^['"]|['"]$/gu, '') === 'fontSize'
        ) {
          for (const size of explicitTextSizes(node.initializer)) {
            if (size < 12) {
              const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
              failures.push(`${file}:${line}: ${size}px`);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      expect(failures).toEqual([]);
    },
  );

  it('gives both inline volume-tree actions readable text and a 28px target without changing icons', () => {
    render(
      <VolumeTree
        volumes={[]}
        chapters={[]}
        activeChapterId=""
        onSelectChapter={vi.fn()}
        onCreateVolume={vi.fn(async () => undefined)}
        onCreateChapter={vi.fn(async () => undefined)}
      />,
    );
    for (const id of ['chapter-create', 'volume-create']) {
      const button = screen.getByTestId(id);
      expect(button.style.fontSize).toBe('12px');
      expect(Number.parseFloat(button.style.minHeight)).toBeGreaterThanOrEqual(28);
      expect(button.querySelector('svg')?.getAttribute('width')).toBe('13');
    }
  });

  it('preserves context record text and active-toggle payload while making metadata readable', () => {
    const toggle = vi.fn();
    const record: ContextRecord = {
      id: 'context-font-fixture',
      novelId: 'novel-font-fixture',
      title: '重要线索',
      content: '保留完整记录与重要度。',
      contextType: 'rule',
      importance: 4,
      isActive: true,
      isExpired: true,
      createdAt: '2026-09-05',
      updatedAt: '2026-09-05',
    };
    const view = render(<ContextRecordList records={[record]} onToggleActive={toggle} />);
    expectReadableInlineText(view.container);
    expect(view.container.querySelector('svg')?.getAttribute('width')).toBe('11');
    fireEvent.click(screen.getByRole('button', { name: '停用' }));
    expect(toggle).toHaveBeenCalledWith(record.id, false);
    expect(screen.getByText(record.content)).toBeTruthy();
    view.rerender(<ContextRecordList records={[record]} compact />);
    expectReadableInlineText(view.container);
  });

  it('keeps form labels readable and preserves explicit context-save validation and scope', () => {
    const onSave = vi.fn();
    const view = render(
      <ContextRecordForm
        novelId="novel-font-fixture"
        chapterId="chapter-font-fixture"
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );
    expectReadableInlineText(view.container);
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText('如：主角不能暴露能力'), {
      target: { value: '作用域标题' },
    });
    fireEvent.change(screen.getByPlaceholderText('详细描述需要记住的信息'), {
      target: { value: '正文不可被排版修改。' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(onSave).toHaveBeenCalledWith({
      novelId: 'novel-font-fixture',
      chapterId: 'chapter-font-fixture',
      contextType: 'other',
      title: '作用域标题',
      content: '正文不可被排版修改。',
      importance: 3,
    });
  });

  it('keeps summary status, key events, timestamp and hints readable without invoking generation', () => {
    const generate = vi.fn();
    const view = render(
      <ChapterSummaryPanelView
        aiSettings={{ runtimeMode: 'mock' } as AiSettings}
        chapter={{ id: 'chapter-font-fixture' } as Chapter}
        summary={{
          id: 'summary-font-fixture',
          novelId: 'novel-font-fixture',
          chapterId: 'chapter-font-fixture',
          volumeId: 'volume-font-fixture',
          adoptedDraftId: 'draft-font-fixture',
          summary: '原始章节摘要。',
          keyEvents: ['已确认事件'],
          nextChapterHints: '后续建议',
          validationStatus: 'passed',
          enabled: false,
          isExpired: true,
          createdAt: '2026-09-05T00:00:00Z',
          updatedAt: '2026-09-05T00:00:00Z',
        }}
        genResult={null}
        validation={null}
        genLoading={false}
        genError=""
        saveSuccess={false}
        onGenerateSummary={generate}
        onSaveSummary={vi.fn()}
        onDiscardResult={vi.fn()}
        onToggleSummary={vi.fn()}
      />,
    );
    expectReadableInlineText(view.container);
    expect(screen.getByText('已归卷')).toBeTruthy();
    expect(screen.getByText('后续建议')).toBeTruthy();
    expect(generate).not.toHaveBeenCalled();
  });

  it('keeps template source badges readable and its form close target at least 28px', () => {
    const onUse = vi.fn();
    const template = {
      id: 'template-font-fixture',
      name: '字体测试模板',
      type: 'custom' as const,
      description: '模板说明',
      content: '模板原文',
      tags: ['来源标记'],
      variables: [],
      source: 'user_created' as const,
      createdAt: '2026-09-05',
      updatedAt: '2026-09-05',
    };
    const view = render(
      <UserTemplateCard
        template={template}
        expanded
        onToggle={vi.fn()}
        onUse={onUse}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(
      Array.from(view.container.querySelectorAll<HTMLElement>('[style]')).filter((element) =>
        Boolean(element.style.fontSize),
      ),
    ).toEqual([]);
    expect(view.container.firstElementChild?.classList.contains('resource-card')).toBe(true);
    expect(view.container.querySelectorAll('.resource-pill').length).toBe(3);
    expect(view.container.querySelector('.resource-pre')?.textContent).toBe(template.content);
    fireEvent.click(screen.getByRole('button', { name: '使用' }));
    expect(onUse).toHaveBeenCalledWith(template.content, template.name);
    view.unmount();
    const onCancel = vi.fn();
    render(
      <TemplateEditorForm
        editing={false}
        name=""
        type="custom"
        description=""
        tags=""
        content=""
        saving={false}
        onNameChange={vi.fn()}
        onTypeChange={vi.fn()}
        onDescriptionChange={vi.fn()}
        onTagsChange={vi.fn()}
        onContentChange={vi.fn()}
        onSave={vi.fn()}
        onCancel={onCancel}
      />,
    );
    const close = screen.getByRole('button', { name: '关闭表单' });
    expect(close.classList.contains('resource-icon-button')).toBe(true);
    expect(close.querySelector('svg')?.getAttribute('width')).toBe('16');
    fireEvent.click(close);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
