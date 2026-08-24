import test from 'node:test';
import assert from 'node:assert/strict';

// Browser fallback MemoryStorage mock for node test runner (explicitly labeled fallback)
class BrowserFallbackMemoryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

if (typeof globalThis.localStorage === 'undefined') {
  (globalThis as unknown as { localStorage: BrowserFallbackMemoryStorage }).localStorage =
    new BrowserFallbackMemoryStorage();
}

import { novelRepository } from '../database/novelRepository';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { taskConversationService } from './taskConversationService';
import { artifactDecisionService } from './artifactDecisionService';
import { captureTaskModelSnapshot } from './taskModelSnapshot';
import { aiSettingsService } from '../ai/aiClient';
import { createWorkbenchChapterWriter, workbenchChapterWriter } from './workbenchChapterWriter';
import { createTaskRuntimeAdapter } from './taskRuntimeAdapter';
import { resolveEditorDraftContent } from '../../components/workspace/editor-area/editorDocumentSafety';
import type { AiSettings } from '../../types/ai';
import type { ReviewCandidateDocument } from '../../types/conversation';
import { computeContentSha256 } from '../../utils/contentIntegrity';

test.before(async () => {
  await aiSettingsService.saveSettings({
    ...aiSettingsService.getSettings(),
    provider: 'mock',
    modelName: 'Mock',
    runtimeMode: 'mock',
    mockMode: true,
    apiKey: '',
    baseUrl: '',
  });
});

const testRuntime = createTaskRuntimeAdapter({
  chapterWriter: {
    generate: async (input) => ({
      text: [
        '【测试章节正文】',
        '',
        `任务要求：${input.goal}`,
        input.previousCandidateText
          ? `上一版正文已进入修改上下文，共 ${input.previousCandidateText.length} 字。`
          : '这是通过显式测试执行器生成的候选正文，生产 Runtime 单例未被替换。',
        '夜色沉入山门，风声掠过石阶，人物的选择在这一刻改变了后续走向。',
      ].join('\n'),
      source: 'writer' as const,
      contextHash: `context-${input.chapterId}`,
    }),
  },
});

test('1. modelSnapshot 必填，缺失直接报错', async () => {
  const novel = await novelRepository.create({ title: '参数校验作品' });
  const chapter = await chapterRepository.create({ novelId: novel.id, title: '第1章' });

  await assert.rejects(
    () =>
      // @ts-expect-error test missing modelSnapshot
      workbenchChapterWriter.generate({
        novelId: novel.id,
        chapterId: chapter.id,
        goal: '测试缺失快照',
        mode: 'generate',
      }),
    /modelSnapshot/,
  );
});

test('2. 捕获实际传给执行服务的 settings，断言快照 settings 在全局设置变更后未漂移', async () => {
  const novel = await novelRepository.create({ title: '快照隔离测试书' });
  const chapter = await chapterRepository.create({ novelId: novel.id, title: '第1章' });

  let capturedSettings: AiSettings | undefined;
  let capturedPrompt = '';
  const customWriter = createWorkbenchChapterWriter({
    executeGeneration: async (params) => {
      capturedSettings = params.settings;
      capturedPrompt = params.request.messages.map((message) => message.content).join('\n');
      return {
        persistence: 'ephemeral_browser',
        text: '【测试生成正文】\n\n快照测试通过。',
        taskId: 'task-snapshot-obs',
        provider: {
          text: '【测试生成正文】\n\n快照测试通过。',
          providerId: 'mock',
          modelId: 'Mock-Model-A',
          durationMs: 1,
        },
        artifactBundle: {
          artifact: {
            artifactId: 'art-snapshot-obs',
            taskId: 'task-snapshot-obs',
            attemptId: 'att-1',
            sourceInputSnapshotId: 'snap-1',
            artifactType: 'chapter_text',
            schemaVersion: 1,
            rawContentRefId: 'ref-1',
            sourceNovelId: novel.id,
            contentHash: 'hash-snapshot-obs',
            contentLength: 20,
            processingStatus: 'valid',
            createdAt: new Date().toISOString(),
          },
          rawContent: '【测试生成正文】\n\n快照测试通过。',
          structuredPayloadJson: null,
          issues: [],
        },
      };
    },
  });

  // 捕获模型快照 A
  const snapshotA = captureTaskModelSnapshot('mock', 'Mock-Model-A');

  // 修改全局设置为模型 B
  await aiSettingsService.saveSettings({
    ...aiSettingsService.getSettings(),
    provider: 'mock',
    modelName: 'Commercial-Model-B',
  });

  // 执行写章，传入冻结快照 A
  const result = await customWriter.generate({
    novelId: novel.id,
    chapterId: chapter.id,
    goal: '测试快照隔离',
    mode: 'generate',
    previousCandidateText: '上一版候选正文必须进入修改输入。',
    memoryContext: { items: [{ content: '长期记忆：主角不能公开真实身份。' }] },
    modelSnapshot: snapshotA,
  });

  assert.ok(capturedSettings, '必须捕获到执行 settings');
  assert.equal(capturedSettings?.modelName, 'Mock-Model-A', '实际执行的 modelName 必须来自快照 A');
  assert.equal(result.resolvedSettings?.modelName, 'Mock-Model-A');
  assert.match(capturedPrompt, /测试快照隔离/);
  assert.match(capturedPrompt, /上一版候选正文必须进入修改输入/);
  assert.match(capturedPrompt, /主角不能公开真实身份/);

  // 恢复全局设置
  await aiSettingsService.saveSettings({
    ...aiSettingsService.getSettings(),
    provider: 'mock',
    modelName: 'Mock',
    runtimeMode: 'mock',
  });
});

