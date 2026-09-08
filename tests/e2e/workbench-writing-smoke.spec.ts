import { browser, expect } from '@wdio/globals';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  assertCleanDiagnostics,
  bridgeCall,
  clickTestId,
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  fillTestId,
  fillTextareaTestId,
  findTestIdByAttribute,
  navigateHash,
  openWorkspace,
  seedChapterCoreAssetsForE2e,
  waitForTestId,
  waitForTestIdAttribute,
} from './helpers';

interface Bundle {
  conversation: { status: string; novelId: string };
  artifacts: Array<{ artifactId: string; artifactType: string }>;
  runs: Array<{ runId: string; status: string; turnId: string }>;
}
interface Artifact {
  rawContent: string;
  artifact: { contentHash: string; sourceNovelId: string; sourceChapterId: string };
}
interface Draft {
  id: string;
  content: string;
  isAdopted: boolean;
  chapterId: string;
  novelId: string;
}
interface Authorization {
  status: string;
  consumedByDraftId?: string;
  artifactId: string;
  novelId: string;
  chapterId: string;
}
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

describe('production writing smoke', () => {
  it('creates, revises, reviews, saves and adopts through the production UI, then restores the same text after a process restart', async () => {
    await waitForTestId('app-shell');
    await browser.execute(() =>
      localStorage.setItem('ai_novel_studio_e2e_workbench_model', 'enabled'),
    );
    const novelId = await createProjectThroughUi('E2E 日常写作');
    await openWorkspace(novelId);
    const volumeId = await createVolumeThroughUi('第一卷 仙门初入');
    const chapterId = await createChapterThroughUi('第一章 苍穹惊变', volumeId);
    // Test instrumentation must not silently restore the retired production entry.
    expect(await browser.$('[data-testid="ai-generate"]').isExisting()).toBe(false);
    const readiness = await seedChapterCoreAssetsForE2e({
      novelId,
      worldSetting: { title: '苍穹大陆', content: '宗门坐落于连绵山脉，演武场是弟子试炼之地。' },
      ruleSystem: {
        title: '修炼规则',
        content: '突破需要积累与代价，不能凭空掌握新的力量。',
        forbiddenRules: '不得忽略伤势和疲劳。',
      },
      protagonist: {
        name: '林辰',
        identity: '外门弟子',
        personality: '冷静坚韧',
        goal: '通过试炼守护同伴',
      },
      chapters: [
        {
          chapterId,
          title: '第一章 苍穹惊变',
          outline: '演武场激战，主角遭遇强敌，风雨中天生异象。',
          targetWordCount: 600,
        },
      ],
    });
    expect(readiness.storageMode).toBe('sqlite');
    expect(readiness.readiness).toEqual([{ chapterId, ready: true, missingAssets: [] }]);
    await navigateHash('#/');
    await waitForTestId('creative-workbench');
    await (await findTestIdByAttribute('workbench-project', 'data-novel-id', novelId)).click();
    await clickTestId('workbench-create-task');
    await fillTestId('workbench-new-task-goal', '生成第一章正文，2000字，描写演武场激战与天生异象');
    await (await waitForTestId('workbench-new-task-chapter')).selectByAttribute('value', chapterId);
    const start = await waitForTestId('workbench-create-and-start');
    await start.waitForEnabled({ timeout: 30000 });
    await start.click();
    const header = await waitForTestId('workbench-task-header');
    const conversationId = (await header.getAttribute('data-conversation-id'))!;
    expect(conversationId).toBeTruthy();
    const readBundle = () => bridgeCall<Bundle>('get_task_conversation', { conversationId });
    const waitForCandidates = async (count: number) => {
      await browser.waitUntil(
        async () => {
          const bundle = await readBundle();
          return (
            bundle?.conversation.status === 'waiting_user' &&
            bundle.artifacts.filter((item) => item.artifactType === 'chapter_text').length === count
          );
        },
        { timeout: 60000, timeoutMsg: `Expected ${count} persisted chapter candidates` },
      );
      return readBundle();
    };
    const initial = await waitForCandidates(1);
    const firstId = initial.artifacts.find(
      (item) => item.artifactType === 'chapter_text',
    )!.artifactId;
    const first = await findTestIdByAttribute(
      'workbench-artifact-card',
      'data-artifact-id',
      firstId,
    );
    await first.$('[data-testid="workbench-artifact-revise"]').click();
    await waitForTestIdAttribute('workbench-conversation-status', 'data-status', 'idle');
    await fillTestId(
      'workbench-composer-input',
      '重新修改这一版正文，节奏放慢，着重渲染风雨交加与心理压迫感',
    );
    await clickTestId('workbench-send-task');
    const revised = await waitForCandidates(2);
    const revisedId = revised.artifacts.find(
      (item) => item.artifactType === 'chapter_text' && item.artifactId !== firstId,
    )!.artifactId;
    const candidate = await bridgeCall<Artifact>('get_result_artifact', {
      input: { artifactId: revisedId },
    });
    const original = await bridgeCall<Artifact>('get_result_artifact', {
      input: { artifactId: firstId },
    });
    expect(candidate.artifact.sourceNovelId).toBe(novelId);
    expect(candidate.artifact.sourceChapterId).toBe(chapterId);
    expect(hash(candidate.rawContent)).toBe(candidate.artifact.contentHash);
    expect(candidate.artifact.contentHash).not.toBe(original.artifact.contentHash);
    const beforeReview = await bridgeCall<Draft[]>('get_drafts_by_chapter_id', { chapterId });
    expect(beforeReview.some((draft) => draft.isAdopted)).toBe(false);
    const card = await findTestIdByAttribute(
      'workbench-artifact-card',
      'data-artifact-id',
      revisedId,
    );
    await card.$('[data-testid="workbench-artifact-confirm-review"]').click();
    await waitForTestId('chapter-review-lock');
    const route = await browser.execute(() => location.hash);
    const authorizationId = new URLSearchParams(route.split('?')[1]).get('authorizationId')!;
    expect(authorizationId).toBeTruthy();
    const editor = await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);
    expect(await editor.getAttribute('data-review-locked')).toBe('true');
    expect(await editor.getValue()).toBe(candidate.rawContent);
    await clickTestId('chapter-review-unlock');
    const content = candidate.rawContent + '\n\n【日常写作验收：用户已审阅并修订】';
    await fillTextareaTestId('chapter-editor', content);
    await clickTestId('chapter-save');
    await browser.waitUntil(async () => (await editor.getAttribute('data-dirty')) === 'false', {
      timeout: 30000,
    });
    const draftId = (await editor.getAttribute('data-draft-id'))!;
    expect(draftId.startsWith('candidate-')).toBe(false);
    const saved = await bridgeCall<Draft[]>('get_drafts_by_chapter_id', { chapterId });
    expect(saved.find((draft) => draft.id === draftId)?.content).toBe(content);
    expect(saved.some((draft) => draft.isAdopted)).toBe(false);
    await clickTestId('chapter-adopt');
    await waitForTestId('apply-confirm');
    await clickTestId('dialog-confirm');
    await waitForTestIdAttribute('chapter-editor', 'data-adopted', 'true');
    const auth = await bridgeCall<Authorization>('get_review_authorization', { authorizationId });
    expect(auth).toMatchObject({
      status: 'consumed',
      consumedByDraftId: draftId,
      artifactId: revisedId,
      novelId,
      chapterId,
    });

    // Mock cannot run the API-only summary flow. Verify the real failure boundary
    // without calling it a successful summary or changing production authorization.
    await navigateHash('#/');
    await waitForTestId('creative-workbench');
    await (await findTestIdByAttribute('workbench-project', 'data-novel-id', novelId)).click();
    await (
      await findTestIdByAttribute('workbench-task', 'data-conversation-id', conversationId)
    ).click();
    await browser.waitUntil(
      async () => {
        const failure = await browser.$(
          '[data-testid="workbench-summary-orchestration"][data-phase="failed"]',
        );
        const composer = await browser.$('[data-testid="workbench-composer-error"]');
        return (
          (await failure.isExisting()) ||
          ((await composer.isExisting()) &&
            (await composer.getText()).includes('runtimeMode 必须是 api'))
        );
      },
      { timeout: 30000, timeoutMsg: 'Mock summary must fail explicitly before starting a Run' },
    );
    expect((await readBundle()).runs).toHaveLength(2);
    expect(await bridgeCall<unknown>('get_chapter_summary', { chapterId })).toBeNull();
    const before = await bridgeCall<{ processId: number }>('get_e2e_agent_closed_loop_state');
    await assertCleanDiagnostics();
    await browser.reloadSession();
    await waitForTestId('app-shell');
    const after = await bridgeCall<{ processId: number }>('get_e2e_agent_closed_loop_state');
    expect(after.processId).toBeGreaterThan(0);
    expect(after.processId).not.toBe(before.processId);
    await openWorkspace(novelId);
    await (await findTestIdByAttribute('chapter-item', 'data-chapter-id', chapterId)).click();
    const restored = await waitForTestIdAttribute('chapter-editor', 'data-chapter-id', chapterId);
    expect(await restored.getValue()).toBe(content);
    expect(await restored.getAttribute('data-adopted')).toBe('true');
    expect(await browser.$('[data-testid="ai-generate"]').isExisting()).toBe(false);
    const persisted = await bridgeCall<Draft[]>('get_drafts_by_chapter_id', { chapterId });
    expect(persisted.filter((draft) => draft.isAdopted)).toHaveLength(1);
    expect(persisted.find((draft) => draft.id === draftId)).toMatchObject({
      content,
      isAdopted: true,
      novelId,
      chapterId,
    });
    expect(
      await bridgeCall<Authorization>('get_review_authorization', { authorizationId }),
    ).toEqual(auth);
    expect((await readBundle()).runs).toHaveLength(2);
    const artifactRoot = process.env.AI_NOVEL_STUDIO_E2E_ARTIFACTS!;
    fs.writeFileSync(
      path.join(artifactRoot, 'writing-smoke-evidence.json'),
      JSON.stringify(
        {
          storageMode: 'sqlite',
          ui: 'production',
          provider: 'deterministic-mock',
          beforePid: before.processId,
          afterPid: after.processId,
          adoptedContentHash: hash(content),
          reviewGrantFingerprint: hash(authorizationId),
          summary: 'expected pre-Run failure; not success evidence',
        },
        null,
        2,
      ),
    );
    await assertCleanDiagnostics();
  });
});
