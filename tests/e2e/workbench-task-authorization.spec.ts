import { browser, expect } from '@wdio/globals';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CompleteProjectBackup } from '../../src/services/backup/projectBackupSchema';
import {
  assertCleanDiagnostics,
  bridgeCall,
  clickTestId,
  createChapterThroughUi,
  createProjectThroughUi,
  createVolumeThroughUi,
  fillTestId,
  findTestIdByAttribute,
  navigateHash,
  openWorkspace,
  seedChapterCoreAssetsForE2e,
  waitForTestId,
  waitForTestIdMissing,
} from './helpers';

interface Bundle {
  conversation: { status: string; novelId: string };
  turns: Array<{ turnId: string; role: string }>;
  artifacts: Array<{
    cardId: string;
    artifactId: string;
    artifactType: string;
    status: string;
  }>;
}
interface Artifact {
  rawContent: string;
  artifact: { contentHash: string; sourceNovelId: string; sourceChapterId?: string };
}
interface Draft {
  id: string;
  content: string;
  isAdopted: boolean;
  chapterId: string;
  novelId: string;
}
interface Grant {
  authorizationId: string;
  conversationId: string;
  novelId: string;
  sourceTurnId: string;
  status: string;
  usedWrites: number;
  revokedAt?: string;
  spec: { maxWrites: number; actions: Array<{ action: string; maxWrites: number }> };
}
interface Receipt {
  receiptId: string;
  authorizationId: string;
  operationId: string;
  conversationId: string;
  novelId: string;
  artifactId: string;
  cardId: string;
  action: string;
  authority: string;
  result: Record<string, unknown>;
  createdAt: string;
}
interface BackupTables {
  task_authorizations: Array<Record<string, unknown>>;
  task_authorization_receipts: Array<Record<string, unknown>>;
  review_authorizations: Array<Record<string, unknown>>;
  artifact_decisions: Array<Record<string, unknown>>;
}
interface Backup extends CompleteProjectBackup {
  tables: CompleteProjectBackup['tables'] & BackupTables;
}

const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const listGrants = (conversationId: string) =>
  bridgeCall<Grant[]>('list_task_authorizations', { conversationId });
const listReceipts = (authorizationId: string) =>
  bridgeCall<Receipt[]>('list_task_authorization_receipts', { authorizationId });

