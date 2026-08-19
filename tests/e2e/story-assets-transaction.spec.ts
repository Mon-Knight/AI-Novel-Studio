import { browser, expect } from '@wdio/globals';
import {
  bridgeCall,
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  navigateHash,
  openWorkspace,
  unique,
} from './helpers';

interface FactionAssetDto {
  id: string;
  novelId: string;
  name: string;
  revision: number;
}

interface ChapterDto {
  id: string;
  goal: string;
}

describe('official story assets and cross-chapter transactions', () => {
  it('creates a faction atomically and applies only an approved chapter subset', async () => {
    const projectId = await createProjectThroughUi(unique('E2E Story Assets'));
    await openWorkspace(projectId);
    const volumeId = await createVolumeThroughUi(unique('E2E Asset Volume'));
    const firstChapterId = await createChapterThroughUi('E2E Asset Chapter 1', volumeId);
    const secondChapterId = await createChapterThroughUi('E2E Asset Chapter 2', volumeId);

    await navigateHash(`#/novels/${projectId}/story-assets`);
    const page = await browser.$('.story-assets-page');
    await page.waitForDisplayed({ timeout: 30_000 });

    const factionName = unique('Northern Council');
    const assetForm = await page.$('.story-assets-form');
    const assetInputs = await assetForm.$$('input');
    await assetInputs[0].setValue(factionName);
    await assetInputs[1].setValue('frontier alliance');
    await assetInputs[2].setValue('defend the northern pass');
    await (await assetForm.$('textarea')).setValue('A coalition that controls the mountain route.');
    await (await assetForm.$('button[type="submit"]')).click();

    const factionReview = await page.$('.story-assets-review');
    await factionReview.waitForDisplayed({ timeout: 30_000 });
    const factionApply = await factionReview.$('.story-assets-review-actions .btn-primary');
    await factionApply.waitForEnabled({ timeout: 30_000 });
    await factionApply.click();
    await factionReview.waitForDisplayed({ reverse: true, timeout: 30_000 });

    const factions = await bridgeCall<FactionAssetDto[]>('list_faction_assets', {
      input: { novelId: projectId, limit: 500 },
    });
    expect(factions.filter((item) => item.name === factionName)).toHaveLength(1);
    expect(factions.find((item) => item.name === factionName)?.novelId).toBe(projectId);

    const pageTabs = await page.$$('.story-assets-page-tabs button');
    await pageTabs[1].click();
    const batchToolbar = await page.$('.story-assets-batch-toolbar');
    await batchToolbar.waitForDisplayed({ timeout: 30_000 });
    const selectAll = await batchToolbar.$('button');
    await selectAll.waitForClickable({ timeout: 30_000 });
    await selectAll.click();
    const batch = await page.$('.story-assets-card');
    const batchGoal = 'Advance the cross-chapter frontier conflict';
    await (await batch.$('.story-assets-batch-fields input')).setValue(batchGoal);
    await (await batch.$('button[type="submit"]')).click();

    const batchReview = await page.$('.story-assets-review');
    await batchReview.waitForDisplayed({ timeout: 30_000 });
    const targetCheckboxes = await batchReview.$$(
      '.story-assets-review-row input[type="checkbox"]',
    );
    expect(targetCheckboxes).toHaveLength(2);
    await targetCheckboxes[0].click();
    const batchApply = await batchReview.$('.story-assets-review-actions .btn-primary');
    await batchApply.waitForEnabled({ timeout: 30_000 });
    await batchApply.click();
    await batchReview.waitForDisplayed({ reverse: true, timeout: 30_000 });

    const first = await bridgeCall<ChapterDto>('get_chapter_by_id', { id: firstChapterId });
    const second = await bridgeCall<ChapterDto>('get_chapter_by_id', { id: secondChapterId });
    expect(first.goal).toBe(batchGoal);
    expect(second.goal).not.toBe(batchGoal);
  });
});