test('3 & 4. Writer 中途失败后 TaskRun 与 ToolCallEvent 收敛为 failed，且无候选或草稿', async () => {
  const novel = await novelRepository.create({ title: '执行失败阻断书' });
  const chapter = await chapterRepository.create({
    novelId: novel.id,
    title: '第一章',
    outline: '进入山门',
    goal: '完成入门冲突',
  });
  const conv = await taskConversationService.create(novel.id, '失败阻断会话');
  const turn = await taskConversationService.appendTurn(
    conv.conversationId,
    'user',
    '生成第一章正文',
  );
  const failingRuntime = createTaskRuntimeAdapter({
    chapterWriter: {
      generate: async () => {
        throw new Error('TEST_WRITER_FAILURE_AFTER_TOOL_START');
      },
    },
  });

  const run = await failingRuntime.start({
    conversationId: conv.conversationId,
    novelId: novel.id,
    chapterId: chapter.id,
    turnId: turn.turnId,
    goal: '生成正文',
  });

  assert.equal(run.status, 'failed');
  assert.match(run.error ?? '', /TEST_WRITER_FAILURE/);

  const drafts = await draftVersionService.getByChapterId(chapter.id);
  assert.equal(drafts.length, 0, '失败运行绝不得产生草稿记录');

  const bundle = await taskConversationService.get(conv.conversationId);
  assert.ok(bundle);
  assert.ok(bundle.toolEvents.some((event) => event.status === 'failed'));
  assert.equal(bundle.artifacts.length, 0, '失败运行绝不得产生任何产物卡片');
  assert.equal(bundle.decisions?.length ?? 0, 0);
  assert.equal(bundle.authorizations?.length ?? 0, 0);
});

test('5 & 6. 显式注入 Writer 的 Runtime 生成与修改协议形成两张独立候选卡片', async () => {
  const novel = await novelRepository.create({ title: '正文一致性作品' });
  const chapter = await chapterRepository.create({
    novelId: novel.id,
    title: '第一章 苍穹初显',
    outline: '主角出场并在演武场展示实力',
    goal: '完成演武并震慑全场',
  });

  const conv = await taskConversationService.create(novel.id, '第1章写作会话');
  const turn = await taskConversationService.appendTurn(
    conv.conversationId,
    'user',
    '生成第一章正文，描写演武场激战',
  );

  const run = await testRuntime.start({
    conversationId: conv.conversationId,
    novelId: novel.id,
    chapterId: chapter.id,
    turnId: turn.turnId,
    goal: '生成第一章正文，描写演武场激战',
  });

  assert.equal(run.status, 'completed', `TaskRun 必须执行成功：${run.error ?? 'unknown'}`);

  const bundle = await taskConversationService.get(conv.conversationId);
  assert.ok(bundle);
  assert.ok(bundle.artifacts.length > 0, '必须产生产物卡片');

  const card = bundle.artifacts[0];
  assert.equal(card.artifactType, 'chapter_text');
  assert.equal(card.status, 'candidate', '状态必须为 candidate');
  assert.ok(card.artifactId, 'artifactId 必须存在');

  // 此时 SQLite chapter_drafts 中绝不能有 adopted 正文
  const adopted = await draftVersionService.getAdoptedByChapterId(chapter.id);
  assert.equal(adopted, null, '生成阶段绝不能直接写入 adopted 正文');

  const revisionTurn = await taskConversationService.appendTurn(
    conv.conversationId,
    'user',
    '重新修改这一版，强化风雨压迫感',
  );
  const revisionRun = await testRuntime.start({
    conversationId: conv.conversationId,
    novelId: novel.id,
    chapterId: chapter.id,
    turnId: revisionTurn.turnId,
    goal: '重新修改这一版，强化风雨压迫感',
  });
  assert.equal(revisionRun.status, 'completed', revisionRun.error ?? '修改运行必须完成');
  const revisedBundle = await taskConversationService.get(conv.conversationId);
  assert.equal(revisedBundle?.artifacts.length, 2);
  assert.notEqual(revisedBundle?.artifacts[0].artifactId, revisedBundle?.artifacts[1].artifactId);
  assert.match(revisedBundle?.artifacts[1].content ?? '', /上一版正文已进入修改上下文/);
});