describe('production native task preauthorization', () => {
  const verifyBoundedAdoption = async (maxWrites: 1 | 2) => {
    await waitForTestId('app-shell');
    await browser.execute(() =>
      localStorage.setItem('ai_novel_studio_e2e_workbench_model', 'enabled'),
    );
    const novelId = await createProjectThroughUi(`E2E 任务预授权 ${maxWrites}`);
    await openWorkspace(novelId);
    const volumeId = await createVolumeThroughUi('预授权卷');
    const chapterId = await createChapterThroughUi('第一章 自动采用', volumeId);
    const readiness = await seedChapterCoreAssetsForE2e({
      novelId,
      worldSetting: { title: '旧城', content: '旧城雨后街道保留可核对的脚印与钟声。' },
      ruleSystem: {
        title: '证据规则',
        content: '线索必须由人物实际取得，不能凭空出现。',
        forbiddenRules: '不得抹去已经发生的选择。',
      },
      protagonist: {
        name: '沈岚',
        identity: '记录员',
        personality: '审慎',
        goal: '核对旧城当晚的记录',
      },
      chapters: [
        {
          chapterId,
          title: '第一章 自动采用',
          outline: '沈岚沿雨后街道核对钟声与脚印，并保留一条完整线索。',
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
    await fillTestId(
      'workbench-new-task-goal',
      '生成第一章正文，2000字，描写雨后街道核对钟声与脚印',
    );
    await (await waitForTestId('workbench-new-task-chapter')).selectByAttribute('value', chapterId);
    const start = await waitForTestId('workbench-create-and-start');
    await start.waitForEnabled({ timeout: 30000 });
    await start.click();
    const header = await waitForTestId('workbench-task-header');
    const conversationId = (await header.getAttribute('data-conversation-id'))!;
    expect(conversationId).toBeTruthy();
    const readBundle = () => bridgeCall<Bundle>('get_task_conversation', { conversationId });
    await browser.waitUntil(
      async () => {
        const bundle = await readBundle();
        return (
          bundle?.conversation.status === 'waiting_user' &&
          bundle.artifacts.filter((item) => item.artifactType === 'chapter_text').length === 1
        );
      },
      { timeout: 60000, timeoutMsg: 'Expected one persisted chapter_text candidate' },
    );
    const waiting = await readBundle();
    const rootTurn = waiting.turns.find((turn) => turn.role === 'user')!.turnId;
    const candidate = waiting.artifacts.find((item) => item.artifactType === 'chapter_text')!;
    const artifact = await bridgeCall<Artifact>('get_result_artifact', {
      input: { artifactId: candidate.artifactId },
    });
    expect(artifact.artifact.sourceNovelId).toBe(novelId);
    expect(artifact.artifact.sourceChapterId).toBe(chapterId);
    expect(hash(artifact.rawContent)).toBe(artifact.artifact.contentHash);
    expect((await listGrants(conversationId)).length).toBe(0);
    expect(
      (await bridgeCall<Draft[]>('get_drafts_by_chapter_id', { chapterId })).some(
        (draft) => draft.isAdopted,
      ),
    ).toBe(false);

    await clickTestId('workbench-task-authorization-manage');
    await waitForTestId('workbench-task-authorization-dialog');
    const action = await findTestIdByAttribute(
      'workbench-task-authorization-action',
      'data-action',
      'adopt_chapter_text',
    );
    await action.click();
    if (maxWrites === 2) {
      // Leave real capacity after one write so revocation is not a no-op on an exhausted grant.
      for (const label of ['本次授权正式写入总上限', '自动采用正文候选最多次数']) {
        const limit = await browser.$(
          `//label[normalize-space(.)="${label}"]/input[@type="number"]`,
        );
        await limit.waitForDisplayed();
        await limit.click();
        await browser.keys('ArrowUp');
        expect(await limit.getValue()).toBe('2');
      }
    }
    await clickTestId('workbench-task-authorization-issue');

    let grants: Grant[] = [];
    let receipts: Receipt[] = [];
    await browser.waitUntil(
      async () => {
        grants = await listGrants(conversationId);
        if (grants.length !== 1) return false;
        receipts = await listReceipts(grants[0].authorizationId);
        return receipts.length === 1;
      },
      {
        timeout: 90000,
        timeoutMsg: 'Native reconciliation did not commit a task-preauthorized adoption receipt',
      },
    );
    const grant = grants[0];
    const receipt = receipts[0];
    expect(grant).toMatchObject({
      conversationId,
      novelId,
      sourceTurnId: rootTurn,
      usedWrites: 1,
    });
    expect(grant.status).toBe(maxWrites === 1 ? 'exhausted' : 'active');
    expect(grant.spec.maxWrites).toBe(maxWrites);
    expect(grant.spec.actions).toEqual([{ action: 'adopt_chapter_text', maxWrites }]);
    expect(receipt).toMatchObject({
      authorizationId: grant.authorizationId,
      conversationId,
      novelId,
      artifactId: candidate.artifactId,
      cardId: candidate.cardId,
      action: 'adopt_chapter_text',
      authority: 'task_preauthorized',
    });
    expect(receipt.operationId).toContain(candidate.cardId);
    const adoptedDraftId = receipt.result.adoptedDraftId as string;
    expect(adoptedDraftId).toBeTruthy();
    const adopted = await bridgeCall<Draft>('get_adopted_draft_by_chapter_id', { chapterId });
    expect(adopted.id).toBe(adoptedDraftId);
    expect(adopted.content).toBe(artifact.rawContent);
    expect(hash(adopted.content)).toBe(hash(artifact.rawContent));

    if (maxWrites === 2) {
      const revoke = await findTestIdByAttribute(
        'workbench-task-authorization-revoke',
        'data-authorization-id',
        grant.authorizationId,
      );
      await revoke.waitForEnabled();
      await revoke.click();
      await browser.waitUntil(
        async () => {
          grants = await listGrants(conversationId);
          return grants.length === 1 && grants[0].status === 'revoked';
        },
        { timeout: 15000, timeoutMsg: 'Revocation was not committed to SQLite' },
      );
      expect(grants[0]).toMatchObject({ authorizationId: grant.authorizationId, usedWrites: 1 });
      expect(grants[0].revokedAt).toBeTruthy();
      await waitForTestIdMissing('workbench-task-authorization-revoke');
      expect(await listReceipts(grant.authorizationId)).toEqual(receipts);
    }

    const backup = await bridgeCall<Backup>('export_project_backup', { novelId });
    const backedGrant = backup.tables.task_authorizations.find(
      (row) => row.authorization_id === grant.authorizationId,
    );
    expect(backedGrant).toBeDefined();
    expect(backedGrant!.status).toBe(grants[0].status);
    expect(backup.tables.task_authorization_receipts).toHaveLength(1);
    expect(
      backup.tables.artifact_decisions.filter(
        (row) => row.actor === 'task_preauthorized' && row.artifact_id === candidate.artifactId,
      ),
    ).toHaveLength(1);
    const falseManualReview = backup.tables.review_authorizations.filter(
      (row) => row.artifact_id === candidate.artifactId,
    );
    expect(falseManualReview).toHaveLength(0);

    // Both exhausted and explicitly revoked grants remain terminal across a real process restart.
    await assertCleanDiagnostics();
    await browser.reloadSession();
    await waitForTestId('app-shell');
    // A real restart settles the in-memory native root as interrupted. Acknowledge
    // the truthful recovery dialog before reading durable authority facts.
    const recovery = await browser.$('[data-testid="conversation-recovery-dialog"]');
    if (await recovery.isExisting()) {
      await clickTestId('conversation-recovery-dismiss');
      await waitForTestIdMissing('conversation-recovery-dialog');
    }
    await navigateHash('#/');
    await waitForTestId('creative-workbench');
    await (await findTestIdByAttribute('workbench-project', 'data-novel-id', novelId)).click();
    await (
      await findTestIdByAttribute('workbench-task', 'data-conversation-id', conversationId)
    ).click();
    const grantsAfterRestart = await listGrants(conversationId);
    const receiptsAfterRestart = await listReceipts(grant.authorizationId);
    expect(grantsAfterRestart).toEqual(grants);
    expect(receiptsAfterRestart).toEqual(receipts);
    await clickTestId('workbench-task-authorization-manage');
    const restoredGrant = await findTestIdByAttribute(
      'workbench-task-authorization-grant',
      'data-authorization-id',
      grant.authorizationId,
    );
    expect(await restoredGrant.getAttribute('data-status')).toBe(grantsAfterRestart[0].status);
    const restoredReceipt = await findTestIdByAttribute(
      'workbench-task-authorization-receipt',
      'data-receipt-id',
      receipt.receiptId,
    );
    expect(await restoredReceipt.getAttribute('data-authority')).toBe('task_preauthorized');
    await browser.keys('Escape');
    await waitForTestIdMissing('workbench-task-authorization-dialog');
    const adoptedAfterRestart = await bridgeCall<Draft>('get_adopted_draft_by_chapter_id', {
      chapterId,
    });
    expect(adoptedAfterRestart.id).toBe(adoptedDraftId);
    expect(adoptedAfterRestart.content).toBe(artifact.rawContent);
    expect(
      (await bridgeCall<Draft[]>('get_drafts_by_chapter_id', { chapterId })).filter(
        (draft) => draft.isAdopted,
      ),
    ).toHaveLength(1);

    const artifactRoot = process.env.AI_NOVEL_STUDIO_E2E_ARTIFACTS!;
    fs.writeFileSync(
      path.join(
        artifactRoot,
        maxWrites === 1 ? 'task-authorization-evidence.json' : 'task-revocation-evidence.json',
      ),
      JSON.stringify(
        {
          storageMode: 'sqlite',
          provider: 'deterministic-mock',
          ui: 'production',
          authority: 'task_preauthorized',
          action: 'adopt_chapter_text',
          grantFingerprint: hash(grant.authorizationId),
          receiptFingerprint: hash(receipt.receiptId),
          candidateFingerprint: hash(candidate.artifactId),
          adoptedContentHash: hash(artifact.rawContent),
          usedWrites: grant.usedWrites,
          maxWrites,
          grantStatus: grantsAfterRestart[0].status,
          manualReviewRecords: falseManualReview.length,
          restartVerified: true,
          secondAutomaticWrite: false,
          revokedActiveGrantViaUi: maxWrites === 2,
          receiptRetainedAfterRestart: true,
        },
        null,
        2,
      ),
    );
    await assertCleanDiagnostics();
  };
  it('exhausts the default one-write grant and retains its single adoption across restart', () =>
    verifyBoundedAdoption(1));
  it('revokes a partially used active grant through the UI without undoing its receipt across restart', () =>
    verifyBoundedAdoption(2));
});
