import { browser, expect } from '@wdio/globals';
import {
  assertCleanDiagnostics,
  bridgeCall,
  clickTestId,
  navigateHash,
  waitForTestId,
} from './helpers';

const TITLE = `E2E TXT atomic import ${Date.now()}`;
const TXT = [
  '第一章 开端',
  '开端的正文第一段。',
  '开端的正文第二段，包含 English words。',
  '',
  '第二章 转折',
  '转折之后的正文。',
].join('\n');

async function selectTxt(content: string): Promise<void> {
  await clickTestId('project-import-txt');
  // The file input is intentionally hidden; wait for existence, not visibility.
  await browser.$('[data-testid="txt-import-file"]').waitForExist({ timeout: 30000 });
  // Feed the native WebView file input so analysis, confirmation and the
  // single-transaction Rust import command all run through production code.
  await browser.execute(
    (text, fileName) => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="txt-import-file"]');
      if (!input) throw new Error('TXT import file input is missing');
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], fileName, { type: 'text/plain' }));
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    content,
    `${TITLE}.txt`,
  );
  await waitForTestId('txt-import-confirm');
}

describe('TXT import single transaction', () => {
  it('creates the novel, volume, chapters and imported drafts through one Rust transaction', async () => {
    const before = await bridgeCall<Array<{ id: string }>>('get_all_novels');
    await navigateHash('#/import-export');
    await clickTestId('project-import-tab');
    await selectTxt(TXT);

    const titleInput = await browser.$('input[aria-label="作品名称"]');
    await titleInput.waitForDisplayed();
    await titleInput.setValue(TITLE);
    const confirm = await waitForTestId('txt-import-confirm');
    await confirm.waitForEnabled();
    await confirm.click();
    await waitForTestId('txt-import-done');

    const after = await bridgeCall<Array<{ id: string; title: string }>>('get_all_novels');
    expect(after).toHaveLength(before.length + 1);
    const imported = after.find((novel) => novel.title === TITLE);
    expect(imported).toBeDefined();

    const chapters = await bridgeCall<Array<{ id: string; title: string; orderIndex: number }>>(
      'get_chapters_by_novel_id',
      { novelId: imported!.id },
    );
    expect(
      [...chapters]
        .sort((left, right) => left.orderIndex - right.orderIndex)
        .map((chapter) => chapter.title),
    ).toEqual(['第一章 开端', '第二章 转折']);

    for (const chapter of chapters) {
      const drafts = await bridgeCall<Array<{ id: string; source: string; isAdopted?: boolean }>>(
        'get_drafts_by_chapter_id',
        { chapterId: chapter.id },
      );
      expect(drafts).toHaveLength(1);
      expect(drafts[0].source).toBe('imported');
      expect(Boolean(drafts[0].isAdopted)).toBe(false);
    }
    await assertCleanDiagnostics();
  });
});