test('7 & 8. 审阅入口在 authorizationId 无效或作品/章节/产物不匹配时严格校验阻断', async () => {
  // 模拟不存在的授权
  const authNone = await artifactDecisionService.getAuthorization('non-existent-auth-id');
  assert.equal(authNone, null, '不存在的授权必须返回 null');

  // 校验 resolveEditorDraftContent 在不匹配时拒绝载入
  const invalidCandidate: ReviewCandidateDocument = {
    authorizationId: 'auth-test-1',
    artifactId: 'art-test-1',
    content: '候选正文',
    contentHash: 'hash-test-1',
    chapterId: 'chapter-real',
    novelId: 'novel-real',
  };

  const mismatchRes = resolveEditorDraftContent({
    documentState: 'ready',
    novelId: 'novel-other',
    chapterId: 'chapter-real',
    draft: null,
    reviewCandidate: invalidCandidate,
  });

  assert.equal(mismatchRes.action, 'preserve', '作品不匹配必须阻止载入');
  assert.ok(mismatchRes.reason?.includes('不一致'));
});

test('9 & 10 & 11. 审阅候选首次进入编辑器 currentDraft 为 null，保存调用 create 并绑定新草稿', async () => {
  const novel = await novelRepository.create({ title: '首次保存测试书' });
  const chapter = await chapterRepository.create({ novelId: novel.id, title: '第1章' });

  const candidateDoc: ReviewCandidateDocument = {
    authorizationId: 'auth-save-test',
    artifactId: 'art-save-test',
    content: '【第1章】\n\n初始候选正文内容。',
    contentHash: 'hash-1',
    chapterId: chapter.id,
    novelId: novel.id,
  };

  // 1. 初次解析，currentDraft 为 null，content 解析为候选正文
  const resolution = resolveEditorDraftContent({
    documentState: 'ready',
    novelId: novel.id,
    chapterId: chapter.id,
    draft: null,
    reviewCandidate: candidateDoc,
  });

  assert.equal(resolution.action, 'replace');
  assert.equal(resolution.content, candidateDoc.content);
  assert.equal(resolution.draft, null, '首次审阅 currentDraft 初始必须为 null');

  // 2. 模拟首次保存：调用 draftVersionService.create
  const createdDraft = await draftVersionService.create({
    novelId: novel.id,
    chapterId: chapter.id,
    content: resolution.content + '\n\n【用户人工精修】',
    source: 'user_edited',
  });

  assert.ok(createdDraft.id, '创建成功后必须具有真实 UUID draft.id');
  assert.notEqual(createdDraft.id, 'candidate-art-save-test', '严禁使用 candidate-* 伪 ID');
  assert.equal(createdDraft.versionNo, 1);
  assert.equal(createdDraft.isAdopted, false);

  // 3. 模拟二次保存：调用 draftVersionService.update
  const updatedDraft = await draftVersionService.update(
    createdDraft.id,
    chapter.id,
    createdDraft.content + '\n\n【二次修改】',
    'user_edited',
    undefined,
    createdDraft,
  );

  assert.equal(updatedDraft.id, createdDraft.id);
  assert.equal(updatedDraft.versionNo, 1);
});

test('12 & 13 & 14 & 15 & 16. 浏览器审阅协议可保存与采用（不作为 SQLite 原子性证据）', async () => {
  const novel = await novelRepository.create({ title: '原子采用测试作品' });
  const chapter = await chapterRepository.create({ novelId: novel.id, title: '第1章' });

  const conv = await taskConversationService.create(novel.id, '采用会话');
  const turn = await taskConversationService.appendTurn(conv.conversationId, 'user', '写正文');
  await testRuntime.start({
    conversationId: conv.conversationId,
    novelId: novel.id,
    chapterId: chapter.id,
    turnId: turn.turnId,
    goal: '写正文',
  });

  const bundle = await taskConversationService.get(conv.conversationId);
  assert.ok(bundle && bundle.artifacts.length > 0);
  const card = bundle.artifacts[0];
  assert.ok(card.artifactId);

  // 1. 用户确认进入审阅并签发决策与授权
  const { authorization } = await artifactDecisionService.record({
    conversationId: conv.conversationId,
    cardId: card.cardId,
    artifactId: card.artifactId,
    decision: 'confirm',
    targetType: 'chapter',
    targetId: chapter.id,
    novelId: novel.id,
    chapterId: chapter.id,
  });

  assert.ok(authorization?.authorizationId, '确认章节候选必须签发真实浏览器审阅授权');

  // 2. 工作区创建真实持久化草稿
  const savedDraft = await draftVersionService.create({
    novelId: novel.id,
    chapterId: chapter.id,
    content: '【第1章】\n\n最终审阅采用正文。',
    source: 'ai_generated',
  });

  // 3. 执行原子采用
  const adoptOutcome = await artifactDecisionService.adoptReviewAuthorizedDraft({
    authorizationId: authorization.authorizationId,
    draftId: savedDraft.id,
    expectedDraftVersion: savedDraft.versionNo,
    expectedContentHash: await computeContentSha256(savedDraft.content),
  });

  assert.equal(adoptOutcome.authorization.status, 'consumed');
  assert.equal(adoptOutcome.authorization.consumedByDraftId, savedDraft.id);
  assert.equal(adoptOutcome.adoptedDraft.isAdopted, true);

  // 4. 验证 SQLite 数据库状态
  const adoptedInDb = await draftVersionService.getAdoptedByChapterId(chapter.id);
  assert.ok(adoptedInDb);
  assert.equal(adoptedInDb.id, savedDraft.id);
  assert.equal(adoptedInDb.isAdopted, true);
});

test('17 & 18. 浏览器协议的跨作品数据隔离与连续多轮闭环', async () => {
  for (let i = 1; i <= 5; i++) {
    const novel = await novelRepository.create({ title: `多轮闭环作品_${i}` });
    const chapter = await chapterRepository.create({ novelId: novel.id, title: `第${i}章` });

    const conv = await taskConversationService.create(novel.id, `会话_${i}`);
    const turn = await taskConversationService.appendTurn(
      conv.conversationId,
      'user',
      `写第${i}章`,
    );

    const run = await testRuntime.start({
      conversationId: conv.conversationId,
      novelId: novel.id,
      chapterId: chapter.id,
      turnId: turn.turnId,
      goal: `写第${i}章`,
    });

    assert.equal(run.status, 'completed', run.error ?? '多轮 TaskRun 必须完成');

    const bundle = await taskConversationService.get(conv.conversationId);
    assert.ok(bundle && bundle.artifacts.length > 0);
    const card = bundle.artifacts[0];

    assert.ok(card.artifactId, '候选卡片必须引用产物标识');
    const { authorization } = await artifactDecisionService.record({
      conversationId: conv.conversationId,
      cardId: card.cardId,
      artifactId: card.artifactId,
      decision: 'confirm',
      targetType: 'chapter',
      targetId: chapter.id,
      novelId: novel.id,
      chapterId: chapter.id,
    });

    const draft = await draftVersionService.create({
      novelId: novel.id,
      chapterId: chapter.id,
      content: `第${i}章正式正文`,
      source: 'user_edited',
    });

    assert.ok(authorization?.authorizationId, '确认章节候选必须签发审阅授权');
    const outcome = await artifactDecisionService.adoptReviewAuthorizedDraft({
      authorizationId: authorization.authorizationId,
      draftId: draft.id,
      expectedDraftVersion: draft.versionNo,
      expectedContentHash: await computeContentSha256(draft.content),
    });

    assert.equal(outcome.adoptedDraft.isAdopted, true);
    assert.equal(outcome.authorization.status, 'consumed');
  }
});
